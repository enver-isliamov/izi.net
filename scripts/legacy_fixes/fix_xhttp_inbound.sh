#!/bin/bash
# IZINET — Исправление Reality+XHTTP inbound
# Проверяет БД, удаляет сломанные inbound'ы, перезапускает x3-ui

DB="/opt/izinet/xui-db/x-ui.db"

echo "=== IZINET: Fix XHTTP Inbound ==="

# 1. Проверяем БД
echo "[1/3] Проверка БД..."
if [ ! -f "$DB" ]; then
  echo "  ОШИБКА: БД не найдена: $DB"
  echo "  Проверь: ls -la /opt/izinet/xui-db/"
  exit 1
fi
echo "  БД найдена: $DB"

# 2. Останавливаем x3-ui и проверяем inbound'ы
echo "[2/3] Проверка inbound'ов..."
docker stop x3-ui 2>/dev/null || true
sleep 2

python3 -c "
import sqlite3, json
conn = sqlite3.connect('$DB')
c = conn.cursor()

# Проверяем таблицы
c.execute(\"SELECT name FROM sqlite_master WHERE type='table'\")
tables = [r[0] for r in c.fetchall()]
print(f'  Таблицы: {tables}')

if 'inbounds' not in tables:
    print('  ОШИБКА: Таблица inbounds не найдена!')
    conn.close()
    exit(1)

# Показываем все inbound'ы
c.execute('SELECT id, port, remark, enable, protocol, stream_settings FROM inbounds')
rows = c.fetchall()
print(f'  Всего inbound\'ов: {len(rows)}')
for r in rows:
    iid, port, remark, enable, proto, ss_raw = r
    try:
        ss = json.loads(ss_raw or '{}')
        net = ss.get('network', 'tcp')
        sec = ss.get('security', 'none')
    except:
        net = '?'
        sec = '?'
    status = '✅' if enable else '❌'
    print(f'  {status} ID={iid} port={port} proto={proto} net={net} sec={sec} remark={remark}')

# Удаляем inbound-44 если он Reality+WS (сломанный)
c.execute(\"SELECT id, stream_settings FROM inbounds WHERE id=44\")
row = c.fetchone()
if row:
    try:
        ss = json.loads(row[1] or '{}')
        if ss.get('network') == 'ws' and ss.get('security') == 'reality':
            print('  ⚠️ Удаляю inbound-44 (Reality+WS — не поддерживается Xray)')
            c.execute('DELETE FROM inbounds WHERE id=44')
    except:
        pass

conn.commit()
conn.close()
" 2>/dev/null

# 3. Перезапуск x3-ui
echo "[3/3] Перезапуск x3-ui..."
docker start x3-ui
sleep 10

echo ""
echo "=== ГОТОВО ==="
echo "Если inbound-44 (XHTTP) не появился в панели — создай вручную:"
echo "  1. + Создать подключение"
echo "  2. Протокол: vless, Порт: 2088"
echo "  3. Stream → Transmission: xhttp, Security: reality"
echo "  4. SNI: www.cloudflare.com, Target: www.cloudflare.com:443"
echo "  5. Path: /xhttp, Mode: auto"
echo "  6. Short IDs и ключи — скопируй из inbound 39"
