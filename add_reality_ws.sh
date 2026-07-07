#!/bin/bash
# IZINET — Добавление Reality+WebSocket inbound в 3x-ui
# Использует прямую запись в SQLite (API возвращает 404)
# Запуск: bash add_reality_ws.sh

set -e

DB_PATH="/opt/izinet/xui-db/x-ui.db"

echo "=== IZINET: Reality+WebSocket Setup ==="

# 1. Проверяем есть ли уже inbound на 2087
echo "[1/4] Проверка существующих inbound'ов..."
EXISTING=$(python3 -c "
import sqlite3, json
conn = sqlite3.connect('$DB_PATH')
c = conn.cursor()
c.execute('SELECT id, port, remark, enable, stream_settings FROM inbounds')
for row in c.fetchall():
    iid, port, remark, enable, ss_raw = row
    if port == 2087:
        ss = json.loads(ss_raw or '{}')
        net = ss.get('network', 'tcp')
        sec = ss.get('security', 'none')
        print(f'EXISTS id={iid} net={net} sec={sec} remark={remark} enable={enable}')
        break
else:
    print('NOT_FOUND')
conn.close()
" 2>/dev/null)

if echo "$EXISTING" | grep -q "EXISTS.*ws.*reality"; then
  echo "  Reality+WS inbound уже существует — пропускаю"
  echo "  $EXISTING"
  exit 0
fi
echo "  Reality+WS inbound не найден — создаю"

# 2. Читаем Reality ключи из inbound 443
echo "[2/4] Чтение Reality ключей из inbound 443..."
KEYS=$(python3 -c "
import sqlite3, json
conn = sqlite3.connect('$DB_PATH')
c = conn.cursor()
c.execute('SELECT id, stream_settings FROM inbounds WHERE port=443')
row = c.fetchone()
if not row:
    print('ERROR: inbound 443 not found')
    conn.close()
    exit(1)
iid, ss_raw = row
ss = json.loads(ss_raw or '{}')
rs = ss.get('realitySettings', {})
s = rs.get('settings', rs)
priv = rs.get('privateKey', '')
pub = s.get('publicKey', '')
sids = s.get('shortIds', rs.get('shortIds', []))
if not priv or not pub:
    print('ERROR: Reality keys not found')
    conn.close()
    exit(1)
print(priv)
print(pub)
print(json.dumps(sids))
conn.close()
" 2>/dev/null)

PRIV=$(echo "$KEYS" | sed -n '1p')
PUB=$(echo "$KEYS" | sed -n '2p')
SIDS=$(echo "$KEYS" | sed -n '3p')

if [[ "$PRIV" == ERROR* ]] || [ -z "$PRIV" ]; then
  echo "  ОШИБКА: $PRIV"
  exit 1
fi
echo "  Public Key: ${PUB:0:25}..."

# 3. Создаём inbound через SQLite
echo "[3/4] Создание inbound Reality+WS на порту 2087..."
python3 -c "
import sqlite3, json

DB = '$DB_PATH'
priv = '''$PRIV'''
pub = '''$PUB'''
sids = json.loads('''$SIDS''')

settings = json.dumps({
    'clients': [],
    'decryption': 'none',
    'fallbacks': [
        {'name': 'izinet.online', 'alpn': '', 'path': '/ws', 'dest': 'host.docker.internal:3443', 'xver': 0},
        {'dest': 'host.docker.internal:3443', 'xver': 0}
    ]
})

stream = json.dumps({
    'network': 'ws',
    'security': 'reality',
    'realitySettings': {
        'show': False,
        'xver': 0,
        'dest': 'www.cloudflare.com:443',
        'serverNames': ['www.cloudflare.com'],
        'privateKey': priv,
        'publicKey': pub,
        'shortIds': sids,
        'settings': {
            'publicKey': pub,
            'fingerprint': 'chrome',
            'serverName': 'www.cloudflare.com',
            'spiderX': '/'
        }
    },
    'wsSettings': {
        'path': '/ws',
        'headers': {'Host': 'www.cloudflare.com'}
    }
})

sniffing = json.dumps({'enabled': True, 'destOverride': ['http', 'tls'], 'routeOnly': False})

conn = sqlite3.connect(DB)
c = conn.cursor()

# Get max id
c.execute('SELECT COALESCE(MAX(id), 0) FROM inbounds')
max_id = c.fetchone()[0]
new_id = max_id + 1

c.execute('''INSERT INTO inbounds (id, user_id, up, down, total, remark, enable, expiry_time, listen, port, protocol, settings, stream_settings, tag, sniffing)
             VALUES (?, 0, 0, 0, 0, 'izinet-reality-ws', 1, 0, '', 2087, 'vless', ?, ?, ?, ?)''',
          (new_id, settings, stream, f'inbound-{new_id}', sniffing))

conn.commit()
conn.close()
print(f'OK id={new_id}')
"

# 4. Перезапуск x3-ui
echo "[4/4] Перезапуск x3-ui..."
docker restart x3-ui
sleep 10

# 5. Проверка
echo ""
echo "=== ПРОВЕРКА ==="
python3 -c "
import sqlite3, json
conn = sqlite3.connect('$DB_PATH')
c = conn.cursor()
c.execute('SELECT id, port, remark, enable, stream_settings FROM inbounds WHERE port IN (443, 2087)')
for row in c.fetchall():
    iid, port, remark, enable, ss_raw = row
    ss = json.loads(ss_raw or '{}')
    net = ss.get('network', 'tcp')
    sec = ss.get('security', 'none')
    print(f'  ID={iid} port={port} network={net} security={sec} remark={remark} enable={enable}')
conn.close()
" 2>/dev/null

echo ""
echo "=== ГОТОВО ==="
echo "Reality+WS inbound создан на порту 2087"
echo "Ссылка для клиента (пример):"
echo "vless://UUID@vpn.izinet.online:2087?type=ws&path=%2Fws&host=www.cloudflare.com&encryption=none&security=reality&sni=www.cloudflare.com&pbk=${PUB}&fp=chrome&sid=SHORT_ID&spx=%2F&flow=xtls-rprx-vision#OneD-WS"
