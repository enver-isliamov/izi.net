#!/bin/bash
echo "=== Порт 2088: диагностика ==="
echo ""
echo "1. Xray слушает?"
ss -tlnp | grep 2088 || echo "  ❌ Порт 2088 НЕ слушается"
echo ""
echo "2. UFW?"
ufw status 2>/dev/null | grep 2088 || echo "  ❌ UFW не разрешает 2088"
echo ""
echo "3. Docker порты?"
docker port x3-ui 2>/dev/null | grep 2088 || echo "  ❌ Docker не пробрасывает 2088"
echo ""
echo "4. Inbound в БД?"
docker stop x3-ui 2>/dev/null
python3 -c "
import sqlite3, json
conn = sqlite3.connect('/opt/izinet/xui-db/x-ui.db')
c = conn.cursor()
c.execute('SELECT id, port, remark, enable, stream_settings FROM inbounds WHERE port=2088')
r = c.fetchone()
if r:
    ss = json.loads(r[4] or '{}')
    print(f'  ✅ ID={r[0]} port={r[1]} net={ss.get(\"network\")} sec={ss.get(\"security\")} remark={r[2]} enable={r[3]}')
else:
    print('  ❌ Inbound на порту 2088 не найден')
conn.close()
"
docker start x3-ui
echo ""
echo "5. Xray логи (последние 5)?"
docker logs x3-ui --tail 5 2>&1 | grep -i "error\|2088\|started" || echo "  (чисто)"
