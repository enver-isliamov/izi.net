#!/bin/bash
DB="/opt/izinet/xui-db/x-ui.db"
docker stop x3-ui 2>/dev/null || true
sleep 2
python3 -c "
import sqlite3, json
conn = sqlite3.connect('$DB')
c = conn.cursor()
c.execute('PRAGMA table_info(inbounds)')
cols = [r[1] for r in c.fetchall()]
print(f'Колонки: {cols}')
for iid in [39, 45]:
    c.execute(f'SELECT * FROM inbounds WHERE id={iid}')
    row = c.fetchone()
    if row:
        print(f'\n=== Inbound {iid} ===')
        for col, val in zip(cols, row):
            if col in ('stream_settings', 'settings', 'sniffing'):
                try:
                    d = json.loads(val or '{}')
                    print(f'  {col}: {json.dumps(d, indent=4, ensure_ascii=False)[:500]}')
                except: print(f'  {col}: {val}')
            else:
                print(f'  {col}: {val}')
    else:
        print(f'\nInbound {iid} NOT FOUND')
conn.close()
"
docker start x3-ui
