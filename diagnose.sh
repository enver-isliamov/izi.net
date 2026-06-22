#!/bin/bash
# ══════════════════════════════════════════════════════════════
# IZINET VPS — Автоматическая диагностика
# Запуск: bash diagnose.sh 2>&1 | tee /tmp/diag_result.txt
# Копируйте вывод и скидывайте для анализа.
# ══════════════════════════════════════════════════════════════

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'
BOLD='\033[1m'

OK=0; FAIL=0; WARN=0

check_ok()   { echo -e "  ${GREEN}[✅ OK]${NC}    $1"; ((OK++)); }
check_fail() { echo -e "  ${RED}[❌ FAIL]${NC}  $1"; echo -e "           ${YELLOW}→ ИСПРАВЛЕНИЕ: $2${NC}"; ((FAIL++)); }
check_warn() { echo -e "  ${YELLOW}[⚠️ WARN]${NC}  $1"; echo -e "           ${YELLOW}→ РЕКОМАЦИЯ: $2${NC}"; ((WARN++)); }
section()    { echo -e "\n${BOLD}═══ $1 ═══${NC}"; }

echo "═══════════════════════════════════════════════"
echo "  IZINET VPS — ДИАГНОСТИКА"
echo "  $(date)"
echo "  Сервер: $(hostname) ($(curl -s ifconfig.me 2>/dev/null || echo 'N/A'))"
echo "═══════════════════════════════════════════════"

# ─── 1. Docker контейнеры ─────────────────────────────────────
section "1. Docker контейнеры"

if docker ps --format '{{.Names}}' | grep -q x3-ui; then
    check_ok "x3-ui запущен"
    docker ps --filter name=x3-ui --format '           Порты: {{.Ports}}'
else
    check_fail "x3-ui НЕ запущен" "cd /opt/izinet && docker compose up -d x3-ui"
fi

if docker ps --format '{{.Names}}' | grep -q izinet-app; then
    check_ok "izinet-app запущен"
    docker ps --filter name=izinet-app --format '           Порты: {{.Ports}}'
else
    check_fail "izinet-app НЕ запущен" "cd /opt/izinet && docker compose up -d izinet-app"
fi

# ─── 2. Nginx на хосте ────────────────────────────────────────
section "2. Nginx на хосте"

if command -v nginx &>/dev/null; then
    check_ok "nginx установлен ($(nginx -v 2>&1))"
else
    check_fail "nginx НЕ установлен" "apt-get install -y nginx"
fi

if sudo nginx -t 2>&1 | grep -q "successful"; then
    check_ok "nginx -t проходит"
else
    NGINX_ERR=$(sudo nginx -t 2>&1)
    check_fail "nginx -t ОШИБКА: $NGINX_ERR" "Исправить /etc/nginx/sites-available/izinet"
fi

if ss -tlnp 2>/dev/null | grep -q ":3443"; then
    check_ok "nginx слушает 3443"
elif ss -tlnp 2>/dev/null | grep ":443" | grep -q nginx; then
    check_fail "nginx слушает 443 (КОНФЛИКТ с x3-ui!)" "Изменить listen на 3443 в /etc/nginx/sites-available/izinet"
else
    check_fail "nginx НЕ слушает 3443" "systemctl restart nginx"
fi

# Проверка SSL сертификата
CERT_DIR="/etc/letsencrypt/live/izinet.online"
if [ -f "$CERT_DIR/fullchain.pem" ]; then
    EXPIRY=$(openssl x509 -enddate -noout -in "$CERT_DIR/fullchain.pem" 2>/dev/null | cut -d= -f2)
    check_ok "SSL сертификат существует (до: $EXPIRY)"
else
    check_fail "SSL сертификат НЕ найден в $CERT_DIR" "certbot certonly --standalone -d izinet.online -d www.izinet.online"
fi

# Проверка curl localhost:3443
CURL_3443=$(curl -sk -o /dev/null -w "%{http_code}" --connect-timeout 3 https://127.0.0.1:3443/ 2>/dev/null)
if [ "$CURL_3443" = "200" ] || [ "$CURL_3443" = "301" ] || [ "$CURL_3443" = "302" ]; then
    check_ok "curl localhost:3443 → HTTP $CURL_3443"
else
    check_fail "curl localhost:3443 → HTTP $CURL_3443 (сайт не отвечает)" "Проверить Nginx и SSL"
fi

# ─── 3. Reality inbound (порт 443) ────────────────────────────
section "3. Reality inbound (порт 443)"

if docker ps --format '{{.Names}}' | grep -q x3-ui; then
    REALITY_CHECK=$(docker exec x3-ui python3 -c "
import sqlite3, json, sys
try:
    conn = sqlite3.connect('/etc/x-ui/x-ui.db')
    c = conn.cursor()
    c.execute('SELECT id, port, settings, stream_settings, sniffing FROM inbounds WHERE port=443')
    row = c.fetchone()
    conn.close()
    if not row:
        print('MISSING')
        sys.exit(1)
    iid, port, sett_raw, stream_raw, sniff_raw = row
    ss = json.loads(stream_raw or '{}')
    sett = json.loads(sett_raw or '{}')
    snif = json.loads(sniff_raw or '{}')
    security = ss.get('security', 'none')
    if security != 'reality':
        print(f'WRONG_SECURITY:{security}')
        sys.exit(1)
    rs = ss.get('realitySettings', {})
    inner = rs.get('settings', rs)
    pbk = inner.get('publicKey', '') or rs.get('publicKey', '')
    sid = (inner.get('shortIds', rs.get('shortIds', [''])))[0] if isinstance(inner.get('shortIds', rs.get('shortIds', [])), list) else ''
    sni = inner.get('serverName', '') or (rs.get('serverNames', [''])[0] if rs.get('serverNames') else '')
    fp = inner.get('fingerprint', rs.get('fingerprint', ''))
    spx = inner.get('spiderX', rs.get('spiderX', ''))
    fb = sett.get('fallbacks', [])
    issues = []
    if not pbk or 'CXL0o8BEC7wz' in pbk or 'm_G-oZ_9a6' in pbk:
        issues.append(f'PUBLIC_KEY HARDCODED: {pbk[:20]}...')
    if fp and fp != 'chrome':
        issues.append(f'FINGERPRINT={fp} (should be chrome)')
    if 'microsoft.com' not in str(rs.get('serverNames', [])) and 'microsoft.com' not in str(inner.get('serverNames', [])):
        issues.append('ServerNames missing microsoft.com')
    if spx and spx != '/':
        issues.append(f'SPIDERX={spx} (should be /)')
    if not fb:
        issues.append('NO FALLBACK RULES!')
    if not snif.get('enabled'):
        issues.append('SNIFFING DISABLED!')
    if issues:
        print(f'ISSUES:{\";\".join(issues)}')
        sys.exit(2)
    print(f'OK:pbk={pbk[:15]}...;sni={sni};fp={fp};fb={len(fb)};sniff={snif.get(\"enabled\",False)}')
except Exception as e:
    print(f'ERROR:{e}')
    sys.exit(3)
" 2>/dev/null)

    case $? in
        0) check_ok "Reality inbound (порт 443): $(echo $REALITY_CHECK | sed 's/OK://')" ;;
        1) check_fail "Reality inbound: $REALITY_CHECK" "Запустить python3 xui_bootstrap.py --wait-db 5" ;;
        2) {
            IFS=';' read -ra ISSUES <<< "$(echo $REALITY_CHECK | sed 's/ISSUES://')"
            for issue in "${ISSUES[@]}"; do
                case $issue in
                    *HARDCODED*) check_fail "$issue" "В 3x-ui → vpn-main → Stream → Get New Cert" ;;
                    *FINGERPRINT*) check_warn "$issue" "В 3x-ui → vpn-main → Stream → uTLS → chrome" ;;
                    *microsoft.com*) check_warn "$issue" "В 3x-ui → vpn-main → Stream → Server Names → добавить microsoft.com" ;;
                    *SPIDERX*) check_warn "$issue" "В 3x-ui → vpn-main → Stream → SpiderX → /" ;;
                    *"NO FALLBACK"*) check_fail "$issue" "В 3x-ui → vpn-main → Protocol → добавить fallback rules" ;;
                    *SNIFFING*) check_fail "$issue" "В 3x-ui → vpn-main → Sniffing → включить" ;;
                    *) check_warn "$issue" "" ;;
                esac
            done
        } ;;
        *) check_warn "Не удалось проверить Reality inbound (контейнер не запущен?)" "" ;;
    esac
else
    check_fail "x3-ui не запущен — невозможно проверить Reality" ""
fi

# ─── 4. Fallback rules ────────────────────────────────────────
section "4. Fallback rules (Xray → Nginx)"

if docker ps --format '{{.Names}}' | grep -q x3-ui; then
    FB_CHECK=$(docker exec x3-ui python3 -c "
import sqlite3, json
conn = sqlite3.connect('/etc/x-ui/x-ui.db')
c = conn.cursor()
c.execute('SELECT settings FROM inbounds WHERE port=443')
row = c.fetchone()
conn.close()
if not row:
    print('NO_INBOUND')
else:
    sett = json.loads(row[0] or '{}')
    fb = sett.get('fallbacks', [])
    if not fb:
        print('NO_FALLBACKS')
    else:
        ok = True
        for f in fb:
            dest = f.get('dest', '')
            if '3443' not in dest:
                ok = False
                print(f'BAD_DEST:{dest}')
        if ok:
            print(f'OK:{len(fb)} rules → host.docker.internal:3443')
" 2>/dev/null)

    if echo "$FB_CHECK" | grep -q "^OK:"; then
        check_ok "Fallback: $FB_CHECK"
    elif echo "$FB_CHECK" | grep -q "NO_FALLBACKS"; then
        check_fail "Нет fallback rules в inbound" "В 3x-ui → vpn-main → Protocol → Fallbacks → добавить"
    elif echo "$FB_CHECK" | grep -q "BAD_DEST:"; then
        DEST=$(echo $FB_CHECK | cut -d: -f2)
        check_fail "Fallback dest НЕ на 3443: $DEST" "Изменить dest на host.docker.internal:3443"
    else
        check_warn "Не удалось проверить fallback" ""
    fi
fi

# ─── 5. Sniffing ──────────────────────────────────────────────
section "5. SNI Sniffing"

if docker ps --format '{{.Names}}' | grep -q x3-ui; then
    SNIFF_CHECK=$(docker exec x3-ui python3 -c "
import sqlite3, json
conn = sqlite3.connect('/etc/x-ui/x-ui.db')
c = conn.cursor()
c.execute('SELECT sniffing FROM inbounds WHERE port=443')
row = c.fetchone()
conn.close()
if not row:
    print('NO_INBOUND')
else:
    snif = json.loads(row[0] or '{}')
    enabled = snif.get('enabled', False)
    dest = snif.get('destOverride', [])
    route_only = snif.get('routeOnly', False)
    issues = []
    if not enabled: issues.append('disabled')
    if 'http' not in dest: issues.append('missing http')
    if 'tls' not in dest: issues.append('missing tls')
    if route_only: issues.append('routeOnly=true')
    if issues:
        print(f'ISSUES:{\";\".join(issues)}')
    else:
        print('OK:enabled;http+tls;routeOnly=false')
" 2>/dev/null)

    if echo "$SNIFF_CHECK" | grep -q "^OK:"; then
        check_ok "Sniffing: $SNIFF_CHECK"
    else
        check_fail "Sniffing: $(echo $SNIFF_CHECK | sed 's/ISSUES://')" "В 3x-ui → vpn-main → Sniffing → включить HTTP+TLS"
    fi
fi

# ─── 6. Xray template (Расш. шаблон) ─────────────────────────
section "6. Xray Template (Расш. шаблон)"

if docker ps --format '{{.Names}}' | grep -q x3-ui; then
    XRAY_CHECK=$(docker exec x3-ui python3 -c "
import sqlite3, json
conn = sqlite3.connect('/etc/x-ui/x-ui.db')
c = conn.cursor()
c.execute(\"SELECT value FROM settings WHERE key='xrayTemplateConfig'\")
row = c.fetchone()
conn.close()
if not row or not row[0] or row[0] == '{}':
    print('EMPTY')
else:
    cfg = json.loads(row[0])
    issues = []
    if 'dns' not in cfg: issues.append('NO_DNS')
    if 'outbounds' not in cfg: issues.append('NO_OUTBOUNDS')
    routing = cfg.get('routing', {})
    rules = routing.get('rules', [])
    has_api = any('api' in str(r.get('outboundTag', '')) for r in rules)
    if not has_api: issues.append('NO_API_RULE')
    if issues:
        print(f'ISSUES:{\";\".join(issues)}')
    else:
        print('OK:dns+outbounds+api_routing')
" 2>/dev/null)

    if echo "$XRAY_CHECK" | grep -q "^OK:"; then
        check_ok "Xray template: $XRAY_CHECK"
    elif echo "$XRAY_CHECK" | grep -q "EMPTY"; then
        check_warn "Xray template пуст (используются default настройки)" "Не критично если default настройки работают"
    else
        ISSUES=$(echo $XRAY_CHECK | sed 's/ISSUES://')
        if echo "$ISSUES" | grep -q "NO_DNS"; then
            check_fail "Xray template: НЕТ DNS секции" "Настройки Xray → Расш. шаблон → добавить DNS (8.8.8.8, 1.1.1.1)"
        fi
        if echo "$ISSUES" | grep -q "NO_OUTBOUNDS"; then
            check_warn "Xray template: нет outbounds" "Добавить default outbound"
        fi
    fi
fi

# ─── 7. Fallback из Docker ────────────────────────────────────
section "7. Fallback из Docker-контейнера"

if docker ps --format '{{.Names}}' | grep -q x3-ui; then
    docker exec x3-ui wget -qO- --no-check-certificate --spider --timeout=5 https://host.docker.internal:3443/ &>/dev/null
    if [ $? -eq 0 ]; then
        check_ok "host.docker.internal:3443 ДОСТУПЕН из x3-ui (fallback работает)"
    else
        check_fail "host.docker.internal:3443 НЕДОСТУПЕН из x3-ui" "Настройте Nginx на порту 3443 + UFW allow 3443"
    fi
fi

# ─── 8. Backend ───────────────────────────────────────────────
section "8. Backend (Express на порту 3005)"

BACKEND_CODE=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 3 http://127.0.0.1:3005/ 2>/dev/null)
if [ "$BACKEND_CODE" = "200" ] || [ "$BACKEND_CODE" = "304" ] || [ "$BACKEND_CODE" = "404" ]; then
    check_ok "Backend localhost:3005 → HTTP $BACKEND_CODE"
else
    check_fail "Backend localhost:3005 → HTTP $BACKEND_CODE (не отвечает)" "cd /opt/izinet && docker compose logs izinet-app | tail -20"
fi

# ─── 9. UFW ───────────────────────────────────────────────────
section "9. UFW Firewall"

if command -v ufw &>/dev/null; then
    UFW_STATUS=$(ufw status 2>/dev/null | head -1)
    if echo "$UFW_STATUS" | grep -q "active"; then
        check_ok "UFW активен"
        for PORT in 22 80 443 2053 3005 3443; do
            if ufw status | grep -q "${PORT}/tcp.*ALLOW"; then
                check_ok "Порт $PORT/tcp разрешён"
            else
                check_warn "Порт $PORT/tcp НЕ разрешён" "ufw allow ${PORT}/tcp"
            fi
        done
        if ufw status | grep -q "172.16.0.0/12.*3443.*ALLOW"; then
            check_ok "Docker subnet → 3443 разрешён"
        else
            check_warn "Docker subnet → 3443 НЕ разрешён" "ufw allow from 172.16.0.0/12 to any port 3443"
        fi
    else
        check_fail "UFW НЕ активен" "ufw --force enable"
    fi
else
    check_warn "UFW не установлен" "apt-get install ufw && ufw allow 22,80,443,2053,3005,3443/tcp && ufw enable"
fi

# ─── 10. DNS ──────────────────────────────────────────────────
section "10. DNS резолв"

DOMAIN_IP=$(dig +short izinet.online 2>/dev/null || nslookup izinet.online 2>/dev/null | grep "Address:" | tail -1 | awk '{print $2}')
SERVER_IP=$(curl -s ifconfig.me 2>/dev/null)

if [ -n "$DOMAIN_IP" ]; then
    if [ "$DOMAIN_IP" = "$SERVER_IP" ]; then
        check_ok "izinet.online → $DOMAIN_IP (совпадает с сервером)"
    else
        check_warn "izinet.online → $DOMAIN_IP (не совпадает с сервером $SERVER_IP)" "Проверьте DNS A-запись"
    fi
else
    check_fail "izinet.online НЕ резолвится" "Проверьте DNS A-запись в Cloudflare/регистраторе"
fi

# ─── 11. HTTPS (сайт без VPN) ────────────────────────────────
section "11. HTTPS (сайт без VPN)"

HTTPS_CODE=$(curl -sk -o /dev/null -w "%{http_code}" --connect-timeout 5 https://izinet.online/ 2>/dev/null)
if [ "$HTTPS_CODE" = "200" ] || [ "$HTTPS_CODE" = "301" ] || [ "$HTTPS_CODE" = "302" ]; then
    check_ok "https://izinet.online → HTTP $HTTPS_CODE (сайт работает!)"
else
    check_fail "https://izinet.online → HTTP $HTTPS_CODE (сайт НЕ работает без VPN)" "Исправить Nginx + fallback chain"
fi

# ─── 12. Логи ─────────────────────────────────────────────────
section "12. Последние ошибки в логах"

if docker ps --format '{{.Names}}' | grep -q x3-ui; then
    XRAY_ERRORS=$(docker logs --tail 30 x3-ui 2>&1 | grep -i "ERROR\|FATAL\|Failed to start" | tail -5)
    if [ -n "$XRAY_ERRORS" ]; then
        check_fail "Ошибки в логах x3-ui:" ""
        echo "$XRAY_ERRORS" | sed 's/^/           /'
    else
        check_ok "Нет критических ошибок в логах x3-ui"
    fi
fi

# ─── 13. Клиенты в inbound ────────────────────────────────────
section "13. Клиенты в Reality inbound"

if docker ps --format '{{.Names}}' | grep -q x3-ui; then
    CLIENT_CHECK=$(docker exec x3-ui python3 -c "
import sqlite3, json
conn = sqlite3.connect('/etc/x-ui/x-ui.db')
c = conn.cursor()
c.execute('SELECT settings FROM inbounds WHERE port=443')
row = c.fetchone()
conn.close()
if row:
    sett = json.loads(row[0] or '{}')
    clients = sett.get('clients', [])
    print(f'TOTAL:{len(clients)}')
    # Check for emails containing 'izinet_'
    izinet_clients = [cl for cl in clients if 'izinet_' in cl.get('email', '')]
    print(f'IZINET:{len(izinet_clients)}')
else:
    print('NO_INBOUND')
" 2>/dev/null)

    if echo "$CLIENT_CHECK" | grep -q "TOTAL:"; then
        TOTAL=$(echo $CLIENT_CHECK | grep "TOTAL:" | cut -d: -f2)
        IZINET=$(echo $CLIENT_CHECK | grep "IZINET:" | cut -d: -f2)
        check_ok "Клиентов в inbound: $TOTAL (из них izinet_: $IZINET)"
    fi
fi

# ─── СВОДКА ───────────────────────────────────────────────────
TOTAL=$((OK + FAIL + WARN))
echo ""
echo "═══════════════════════════════════════════════"
echo -e "  ${BOLD}ДИАГНОСТИКА ИЗИНЕТ — СВОДКА${NC}"
echo "═══════════════════════════════════════════════"
echo -e "  ${GREEN}✅ OK:     $OK из $TOTAL проверок${NC}"
echo -e "  ${RED}❌ FAIL:   $FAIL из $TOTAL проверок${NC}"
echo -e "  ${YELLOW}⚠️ WARN:   $WARN из $TOTAL проверок${NC}"
echo "═══════════════════════════════════════════════"

if [ $FAIL -gt 0 ]; then
    echo -e "  ${RED}СЕРЬЁЗНЫЕ ПРОБЛЕМЫ — сайт/VPN не работают${NC}"
    echo "  Исправьте все ❌ FAIL перед проверкой."
elif [ $WARN -gt 0 ]; then
    echo -e "  ${YELLOW}ЕСТЬ ЗАМЕЧАНИЯ — рекомендуется исправить${NC}"
else
    echo -e "  ${GREEN}ВСЁ ОТЛИЧНО — сайт и VPN должны работать!${NC}"
fi
echo "═══════════════════════════════════════════════"
echo ""
echo "Скопируйте весь вывод выше и скиньте для анализа."
