#!/bin/bash
# IZINET VPN — Полная диагностика
# Запуск: bash diagnose_vpn.sh

echo "══════════════════════════════════════════════"
echo "  IZINET VPN — ДИАГНОСТИКА"
echo "  $(date)"
echo "══════════════════════════════════════════════"

# 1. Что отдаёт subscription endpoint
echo ""
echo "══ 1. VLESS ССЫЛКА ИЗ BACKEND ══"
SUB_LINK=$(curl -sk "https://izinet.online/api/sub/1ac833d3-328e-491e-bd27-60c3d5b5ed43?deviceId=device_8af29ffd" 2>/dev/null)
echo "$SUB_LINK" | python3 -c "
import sys,base64,urllib.parse
data=sys.stdin.read().strip()
try:
  decoded=base64.b64decode(data).decode()
  for line in decoded.split('\n'):
    line=line.strip()
    if line.startswith('vless://'):
      parts=line.split('#')
      name=parts[1] if len(parts)>1 else '?'
      query=parts[0].split('?')[1] if '?' in parts[0] else ''
      params=dict(urllib.parse.parse_qsl(query))
      server=parts[0].split('@')[1].split(':')[0] if '@' in parts[0] else '?'
      print(f'SERVER={server}')
      print(f'NAME={name}')
      print(f'pbk={params.get(\"pbk\",\"MISSING\")}')
      print(f'sid={params.get(\"sid\",\"MISSING\")}')
      print(f'sni={params.get(\"sni\",\"MISSING\")}')
      print(f'fp={params.get(\"fp\",\"MISSING\")}')
      print(f'flow={params.get(\"flow\",\"MISSING\")}')
      print(f'uuid={parts[0].split(\"@\")[0].split(\"//\")[1] if \"@\" in parts[0] else \"?\"}')
      print()
except Exception as e:
  print(f'ERROR: {e}')
  print(f'RAW: {data[:500]}')
" 2>/dev/null || echo "Не удалось декодировать ссылку"

# 2. Ключи в панели
echo "══ 2. REALITY КЛЮЧИ В ПАНЕЛИ ══"
curl -s -c /tmp/xc_iz http://localhost:2053/ >/dev/null 2>&1
CSRF=$(curl -s -b /tmp/xc_iz http://localhost:2053/csrf-token 2>/dev/null | python3 -c "import sys,json;print(json.load(sys.stdin).get('obj',''))" 2>/dev/null)
curl -s -c /tmp/xc_iz -b /tmp/xc_iz -H "X-CSRF-Token: $CSRF" -X POST http://localhost:2053/login -H "Content-Type: application/x-www-form-urlencoded" -d 'username=oja&password=sireyra' >/dev/null 2>&1

curl -s -b /tmp/xc_iz http://localhost:2053/panel/api/inbounds/list 2>/dev/null | python3 -c "
import sys,json
d=json.load(sys.stdin)
for ib in d.get('obj',[]):
  if ib.get('port')==443:
    ss=json.loads(ib.get('streamSettings','{}'))
    rs=ss.get('realitySettings',{})
    s=rs.get('settings',rs)
    sids=s.get('shortIds',rs.get('shortIds',[]))
    print(f'INBOUND ID={ib[\"id\"]} PORT={ib[\"port\"]}')
    print(f'Public Key={s.get(\"publicKey\",\"MISSING\")}')
    print(f'Fingerprint={s.get(\"fingerprint\",\"MISSING\")}')
    print(f'ServerNames={s.get(\"serverName\",rs.get(\"serverNames\",\"MISSING\"))}')
    print(f'ShortIDs={sids}')
    settings=json.loads(ib.get('settings','{}'))
    clients=settings.get('clients',[])
    print(f'Clients total={len(clients)}')
    emails=[c.get('email','') for c in clients]
    print(f'Client emails sample={emails[:5]}')
" 2>/dev/null || echo "Не удалось прочитать панель"

# 3. Сравнение ключей
echo ""
echo "══ 3. СРАВНЕНИЕ КЛЮЧЕЙ (VLESS vs PANEL) ══"
echo "$SUB_LINK" | python3 -c "
import sys,base64,urllib.parse,json
data=sys.stdin.read().strip()
try:
  decoded=base64.b64decode(data).decode()
  lines=[l.strip() for l in decoded.split('\n') if l.strip().startswith('vless://')]
  if not lines:
    print('NO VLESS LINKS FOUND')
    sys.exit(0)
  link=lines[0]
  parts=link.split('#')
  query=parts[0].split('?')[1] if '?' in parts[0] else ''
  params=dict(urllib.parse.parse_qsl(query))
  vless_pbk=params.get('pbk','')
  vless_sid=params.get('sid','')
  vless_sni=params.get('sni','')
  vless_fp=params.get('fp','')
  print(f'VLESS LINK:  pbk={vless_pbk} sid={vless_sid} sni={vless_sni} fp={vless_fp}')
except Exception as e:
  print(f'Parse error: {e}')
" 2>/dev/null

# 4. UFW
echo ""
echo "══ 4. UFW ══"
ufw status 2>/dev/null || echo "UFW not available"

# 5. Xray ошибки
echo ""
echo "══ 5. XRAY ОШИБКИ ══"
docker logs x3-ui 2>&1 | grep -iE "error|fail|reject|denied|panic" | tail -10 || echo "No errors"

# 6. Тест Reality handshake с сервера
echo ""
echo "══ 6. TCP TEST PORT 443 ══"
timeout 3 bash -c 'echo | openssl s_client -connect 194.50.94.28:443 -servername www.microsoft.com 2>&1' | head -5

# 7. Xray runtime config — outbounds
echo ""
echo "══ 7. XRAY OUTBOUNDS ══"
docker exec x3-ui cat bin/config.json 2>/dev/null | python3 -c "
import sys,json
d=json.load(sys.stdin)
obs=d.get('outbounds',[])
print(f'Outbounds count: {len(obs)}')
for o in obs:
  print(f'  tag={o.get(\"tag\",\"?\")} protocol={o.get(\"protocol\",\"?\")}')
dns=d.get('dns',{})
print(f'DNS servers: {dns.get(\"servers\",\"MISSING\")}')
" 2>/dev/null || echo "Cannot read xray config"

# 8. Все inbounds + их ключи
echo ""
echo "══ 8. ВСЕ INBOUNDS ══"
curl -s -b /tmp/xc_iz http://localhost:2053/panel/api/inbounds/list 2>/dev/null | python3 -c "
import sys,json
d=json.load(sys.stdin)
for ib in d.get('obj',[]):
  ss=json.loads(ib.get('streamSettings','{}'))
  sec=ss.get('security','none')
  rs=ss.get('realitySettings',{})
  s=rs.get('settings',rs)
  pbk=s.get('publicKey','') if sec=='reality' else 'N/A'
  print(f'ID={ib[\"id\"]} port={ib[\"port\"]} proto={ib[\"protocol\"]} remark={ib.get(\"remark\",\"?\")} sec={sec} pbk={pbk[:30]}... enable={ib.get(\"enable\",\"?\")}')
" 2>/dev/null || echo "Cannot list inbounds"

# 9. Последние логи приложения
echo ""
echo "══ 9. ПОСЛЕДНИЕ ЛОГИ IZINET-APP ══"
docker logs izinet-app 2>&1 | tail -15

echo ""
echo "══════════════════════════════════════════════"
echo "  Скопируйте весь вывод выше"
echo "══════════════════════════════════════════════"
