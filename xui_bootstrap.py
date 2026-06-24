#!/usr/bin/env python3
import argparse
import base64
import json
import os
import secrets
import sqlite3
import time

DB_PATH = os.environ.get("XUI_DB_PATH", "/opt/izinet/xui-db/x-ui.db")
SAFE_SERVER_NAMES = ["www.microsoft.com", "microsoft.com"]
SAFE_DNS_SERVERS = [
    "localhost",
    "https://dns.adguard-dns.com/dns-query",
    "https://dns.yandex.ru/dns-query",
    "94.140.14.14",
    "77.88.8.8",
    "9.9.9.9",
]
FALLBACKS = [
    {"name": "izinet.online", "alpn": "", "path": "", "dest": "host.docker.internal:3443", "xver": 0},
    {"name": "www.izinet.online", "alpn": "", "path": "", "dest": "host.docker.internal:3443", "xver": 0},
    {"dest": "host.docker.internal:3443", "xver": 0},
]


def load_json(value, fallback):
    if not value:
        return fallback
    try:
        return json.loads(value)
    except Exception:
        return fallback


def dump_json(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def b64url(raw):
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def x25519_public_key(private_key):
    p = 2**255 - 19
    a24 = 121665
    scalar = bytearray(private_key)
    scalar[0] &= 248
    scalar[31] &= 127
    scalar[31] |= 64
    k = int.from_bytes(scalar, "little")
    u = 9
    x1 = u
    x2, z2 = 1, 0
    x3, z3 = u, 1
    swap = 0
    for t in reversed(range(255)):
        kt = (k >> t) & 1
        swap ^= kt
        if swap:
            x2, x3 = x3, x2
            z2, z3 = z3, z2
        swap = kt
        a = (x2 + z2) % p
        aa = (a * a) % p
        b = (x2 - z2) % p
        bb = (b * b) % p
        e = (aa - bb) % p
        c = (x3 + z3) % p
        d = (x3 - z3) % p
        da = (d * a) % p
        cb = (c * b) % p
        x3 = ((da + cb) ** 2) % p
        z3 = (x1 * ((da - cb) ** 2)) % p
        x2 = (aa * bb) % p
        z2 = (e * (aa + a24 * e)) % p
    if swap:
        x2, x3 = x3, x2
        z2, z3 = z3, z2
    public = (x2 * pow(z2, p - 2, p)) % p
    return public.to_bytes(32, "little")


def reality_keypair():
    private = bytearray(secrets.token_bytes(32))
    private[0] &= 248
    private[31] &= 127
    private[31] |= 64
    private = bytes(private)
    return b64url(private), b64url(x25519_public_key(private))


def wait_for_db(seconds):
    deadline = time.time() + seconds
    while time.time() <= deadline:
        if os.path.exists(DB_PATH):
            return True
        time.sleep(1)
    return os.path.exists(DB_PATH)


def table_exists(cursor, table):
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name=?;", (table,))
    return cursor.fetchone() is not None


def table_columns(cursor, table):
    cursor.execute(f"PRAGMA table_info({table});")
    return [row[1] for row in cursor.fetchall()]


def set_setting(cursor, key, value):
    cursor.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?);", (key, value))


def default_sniffing():
    return {"enabled": True, "destOverride": ["http", "tls"], "routeOnly": False}


def default_stream_settings(private_key, public_key):
    return {
        "network": "tcp",
        "security": "reality",
        "externalProxy": [],
        "realitySettings": {
            "show": False,
            "xver": 0,
            "dest": "www.microsoft.com:443",
            "serverNames": SAFE_SERVER_NAMES,
            "privateKey": private_key,
            "publicKey": public_key,
            "minClient": "",
            "maxClient": "",
            "maxTimediff": 0,
            "shortIds": [secrets.token_hex(4)],
            "settings": {
                "publicKey": public_key,
                "fingerprint": "chrome",
                "serverName": "www.microsoft.com",
                "spiderX": "/",
            },
        },
        "tcpSettings": {"acceptProxyProtocol": False, "header": {"type": "none"}},
    }


def default_settings():
    return {"clients": [], "decryption": "none", "fallbacks": FALLBACKS}


def normalize_clients(settings):
    changed = False
    clients = settings.get("clients")
    if isinstance(clients, list):
        for client in clients:
            if isinstance(client, dict) and client.get("limitIp") != 0:
                client["limitIp"] = 0
                changed = True
    return changed


def normalize_reality(stream_settings):
    changed = False
    if stream_settings.get("security") != "reality":
        return changed
    reality = stream_settings.setdefault("realitySettings", {})
    if not isinstance(reality, dict):
        reality = {}
        stream_settings["realitySettings"] = reality
        changed = True
    names = reality.get("serverNames")
    if not isinstance(names, list) or not names or any("google" in str(name).lower() for name in names):
        reality["serverNames"] = SAFE_SERVER_NAMES
        changed = True
    for key in ("dest", "target"):
        if "google" in str(reality.get(key, "")).lower():
            reality[key] = "www.microsoft.com:443"
            changed = True
    if not reality.get("privateKey") or not reality.get("publicKey"):
        private_key, public_key = reality_keypair()
        reality["privateKey"] = private_key
        reality["publicKey"] = public_key
        changed = True
    settings = reality.setdefault("settings", {})
    if not isinstance(settings, dict):
        settings = {}
        reality["settings"] = settings
        changed = True
    if not settings.get("publicKey"):
        settings["publicKey"] = reality.get("publicKey", "")
        changed = True
    if not settings.get("fingerprint"):
        settings["fingerprint"] = "chrome"
        changed = True
    if not settings.get("spiderX"):
        settings["spiderX"] = "/"
        changed = True
    return changed


def normalize_fallbacks(settings, stream_settings):
    changed = False
    if stream_settings.get("security") != "reality":
        return changed
    if settings.get("fallbacks") != FALLBACKS:
        settings["fallbacks"] = FALLBACKS
        changed = True
    if "fallbacks" in stream_settings:
        stream_settings.pop("fallbacks", None)
        changed = True
    return changed


def ensure_default_inbound(cursor):
    if not table_exists(cursor, "inbounds"):
        return 0
    cursor.execute("SELECT COUNT(*) FROM inbounds WHERE port=443 OR protocol='vless';")
    if cursor.fetchone()[0] > 0:
        return 0

    columns = table_columns(cursor, "inbounds")
    private_key, public_key = reality_keypair()
    values = {
        "user_id": 0,
        "up": 0,
        "down": 0,
        "total": 0,
        "remark": "izinet-reality-443",
        "enable": 1,
        "expiry_time": 0,
        "listen": "",
        "port": 443,
        "protocol": "vless",
        "settings": dump_json(default_settings()),
        "stream_settings": dump_json(default_stream_settings(private_key, public_key)),
        "tag": "inbound-443",
        "sniffing": dump_json(default_sniffing()),
    }
    insert_cols = [col for col in columns if col != "id" and col in values]
    placeholders = ",".join("?" for _ in insert_cols)
    cursor.execute(
        f"INSERT INTO inbounds ({','.join(insert_cols)}) VALUES ({placeholders});",
        [values[col] for col in insert_cols],
    )
    return 1


def patch_inbounds(cursor):
    if not table_exists(cursor, "inbounds"):
        return 0
    columns = table_columns(cursor, "inbounds")
    if "settings" not in columns or "stream_settings" not in columns:
        return 0
    has_sniffing = "sniffing" in columns
    select_columns = ["id", "port", "protocol", "settings", "stream_settings"]
    if has_sniffing:
        select_columns.append("sniffing")
    cursor.execute(f"SELECT {', '.join(select_columns)} FROM inbounds;")
    updated = 0
    for row in cursor.fetchall():
        inbound_id, port, protocol, settings_raw, stream_raw, *rest = row
        if protocol != "vless" and port not in (443, 22053):
            continue
        settings = load_json(settings_raw, {})
        stream_settings = load_json(stream_raw, {})
        changed = normalize_clients(settings)
        changed |= normalize_reality(stream_settings)
        changed |= normalize_fallbacks(settings, stream_settings)
        sniffing = load_json(rest[0] if rest else "{}", {})
        if has_sniffing and sniffing != default_sniffing():
            sniffing = default_sniffing()
            changed = True
        if changed:
            if has_sniffing:
                cursor.execute(
                    "UPDATE inbounds SET settings=?, stream_settings=?, sniffing=? WHERE id=?;",
                    (dump_json(settings), dump_json(stream_settings), dump_json(sniffing), inbound_id),
                )
            else:
                cursor.execute(
                    "UPDATE inbounds SET settings=?, stream_settings=? WHERE id=?;",
                    (dump_json(settings), dump_json(stream_settings), inbound_id),
                )
            updated += 1
    return updated


def disable_broken_inbounds(cursor):
    if not table_exists(cursor, "inbounds"):
        return 0
    disabled = 0
    cursor.execute("SELECT id, remark, port, enable FROM inbounds;")
    for row in cursor.fetchall():
        inbound_id, remark, port, enable = row
        if enable and port == 8443:
            print(f"  ⚠️ Disabling inbound-8443 ({remark}) — requires missing TLS cert")
            cursor.execute("UPDATE inbounds SET enable=0 WHERE id=?;", (inbound_id,))
            disabled += 1
    return disabled


def patch_xray_settings(cursor):
    if not table_exists(cursor, "settings"):
        return 0
    cursor.execute("SELECT key, value FROM settings WHERE key IN ('xrayConfig', 'xraySetting');")
    updated = 0
    for key, value in cursor.fetchall():
        config = load_json(value, None)
        if not isinstance(config, dict):
            continue
        xray = config.get("xraySetting") if isinstance(config.get("xraySetting"), dict) else config
        dns = xray.setdefault("dns", {})
        if dns.get("servers") != SAFE_DNS_SERVERS:
            dns["servers"] = SAFE_DNS_SERVERS
            cursor.execute("UPDATE settings SET value=? WHERE key=?;", (dump_json(config), key))
            updated += 1
    return updated


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--wait-db", type=int, default=0)
    args = parser.parse_args()
    if not wait_for_db(args.wait_db):
        print(f"xui-bootstrap: {DB_PATH} not found yet, skipping bootstrap repair")
        return 0
    conn = sqlite3.connect(DB_PATH)
    try:
        cursor = conn.cursor()
        if table_exists(cursor, "settings"):
            set_setting(cursor, "externalTraffic", "false")
            set_setting(cursor, "externalTrafficInformURI", "")
        created = ensure_default_inbound(cursor)
        inbound_updates = patch_inbounds(cursor)
        broken_disabled = disable_broken_inbounds(cursor)
        xray_updates = patch_xray_settings(cursor)
        conn.commit()
        print(
            "xui-bootstrap: repaired persistent 3x-ui DB "
            f"(created_inbounds={created}, updated_inbounds={inbound_updates}, "
            f"broken_disabled={broken_disabled}, xray_settings={xray_updates})"
        )
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
