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

TARGET_INBOUND_ID = 32
CORRECT_SERVER_NAMES = ["www.microsoft.com", "microsoft.com"]
CORRECT_DEST = "www.microsoft.com:443"

def fix():
    if not os.path.exists(DB_PATH):
        print(f"❌ DB not found: {DB_PATH}")
        return False

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.execute(
        "SELECT id, stream_settings FROM inbounds WHERE id = ?", (TARGET_INBOUND_ID,)
    )
    row = cursor.fetchone()
    if not row:
        print(f"❌ Inbound {TARGET_INBOUND_ID} not found")
        conn.close()
        return False

    inbound_id, stream_raw = row
    stream = json.loads(stream_raw) if stream_raw else {}

    reality = stream.get("realitySettings", {})
    changed = False

    # Fix serverNames
    names = reality.get("serverNames")
    if not isinstance(names, list) or len(names) == 0:
        reality["serverNames"] = CORRECT_SERVER_NAMES
        changed = True
        print(f"✅ Fixed serverNames: {CORRECT_SERVER_NAMES}")

    # Fix dest
    dest = reality.get("dest", "")
    if not dest or "google" in dest.lower():
        reality["dest"] = CORRECT_DEST
        changed = True
        print(f"✅ Fixed dest: {CORRECT_DEST}")

    # Fix inner settings.serverName
    settings = reality.get("settings", {})
    if isinstance(settings, dict):
        sn = settings.get("serverName", "")
        if not sn or "google" in sn.lower():
            settings["serverName"] = "www.microsoft.com"
            reality["settings"] = settings
            changed = True
            print(f"✅ Fixed settings.serverName: www.microsoft.com")

    # Ensure fingerprint
    if isinstance(settings, dict) and not settings.get("fingerprint"):
        settings["fingerprint"] = "chrome"
        reality["settings"] = settings
        changed = True

    if not changed:
        print(f"✅ Inbound {TARGET_INBOUND_ID} already correct")
        conn.close()
        return True

    stream["realitySettings"] = reality
    conn.execute(
        "UPDATE inbounds SET stream_settings = ? WHERE id = ?",
        (json.dumps(stream), TARGET_INBOUND_ID)
    )
    conn.commit()
    conn.close()
    print(f"✅ Inbound {TARGET_INBOUND_ID} updated in SQLite")
    return True


if __name__ == "__main__":
    print("=" * 50)
    print("  IZINET — Fix Reality inbound 32")
    print("=" * 50)
    if fix():
        print("\nRestart x3-ui to apply: docker restart x3-ui")
    else:
        print("\nFailed to fix")
