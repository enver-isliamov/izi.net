#!/usr/bin/env python3
"""
IZINET — Emergency fix for Reality inbound 32.
Fixes missing serverNames and dest in the Reality inbound.
"""

import json
import os
import sqlite3

DB_PATH = os.environ.get('XUI_DB_PATH', '/etc/x-ui/x-ui.db')

# Try alternate path
if not os.path.exists(DB_PATH):
    alt = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', 'xui-db', 'x-ui.db')
    if os.path.exists(alt):
        DB_PATH = os.path.abspath(alt)

TARGET_PORT = 443
CORRECT_SERVER_NAMES = ["www.cloudflare.com"]
CORRECT_TARGET = "www.cloudflare.com:443"
CORRECT_FINGERPRINT = "chrome"

def find_reality_inbound(cursor):
    """Find the Reality inbound on port 443."""
    cursor.execute("SELECT id, port, stream_settings FROM inbounds;")
    for row in cursor.fetchall():
        inbound_id, port, stream_raw = row
        if port != TARGET_PORT:
            continue
        stream = json.loads(stream_raw) if stream_raw else {}
        if stream.get("security") == "reality":
            return inbound_id, stream
    return None, None

def fix():
    if not os.path.exists(DB_PATH):
        print(f"❌ DB not found: {DB_PATH}")
        return False

    conn = sqlite3.connect(DB_PATH)
    inbound_id, stream = find_reality_inbound(conn.cursor())
    if not inbound_id:
        print(f"❌ Reality inbound on port {TARGET_PORT} not found")
        conn.close()
        return False

    print(f"📋 Found Reality inbound ID={inbound_id}")
    reality = stream.get("realitySettings", {})
    changed = False

    # Fix serverNames — check for empty, invalid chars, or microsoft.com (blocked by ТСПУ)
    names = reality.get("serverNames")
    needs_fix = False
    if not isinstance(names, list) or len(names) == 0:
        needs_fix = True
    else:
        for n in names:
            if not isinstance(n, str) or ' ' in n or "'" in n or '"' in n or n.strip() != n:
                needs_fix = True
                break
            if "microsoft" in n.lower() or "google" in n.lower():
                needs_fix = True
                break
    if needs_fix:
        reality["serverNames"] = CORRECT_SERVER_NAMES
        changed = True
        print(f"✅ Fixed serverNames: {names} → {CORRECT_SERVER_NAMES}")

    # Fix dest/target — must use cloudflare.com for Reality handshake
    for key in ("dest", "target"):
        current = reality.get(key, "")
        if not current or "microsoft" in current.lower() or "google" in current.lower() or "docker" in current.lower():
            reality[key] = CORRECT_TARGET
            changed = True
            print(f"✅ Fixed {key}: {current} → {CORRECT_TARGET}")

    # Fix inner settings.serverName
    settings = reality.get("settings", {})
    if isinstance(settings, dict):
        sn = settings.get("serverName", "")
        if not sn or "google" in sn.lower():
            settings["serverName"] = "www.microsoft.com"
            reality["settings"] = settings
            changed = True
            print(f"✅ Fixed settings.serverName: www.microsoft.com")

    # Fix fingerprint
    if isinstance(settings, dict):
        fp = settings.get("fingerprint", "")
        if fp != CORRECT_FINGERPRINT:
            settings["fingerprint"] = CORRECT_FINGERPRINT
            reality["settings"] = settings
            changed = True
            print(f"✅ Fixed fingerprint: {fp} → {CORRECT_FINGERPRINT}")

    # Ensure fingerprint
    if isinstance(settings, dict) and not settings.get("fingerprint"):
        settings["fingerprint"] = "chrome"
        reality["settings"] = settings
        changed = True

    if not changed:
        print(f"✅ Inbound {inbound_id} already correct")
        conn.close()
        return True

    stream["realitySettings"] = reality
    conn.execute(
        "UPDATE inbounds SET stream_settings = ? WHERE id = ?",
        (json.dumps(stream), inbound_id)
    )
    conn.commit()
    conn.close()
    print(f"✅ Inbound {inbound_id} updated in SQLite")
    return True


if __name__ == "__main__":
    print("=" * 50)
    print("  IZINET — Fix Reality inbound (auto-detect port 443)")
    print("=" * 50)
    if fix():
        print("\nRestart x3-ui to apply: docker restart x3-ui")
    else:
        print("\nFailed to fix")
