#!/bin/bash
# IZINET — Добавление Reality+XHTTP inbound в 3x-ui
# Reality поддерживает RAW, XHTTP и gRPC (НО НЕ WebSocket)
# Запуск: bash setup_xhttp.sh

set -e

DB_PATH="/opt/izinet/xui-db/x-ui.db"
XHTTP_PORT=2087

echo "=== IZINET: Reality+XHTTP Setup ==="

# 1. Проверяем есть ли уже XHTTP inbound
echo "[1/4] Проверка существующих inbound'ов..."
EXISTING=$(python3 -c "
import sqlite3, json
conn = sqlite3.connect('$DB_PATH')
c = conn.cursor()
c.execute('SELECT id, port, remark, enable, stream_settings FROM inbounds')
for row in c.fetchall():
    iid, port, remark, enable, ss_raw = row
    ss = json.loads(ss_raw or '{}')
    net = ss.get('network', 'tcp')
    sec = ss.get('security', 'none')
    if port == $XHTTP_PORT and sec == 'reality':
        print(f'EXISTS id={iid} net={net} sec={sec} remark={remark} enable={enable}')
        break
else:
    print('NOT_FOUND')
conn.close()
" 2>/dev/null)

if echo "$EXISTING" | grep -q "EXISTS"; then
  echo "  Reality+XHTTP inbound уже существует — пропускаю"
  echo "  $EXISTING"
  exit 0
fi
echo "  Reality+XHTTP inbound не найден — создаю"

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

# 3. Создаём inbound Reality+XHTTP через SQLite
echo "[3/4] Создание inbound Reality+XHTTP на порту $XHTTP_PORT..."
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
        {'name': 'izinet.online', 'alpn': '', 'path': '', 'dest': 'host.docker.internal:3443', 'xver': 0},
        {'dest': 'host.docker.internal:3443', 'xver': 0}
    ]
})

# XHTTP transport with Reality
stream = json.dumps({
    'network': 'xhttp',
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
    'xhttpSettings': {
        'path': '/xhttp',
        'mode': 'auto'
    }
})

sniffing = json.dumps({'enabled': True, 'destOverride': ['http', 'tls'], 'routeOnly': False})

conn = sqlite3.connect(DB)
c = conn.cursor()

c.execute('SELECT COALESCE(MAX(id), 0) FROM inbounds')
max_id = c.fetchone()[0]
new_id = max_id + 1

c.execute('''INSERT INTO inbounds (id, user_id, up, down, total, remark, enable, expiry_time, listen, port, protocol, settings, stream_settings, tag, sniffing)
             VALUES (?, 0, 0, 0, 0, 'izinet-reality-xhttp', 1, 0, '', $XHTTP_PORT, 'vless', ?, ?, ?, ?)''',
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
c.execute('SELECT id, port, remark, enable, stream_settings FROM inbounds WHERE port IN (443, $XHTTP_PORT)')
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
echo "Reality+XHTTP inbound создан на порту $XHTTP_PORT"
echo "Ссылка для клиента (пример):"
echo "vless://UUID@vpn.izinet.online:$XHTTP_PORT?encryption=none&security=reality&sni=www.cloudflare.com&pbk=${PUB}&fp=chrome&sid=SHORT_ID&spx=%2F&flow=xtls-rprx-vision&type=xhttp&path=%2Fxhttp&host=www.cloudflare.com#OneD-XHTTP"
