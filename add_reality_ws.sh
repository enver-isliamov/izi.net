#!/bin/bash
set -e
rm -f /tmp/xc3 2>/dev/null

echo "=== Шаг 1: Логин ==="
curl -s -c /tmp/xc3 http://localhost:2053/ >/dev/null 2>&1
CSRF=$(curl -s -b /tmp/xc3 http://localhost:2053/csrf-token | python3 -c "import sys,json;print(json.load(sys.stdin).get('obj',''))")
curl -s -c /tmp/xc3 -b /tmp/xc3 -H "X-CSRF-Token: $CSRF" -X POST http://localhost:2053/login -H "Content-Type: application/x-www-form-urlencoded" -d 'username=oja&password=sireyra' >/dev/null 2>&1
echo "OK"

echo "=== Шаг 2: Чтение Reality ключей из inbound 443 ==="
KEYS=$(curl -s -b /tmp/xc3 http://localhost:2053/panel/api/inbounds/get/32 | python3 -c "
import sys,json
d=json.load(sys.stdin)
ib=d.get('obj',{})
ss=json.loads(ib.get('streamSettings','{}'))
rs=ss.get('realitySettings',{})
s=rs.get('settings',rs)
priv=rs.get('privateKey','')
pub=s.get('publicKey','')
sids=s.get('shortIds',rs.get('shortIds',[]))
print(priv)
print(pub)
print(json.dumps(sids))
")
PRIV=$(echo "$KEYS" | sed -n '1p')
PUB=$(echo "$KEYS" | sed -n '2p')
SIDS=$(echo "$KEYS" | sed -n '3p')
echo "Private: ${PRIV:0:15}..."
echo "Public: ${PUB:0:15}..."
echo "ShortIDs: $SIDS"

echo "=== Шаг 3: Создание inbound Reality+WS на порту 8443 ==="
python3 << PYEOF
import json, urllib.request

priv="$PRIV"
pub="$PUB"
sids=$SIDS

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

cookies = open("/tmp/xc3").read()
cookie_str = ""
for line in open("/tmp/xc3"):
    if "session" in line.lower() or "3x-ui" in line.lower():
        parts = line.strip().split("\t")
        if len(parts) >= 7:
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
        print(f"OK! Inbound ID: {result.get('obj',{}).get('id','?')}")
    else:
        print(f"ERROR: {result.get('msg', result)}")
except Exception as e:
    print(f"ERROR: {e}")
PYEOF

echo "=== Шаг 4: Перезапуск Xray ==="
sleep 2
curl -s -b /tmp/xc3 -X POST http://localhost:2053/panel/setting/restartPanel >/dev/null 2>&1
sleep 3

echo "=== Шаг 5: Проверка ==="
curl -s -b /tmp/xc3 http://localhost:2053/panel/api/inbounds/list | python3 -c "
import sys,json
d=json.load(sys.stdin)
for ib in d.get('obj',[]):
  print(f'ID={ib[\"id\"]} port={ib[\"port\"]} remark={ib.get(\"remark\",\"?\")} enable={ib.get(\"enable\",\"?\")}')
"

echo ""
echo "=== ГОТОВО ==="
echo "Новый inbound: izinet-reality-ws на порту 8443"
echo "VLESS ссылка:"
echo "vless://ВСТАВЬ_UUID@vpn.izinet.online:8443?type=ws&security=reality&sni=www.microsoft.com&pbk=${PUB}&fp=chrome&sid=ВСТАВЬ_SID&spx=%2F&path=%2Fws&host=www.microsoft.com&flow=xtls-rprx-vision#OneD-WS"
