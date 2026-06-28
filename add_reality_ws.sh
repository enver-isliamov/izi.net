#!/bin/bash
# IZINET — Добавление Reality+WebSocket inbound в 3x-ui
# Запуск: bash add_reality_ws.sh
# Идемпотентный — пропускает если inbound уже существует

set -e
rm -f /tmp/xc_ws 2>/dev/null

echo "=== IZINET: Reality+WebSocket Setup ==="

# 1. Логин
echo "[1/5] Логин в панель..."
curl -s -c /tmp/xc_ws http://localhost:2053/ >/dev/null 2>&1
CSRF=$(curl -s -b /tmp/xc_ws http://localhost:2053/csrf-token 2>/dev/null | python3 -c "import sys,json;print(json.load(sys.stdin).get('obj',''))" 2>/dev/null)
curl -s -c /tmp/xc_ws -b /tmp/xc_ws -H "X-CSRF-Token: $CSRF" -X POST http://localhost:2053/login -H "Content-Type: application/x-www-form-urlencoded" -d 'username=oja&password=sireyra' >/dev/null 2>&1
echo "  OK"

# 2. Проверяем есть ли уже inbound на 8443
echo "[2/5] Проверка существующих inbound'ов..."
EXISTING=$(curl -s -b /tmp/xc_ws http://localhost:2053/panel/api/inbounds/list 2>/dev/null | python3 -c "
import sys,json
d=json.load(sys.stdin)
for ib in d.get('obj',[]):
  if ib.get('port')==8443:
    ss=json.loads(ib.get('streamSettings','{}'))
    net=ss.get('network','tcp')
    sec=ss.get('security','none')
    print(f'EXISTS id={ib[\"id\"]} net={net} sec={sec} remark={ib.get(\"remark\",\"?\")} enable={ib.get(\"enable\",\"?\")}')
    break
else:
  print('NOT_FOUND')
" 2>/dev/null)

if echo "$EXISTING" | grep -q "EXISTS.*ws.*reality"; then
  echo "  Reality+WS inbound уже существует — пропускаю"
  echo "  $EXISTING"
  exit 0
fi
echo "  Reality+WS inbound не найден — создаю"

# 3. Читаем Reality ключи из inbound 443
echo "[3/5] Чтение Reality ключей из inbound 443..."
KEYS=$(curl -s -b /tmp/xc_ws http://localhost:2053/panel/api/inbounds/get/32 2>/dev/null | python3 -c "
import sys,json
d=json.load(sys.stdin)
ib=d.get('obj',{})
ss=json.loads(ib.get('streamSettings','{}'))
rs=ss.get('realitySettings',{})
s=rs.get('settings',rs)
print(rs.get('privateKey',''))
print(s.get('publicKey',''))
print(json.dumps(s.get('shortIds',rs.get('shortIds',[]))))
" 2>/dev/null)

PRIV=$(echo "$KEYS" | sed -n '1p')
PUB=$(echo "$KEYS" | sed -n '2p')
SIDS=$(echo "$KEYS" | sed -n '3p')

if [ -z "$PRIV" ] || [ -z "$PUB" ]; then
  echo "  ОШИБКА: Не удалось прочитать Reality ключи из inbound 443"
  exit 1
fi
echo "  Public Key: ${PUB:0:25}..."

# 4. Создаём inbound Reality+WS
echo "[4/5] Создание inbound Reality+WS на порту 8443..."
RESULT=$(python3 << PYEOF
import json, urllib.request

priv = "$PRIV"
pub = "$PUB"
sids = json.loads('$SIDS')

settings = {
    "clients": [],
    "decryption": "none",
    "fallbacks": [
        {"name": "izinet.online", "alpn": "", "path": "/ws", "dest": "host.docker.internal:3443", "xver": 0},
        {"dest": "host.docker.internal:3443", "xver": 0}
    ]
}

stream = {
    "network": "ws",
    "security": "reality",
    "realitySettings": {
        "show": False,
        "xver": 0,
        "dest": "www.microsoft.com:443",
        "serverNames": ["www.microsoft.com"],
        "privateKey": priv,
        "publicKey": pub,
        "shortIds": sids,
        "settings": {
            "publicKey": pub,
            "fingerprint": "chrome",
            "serverName": "www.microsoft.com",
            "spiderX": "/"
        }
    },
    "wsSettings": {
        "path": "/ws",
        "headers": {"Host": "www.microsoft.com"}
    }
}

sniffing = {"enabled": True, "destOverride": ["http", "tls"], "routeOnly": False}

body = json.dumps({
    "enable": True,
    "remark": "izinet-reality-ws",
    "port": 8443,
    "protocol": "vless",
    "settings": json.dumps(settings),
    "streamSettings": json.dumps(stream),
    "sniffing": json.dumps(sniffing)
}).encode()

cookie_str = ""
for line in open("/tmp/xc_ws"):
    parts = line.strip().split("\t")
    if len(parts) >= 7 and parts[0] and not parts[0].startswith("#"):
        cookie_str += f"{parts[5]}={parts[6]}; "

req = urllib.request.Request(
    "http://localhost:2053/panel/api/inbounds/add",
    data=body,
    headers={
        "Content-Type": "application/json",
        "Cookie": cookie_str.rstrip("; ")
    },
    method="POST"
)
try:
    resp = urllib.request.urlopen(req)
    result = json.loads(resp.read())
    if result.get("success"):
        print(f"OK id={result.get('obj',{}).get('id','?')}")
    else:
        print(f"ERROR: {result.get('msg', result)}")
except Exception as e:
    print(f"ERROR: {e}")
PYEOF
)

echo "  $RESULT"

if echo "$RESULT" | grep -q "ERROR"; then
  echo "  Не удалось создать inbound. Проверь логи."
  exit 1
fi

# 5. Перезапуск Xray
echo "[5/5] Перезапуск Xray..."
sleep 2
curl -s -b /tmp/xc_ws -X POST http://localhost:2053/panel/setting/restartPanel >/dev/null 2>&1
sleep 3

# 6. Проверка
echo ""
echo "=== ПРОВЕРКА ==="
curl -s -b /tmp/xc_ws http://localhost:2053/panel/api/inbounds/list 2>/dev/null | python3 -c "
import sys,json
d=json.load(sys.stdin)
for ib in d.get('obj',[]):
  if ib.get('port') in (443, 8443):
    ss=json.loads(ib.get('streamSettings','{}'))
    net=ss.get('network','tcp')
    sec=ss.get('security','none')
    print(f'  ID={ib[\"id\"]} port={ib[\"port\"]} network={net} security={sec} remark={ib.get(\"remark\",\"?\")} enable={ib.get(\"enable\",\"?\")}')
" 2>/dev/null

echo ""
echo "=== ГОТОВО ==="
echo "Reality+WS inbound создан на порту 8443"
echo "Ссылка для клиента (пример):"
echo "vless://UUID@vpn.izinet.online:8443?type=ws&path=%2Fws&host=www.microsoft.com&encryption=none&security=reality&sni=www.microsoft.com&pbk=${PUB}&fp=chrome&sid=SHORT_ID&spx=%2F&flow=xtls-rprx-vision#OneD-WS"
