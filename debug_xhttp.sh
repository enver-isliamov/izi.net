#!/bin/bash
# Сравниваем JSON рабочего inbound 39 с нашим inbound 45

DB="/opt/izinet/xui-db/x-ui.db"

docker stop x3-ui 2>/dev/null || true
sleep 2

python3 << 'PYEOF'
import sqlite3, json

DB = "/opt/izinet/xui-db/x-ui.db"
conn = sqlite3.connect(DB)
c = conn.cursor()

# Читаем рабочий inbound 39
c.execute("SELECT stream_settings, settings FROM inbounds WHERE id=39")
row = c.fetchone()
if row:
    ss39 = json.loads(row[0] or '{}')
    st39 = json.loads(row[1] or '{}')
    print("=== Inbound 39 (РАБОЧИЙ) ===")
    print(f"stream_settings keys: {list(ss39.keys())}")
    print(f"realitySettings keys: {list(ss39.get('realitySettings', {}).keys())}")
    rs39 = ss39.get('realitySettings', {})
    print(f"realitySettings.settings keys: {list(rs39.get('settings', {}).keys())}")
    print(f"settings keys: {list(st39.keys())}")
    print(f"settings.clients count: {len(st39.get('clients', []))}")
    print()

# Читаем наш inbound 45
c.execute("SELECT stream_settings, settings, sniffing FROM inbounds WHERE id=45")
row = c.fetchone()
if row:
    ss45 = json.loads(row[0] or '{}')
    st45 = json.loads(row[1] or '{}')
    sn45 = json.loads(row[2] or '{}')
    print("=== Inbound 45 (НАШ XHTTP) ===")
    print(f"stream_settings keys: {list(ss45.keys())}")
    print(f"realitySettings keys: {list(ss45.get('realitySettings', {}).keys())}")
    rs45 = ss45.get('realitySettings', {})
    print(f"realitySettings.settings keys: {list(rs45.get('settings', {}).keys())}")
    print(f"xhttpSettings: {ss45.get('xhttpSettings', 'MISSING')}")
    print(f"settings keys: {list(st45.keys())}")
    print(f"sniffing: {sn45}")
    print()
    print("=== ПОЛНЫЙ stream_settings inbound 45 ===")
    print(json.dumps(ss45, indent=2, ensure_ascii=False))
else:
    print("Inbound 45 не найден!")

conn.close()
PYEOF

docker start x3-ui
