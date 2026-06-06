#!/usr/bin/env python3
import argparse
import json
import os
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


def load_json(value, fallback):
    if not value:
        return fallback
    try:
        return json.loads(value)
    except Exception:
        return fallback


def dump_json(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def wait_for_db(seconds):
    deadline = time.time() + seconds
    while time.time() <= deadline:
        if os.path.exists(DB_PATH):
            return True
        time.sleep(1)
    return os.path.exists(DB_PATH)


def table_columns(cursor, table):
    cursor.execute(f"PRAGMA table_info({table});")
    return [row[1] for row in cursor.fetchall()]


def set_setting(cursor, key, value):
    cursor.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?);",
        (key, value),
    )


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

    reality = stream_settings.get("realitySettings")
    if not isinstance(reality, dict):
        reality = {}
        stream_settings["realitySettings"] = reality
        changed = True

    names = reality.get("serverNames")
    names_are_bad = (
        not isinstance(names, list)
        or len(names) == 0
        or any("google" in str(name).lower() for name in names)
    )
    if names_are_bad:
        reality["serverNames"] = SAFE_SERVER_NAMES
        changed = True

    for key in ("dest", "target"):
        value = str(reality.get(key, "")).lower()
        if "google" in value:
            reality[key] = "www.microsoft.com:443"
            changed = True

    if not reality.get("fingerprint"):
        reality["fingerprint"] = "chrome"
        changed = True
    if not reality.get("spiderX"):
        reality["spiderX"] = "/"
        changed = True

    return changed


def normalize_fallbacks(settings, stream_settings):
    changed = False
    if stream_settings.get("security") != "reality":
        return changed

    desired = [
        {"name": "izinet.online", "alpn": "", "path": "", "dest": "host.docker.internal:3443", "xver": 0},
        {"name": "www.izinet.online", "alpn": "", "path": "", "dest": "host.docker.internal:3443", "xver": 0},
        {"dest": "host.docker.internal:3443", "xver": 0},
    ]
    if settings.get("fallbacks") != desired:
        settings["fallbacks"] = desired
        changed = True
    if "fallbacks" in stream_settings:
        stream_settings.pop("fallbacks", None)
        changed = True
    return changed


def patch_inbounds(cursor):
    columns = table_columns(cursor, "inbounds")
    if "settings" not in columns or "stream_settings" not in columns:
        print("xui-bootstrap: inbounds table has no expected settings columns, skipping")
        return 0

    has_sniffing = "sniffing" in columns
    select_columns = ["id", "port", "protocol", "settings", "stream_settings"]
    if has_sniffing:
        select_columns.append("sniffing")

    cursor.execute(f"SELECT {', '.join(select_columns)} FROM inbounds;")
    rows = cursor.fetchall()
    updated = 0

    for row in rows:
        inbound_id, port, protocol, settings_raw, stream_raw, *rest = row
        if protocol != "vless" and port not in (443, 22053):
            continue

        settings = load_json(settings_raw, {})
        stream_settings = load_json(stream_raw, {})
        changed = False

        changed |= normalize_clients(settings)
        changed |= normalize_reality(stream_settings)
        changed |= normalize_fallbacks(settings, stream_settings)

        sniffing_raw = rest[0] if rest else "{}"
        sniffing = load_json(sniffing_raw, {})
        if has_sniffing:
            desired_sniffing = {"enabled": True, "destOverride": ["http", "tls"], "routeOnly": False}
            if sniffing != desired_sniffing:
                sniffing = desired_sniffing
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


def patch_xray_settings(cursor):
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
        set_setting(cursor, "externalTraffic", "false")
        set_setting(cursor, "externalTrafficInformURI", "")
        inbound_updates = patch_inbounds(cursor)
        xray_updates = patch_xray_settings(cursor)
        conn.commit()
        print(
            "xui-bootstrap: repaired persistent 3x-ui DB "
            f"(inbounds={inbound_updates}, xray_settings={xray_updates}, dns={','.join(SAFE_DNS_SERVERS)})"
        )
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
