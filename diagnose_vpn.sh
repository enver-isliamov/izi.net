#!/bin/bash
# IZINET VPN — Исчерпывающая диагностика
# Запуск: bash diagnose_vpn.sh

echo "══════════════════════════════════════════════════"
echo "  IZINET VPN — ПОЛНАЯ ДИАГНОСТИКА"
echo "  $(date)"
echo "══════════════════════════════════════════════════"

echo ""
echo "══ 1. DOCKER ══"
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null

echo ""
echo "══ 2. UFW ══"
ufw status verbose 2>/dev/null || echo "UFW не установлен"

echo ""
echo "══ 3. NGINX ══"
ss -tlnp | grep 3443 2>/dev/null && echo "OK: Nginx слушает 3443" || echo "FAIL: Nginx НЕ слушает 3443"
curl -sk https://izinet.online/ >/dev/null 2>&1 && echo "OK: Сайт доступен" || echo "FAIL: Сайт недоступен"

echo ""
echo "══ 4. VLESS ССЫЛКА ДЛЯ ХАДИФАЙ ══"
echo "Тестирую subscription endpoint..."
SUB_RAW=$(curl -sk "https://izinet.online/api/sub/1ac833d3-328e-491e-bd27-60c3d5b5ed43?deviceId=device_8af29ffd" 2>/dev/null)
echo "$SUB_RAW" | python3 -c "
import sys,base64,urllib.parse
raw=sys.stdin.read().strip()
if not raw:
  print('ПУСТОЙ ОТВЕТ — подписка не найдена или endpoint не работает')
  sys.exit(0)
try:
  decoded=base64.b64decode(raw).decode()
except:
  print(f'Не base64. Ответ: {raw[:200]}')
  sys.exit(0)
links=[l.strip() for l in decoded.split('\n') if l.strip().startswith('vless://')]
if not links:
  print(f'Нет vless:// ссылок. Decoded: {decoded[:300]}')
  sys.exit(0)
for link in links:
  parts=link.split('#')
  name=parts[1] if len(parts)>1 else '?'
  query=parts[0].split('?')[1] if '?' in parts[0] else ''
  params=dict(urllib.parse.parse_qsl(query))
  server=parts[0].split('@')[1].split(':')[0] if '@' in parts[0] else '?'
  uuid_part=parts[0].split('//')[1].split('@')[0] if '@' in parts[0] else '?'
  print(f'  Сервер: {server}')
  print(f'  Имя: {name}')
  print(f'  UUID: {uuid_part}')
  print(f'  pbk: {params.get(\"pbk\",\"MISSING\")}')
  print(f'  sid: {params.get(\"sid\",\"MISSING\")}')
  print(f'  sni: {params.get(\"sni\",\"MISSING\")}')
  print(f'  fp:  {params.get(\"fp\",\"MISSING\")}')
  print(f'  flow:{params.get(\"flow\",\"MISSING\")}')
  print()
" 2>/dev/null

echo ""
echo "══ 5. КЛЮЧИ В ПАНЕЛИ X3-UI ══"
rm -f /tmp/xc_diag 2>/dev/null
curl -s -c /tmp/xc_diag http://localhost:2053/ >/dev/null 2>&1
CSRF=$(curl -s -b /tmp/xc_diag http://localhost:2053/csrf-token 2>/dev/null | python3 -c "import sys,json;print(json.load(sys.stdin).get('obj',''))" 2>/dev/null)
curl -s -c /tmp/xc_diag -b /tmp/xc_diag -H "X-CSRF-Token: $CSRF" -X POST http://localhost:2053/login -H "Content-Type: application/x-www-form-urlencoded" -d 'username=oja&password=sireyra' >/dev/null 2>&1

PANEL_OUT=$(curl -s -b /tmp/xc_diag http://localhost:2053/panel/api/inbounds/list 2>/dev/null)
echo "$PANEL_OUT" | python3 -c "
import sys,json
try:
  d=json.load(sys.stdin)
except:
  print('Не удалось прочитать ответ панели')
  sys.exit(0)
for ib in d.get('obj',[]):
  if ib.get('port')==443:
    ss=json.loads(ib.get('streamSettings','{}'))
    sec=ss.get('security','none')
    rs=ss.get('realitySettings',{})
    s=rs.get('settings',rs)
    print(f'Inbound ID: {ib.get(\"id\")}')
    print(f'Port: {ib.get(\"port\")}  Security: {sec}')
    print(f'Public Key: {s.get(\"publicKey\",\"MISSING\")}')
    print(f'Fingerprint: {s.get(\"fingerprint\",\"MISSING\")}')
    print(f'ServerNames: {s.get(\"serverName\",rs.get(\"serverNames\",\"MISSING\"))}')
    sids=s.get('shortIds',rs.get('shortIds',[]))
    print(f'ShortIDs: {sids}')
    fb=s.get('dest',rs.get('dest','MISSING'))
    print(f'Target (dest): {fb}')
    spider=s.get('spiderX',rs.get('spiderX','MISSING'))
    print(f'SpiderX: {spider}')
    settings=json.loads(ib.get('settings','{}'))
    clients=settings.get('clients',[])
    print(f'Clients: {len(clients)}')
    for c in clients[:5]:
      print(f'  email={c.get(\"email\",\"?\")} uuid={c.get(\"id\",\"?\")} flow={c.get(\"flow\",\"?\")}')
    if len(clients)>5:
      print(f'  ... и ещё {len(clients)-5}')
" 2>/dev/null

echo ""
echo "══ 6. СРАВНЕНИЕ pbk ИЗ ССЫЛКИ С ПАНЕЛЬЮ ══"
# Достаём pbk из ссылки
VLESS_PBK=$(echo "$SUB_RAW" | python3 -c "
import sys,base64,urllib.parse
raw=sys.stdin.read().strip()
try:
  decoded=base64.b64decode(raw).decode()
  for line in decoded.split('\n'):
    if line.strip().startswith('vless://'):
      query=line.split('?')[1] if '?' in line else ''
      params=dict(urllib.parse.parse_qsl(query))
      print(params.get('pbk',''))
      break
except: pass
" 2>/dev/null)

# Достаём pbk из панели
PANEL_PBK=$(echo "$PANEL_OUT" | python3 -c "
import sys,json
d=json.load(sys.stdin)
for ib in d.get('obj',[]):
  if ib.get('port')==443:
    ss=json.loads(ib.get('streamSettings','{}'))
    rs=ss.get('realitySettings',{})
    s=rs.get('settings',rs)
    print(s.get('publicKey',''))
    break
" 2>/dev/null)

echo "VLESS pbk: $VLESS_PBK"
echo "PANEL pbk: $PANEL_PBK"
if [ "$VLESS_PBK" = "$PANEL_PBK" ] && [ -n "$VLESS_PBK" ]; then
  echo "✅ pbk СОВПАДАЮТ"
else
  echo "❌ pbk НЕ СОВПАДАЮТ — ЭТО ПРИЧИНА ТАЙМАУТА!"
fi

echo ""
echo "══ 7. UUID ЕСТЬ В ПАНЕЛИ? ══"
VLESS_UUID=$(echo "$SUB_RAW" | python3 -c "
import sys,base64
raw=sys.stdin.read().strip()
try:
  decoded=base64.b64decode(raw).decode()
  for line in decoded.split('\n'):
    if line.strip().startswith('vless://'):
      uuid=line.split('//')[1].split('@')[0]
      print(uuid)
      break
except: pass
" 2>/dev/null)
echo "UUID из ссылки: $VLESS_UUID"
echo "$PANEL_OUT" | python3 -c "
import sys,json
d=json.load(sys.stdin)
target='$VLESS_UUID'
found=False
for ib in d.get('obj',[]):
  settings=json.loads(ib.get('settings','{}'))
  for c in settings.get('clients',[]):
    if c.get('id','')==target:
      print(f'✅ UUID найден в inbound {ib.get(\"id\")} (port {ib.get(\"port\")}) email={c.get(\"email\",\"?\")}')
      found=True
if not found:
  print(f'❌ UUID {target} НЕ НАЙДЕН ни в одном inbound!')
" 2>/dev/null

echo ""
echo "══ 8. XRAY RUNTIME CONFIG ══"
docker exec x3-ui cat bin/config.json 2>/dev/null | python3 -c "
import sys,json
d=json.load(sys.stdin)
dns=d.get('dns',{})
print(f'DNS: {dns.get(\"servers\",\"MISSING\")}')
obs=d.get('outbounds',[])
print(f'Outbounds ({len(obs)}):')
for o in obs:
  print(f'  tag={o.get(\"tag\",\"?\")} protocol={o.get(\"protocol\",\"?\")}')
routing=d.get('routing',{})
rules=routing.get('rules',[])
print(f'Routing rules ({len(rules)}):')
for r in rules[:5]:
  print(f'  inboundTag={r.get(\"inboundTag\",\"?\")} outboundTag={r.get(\"outboundTag\",\"?\")} domain={r.get(\"domain\",\"\")}')
" 2>/dev/null || echo "Не удалось прочитать конфиг Xray"

echo ""
echo "══ 9. XRAY ОШИБКИ ══"
docker logs x3-ui 2>&1 | grep -iE "error|fail|reject|denied|panic|refused" | tail -10 || echo "Ошибок нет"

echo ""
echo "══ 10. СТАРЫЕ СЕРВЕРЫ В ЛОГАХ ══"
docker logs izinet-app 2>&1 | grep -i "185.72.11.57" | tail -5 || echo "Нет обращений к старому серверу"

echo ""
echo "══ 11. ПОСЛЕДНИЕ 15 СТРОК IZINET-APP ══"
docker logs izinet-app 2>&1 | tail -15

echo ""
echo "══════════════════════════════════════════════════"
echo "  Скопируйте ВЕСЬ вывод и скиньте мне"
echo "══════════════════════════════════════════════════"
