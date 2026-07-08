import sqlite3
DB = "E:/YandexDisk/_Render-Snh/izi.net/xui-db/x-ui.db"
conn = sqlite3.connect(DB)
c = conn.cursor()
c.execute("UPDATE inbounds SET enable=0 WHERE id=44")
print(f"Disabled inbound 44: {c.rowcount} rows")
conn.commit()
c.execute("SELECT id, port, remark, enable FROM inbounds WHERE port IN (443, 2087)")
for row in c.fetchall():
    print(f"  ID={row[0]} port={row[1]} remark={row[2]} enable={row[3]}")
conn.close()
