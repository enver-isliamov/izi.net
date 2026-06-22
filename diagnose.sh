#!/bin/bash
# izinet VPS Diagnostic Tool
# This script inspects the VPS networks, docker containers, sqlite settings, SSL certificates, and local ports.

echo "============================================="
echo "🔍 НАЧАЛО ДИАГНОСТИКИ СЕРВЕРА IZINET"
echo "============================================="
echo "Текущее время: $(date)"
echo ""

# 1. Проверка существования и контента БД X-UI
echo "--- 📦 1. Конфигурация Панели 3x-ui (SQLite DB) ---"
DB_PATH="/opt/izinet/xui-db/x-ui.db"
if [ -f "$DB_PATH" ]; then
    echo "✅ Файл базы данных найден: $DB_PATH"
    
    # Пытаемся найти sqlite3 на хосте, если нет — используем Python, который гарантированно есть на VPS
    if command -v sqlite3 &> /dev/null; then
        echo "Порт, базовый путь и сертификаты из базы настроек:"
        sqlite3 "$DB_PATH" "SELECT key, value FROM settings WHERE key IN ('webPort', 'webBasePath', 'webCertFile', 'webKeyFile');"
    else
        echo "sqlite3 не установлен на хосте. Извлекаем данные конфигурации с помощью Python3..."
        python3 -c "import sqlite3; conn=sqlite3.connect('$DB_PATH'); c=conn.cursor(); c.execute(\"SELECT key, value FROM settings WHERE key IN ('webPort', 'webBasePath', 'webCertFile', 'webKeyFile');\"); print('\n'.join(f'  🔹 {r[0]}: {r[1]}' for r in c.fetchall()))" 2>/dev/null || {
            echo "Пробуем прочитать через докер..."
            docker exec x3-ui sqlite3 /etc/x-ui/x-ui.db "SELECT key, value FROM settings WHERE key IN ('webPort', 'webBasePath', 'webCertFile', 'webKeyFile');" 2>/dev/null || echo "❌ Не удалось прочитать БД даже через докер."
        }
    fi
else
    echo "❌ Файл базы данных x-ui.db по пути $DB_PATH НЕ найден!"
fi
echo ""

# 2. Проверка SSL Сертификатов
echo "--- 🔑 2. Наличие SSL Сертификатов на хосте ---"
CERT_DIR="/opt/izinet/xui-cert"
if [ -d "$CERT_DIR" ]; then
    echo "Содержимое папки сертификатов $CERT_DIR:"
    ls -la "$CERT_DIR"
else
    echo "❌ Директория сертификатов $CERT_DIR НЕ найдена!"
fi
echo ""

# 2.5 Вывод конфигурационных файлов Nginx для детального анализа
echo "--- 📄 2.5 Конфигурационные файлы Nginx ---"
NGINX_CONF_PATHS=(
    "/etc/nginx/sites-available/izinet"
    "/etc/nginx/sites-enabled/izinet"
    "/etc/nginx/nginx.conf"
)
for p in "${NGINX_CONF_PATHS[@]}"; do
    if [ -f "$p" ]; then
        echo "📂 Файл конфигурации: $p"
        echo "----------------------------------------------------"
        cat "$p" | grep -v '^\s*#' | grep -v '^\s*$' # убираем пустые строки и комментарии для чистоты
        echo "----------------------------------------------------"
    else
        echo "⚠️  Файл конфигурации $p не найден."
    fi
    echo ""
done

# 2.6 Проверка запущенных процессов на ключевых портах
echo "--- 🔌 2.6 Проверка процессов на портах (443, 3443, 3005, 2053) ---"
if command -v ss &>/dev/null; then
    ss -tlnp | grep -E "(:443|:3443|:3005|:2053)" || echo "⚠️ Не удалось получить список портов через ss (возможно, нет прав root)"
elif command -v netstat &>/dev/null; then
    netstat -tlnp | grep -E "(:443|:3443|:3005|:2053)" || echo "⚠️ Не удалось получить список портов через netstat"
else
    echo "⚠️ ss и netstat отсутствуют на хосте."
fi
echo ""

# 2.7 Проверка Reality Inbound и ключей
echo "--- 🔐 2.7 Проверка Reality Inbound (порт 443) ---"
if docker ps | grep -q "x3-ui"; then
    REALITY_CHECK=$(docker exec x3-ui python3 -c "
import sqlite3, json, sys
try:
    conn = sqlite3.connect('/etc/x-ui/x-ui.db')
    c = conn.cursor()
    c.execute(\"SELECT id, port, settings, stream_settings, sniffing FROM inbounds WHERE port=443\")
    row = c.fetchone()
    conn.close()
    if not row:
        print('MISSING: No inbound on port 443')
        sys.exit(1)
    iid, port, sett_raw, stream_raw, sniff_raw = row
    ss = json.loads(stream_raw or '{}')
    sett = json.loads(sett_raw or '{}')
    snif = json.loads(sniff_raw or '{}')
    security = ss.get('security', 'none')
    if security != 'reality':
        print(f'WRONG_SECURITY: {security} (expected reality)')
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
    if not pbk or 'm_G-oZ_9a6' in pbk: issues.append('publicKey empty/invalid')
    if not sid: issues.append('shortIds empty')
    if not sni or sni.replace('.','').isdigit(): issues.append(f'SNI invalid: {sni}')
    if fp and fp != 'chrome': issues.append(f'fingerprint={fp} (should be chrome)')
    if spx and spx != '/': issues.append(f'spiderX={spx} (should be /)')
    if not fb: issues.append('NO fallback rules!')
    if not snif.get('enabled'): issues.append('SNI sniffing disabled!')
    dests = [f.get('dest','') for f in fb]
    if fb and not any('3443' in d for d in dests): issues.append(f'fallback dest missing :3443')
    if issues:
        print(f'ISSUES: {\";\".join(issues)}')
        sys.exit(2)
    print(f'OK: pbk={pbk[:15]}... sni={sni} fp={fp} spx={spx} fb={len(fb)} sniff={snif.get(\"enabled\",False)}')
except Exception as e:
    print(f'ERROR: {e}')
    sys.exit(3)
" 2>/dev/null)

    case $? in
        0) echo "  🟢 Reality Inbound: $REALITY_CHECK" ;;
        1) echo "  🔴 Reality Inbound: $REALITY_CHECK" ;;
        2) echo "  🟡 Reality Inbound: $REALITY_CHECK" ;;
        3) echo "  🔴 Reality Inbound: $REALITY_CHECK" ;;
        *) echo "  ⚠️ Could not check Reality inbound" ;;
    esac

    # Проверка что ключи в БД не являются хардкод
    KNOWN_BAD_PUB="CXL0o8BEC7wz-TIuA7w-QBbJIadSsb9xL7G6UB410Xw"
    ACTUAL_PUB=$(docker exec x3-ui python3 -c "
import sqlite3, json
conn = sqlite3.connect('/etc/x-ui/x-ui.db')
c = conn.cursor()
c.execute(\"SELECT stream_settings FROM inbounds WHERE port=443\")
row = c.fetchone()
conn.close()
if row:
    ss = json.loads(row[0] or '{}')
    rs = ss.get('realitySettings', {})
    inner = rs.get('settings', rs)
    print(inner.get('publicKey', '') or rs.get('publicKey', ''))
" 2>/dev/null)

    if [ "$ACTUAL_PUB" = "$KNOWN_BAD_PUB" ]; then
        echo "  🔴 CRITICAL: Reality public key is HARDCODED (known insecure!)"
        echo "     Run: python3 xui_bootstrap.py --wait-db 5"
    elif [ -n "$ACTUAL_PUB" ]; then
        echo "  ✅ Reality public key is unique: ${ACTUAL_PUB:0:20}..."
    fi
else
    echo "  ❌ x3-ui контейнер не запущен!"
fi
echo ""

# 3. Анализ локальной доступности портов (curl на localhost)
echo "--- 🔌 3. Проверка доступности веб-сервисов (локальный curl) ---"

# 3.2 Чтение конфигурации Xray из панели 3x-ui
echo "--- ⚙️ 3.2 Конфигурация Xray (config.json внутри контейнера) ---"
if docker ps | grep -q "x3-ui"; then
    echo "Содержимое config.json (основная часть VLESS):"
    docker exec x3-ui cat /etc/x-ui/config.json 2>/dev/null | python3 -c '
import sys, json
try:
    data = json.load(sys.stdin)
    inbounds = data.get("inbounds", [])
    for ib in inbounds:
        if ib.get("port") == 443:
            print(json.dumps(ib, indent=2))
except Exception as e:
    print("Ошибка чтения /etc/x-ui/config.json:", e)
' 2>/dev/null || {
    docker exec x3-ui cat /bin/config.json 2>/dev/null | python3 -c '
import sys, json
try:
    data = json.load(sys.stdin)
    inbounds = data.get("inbounds", [])
    for ib in inbounds:
        if ib.get("port") == 443:
            print(json.dumps(ib, indent=2))
except Exception as e:
    print("Ошибка чтения /bin/config.json:", e)
' 2>/dev/null
}
fi
echo ""

echo "Бекенд (изнутри хоста, порт 3005):"
curl -Is http://127.0.0.1:3005 | head -n 1 || echo "❌ Бекенд на порту 3005 не отвечает"

echo "Панель 3x-ui по умолчанию (порт 2053):"
curl -Is http://127.0.0.1:2053 | head -n 1 || echo "❌ Панель на порту 2053 не отвечает через HTTP"
curl -Is -k https://127.0.0.1:2053 | head -n 1 || echo "❌ Панель на порту 2053 не отвечает через HTTPS"

echo "Панель 3x-ui кастомная (порт 41758):"
curl -Is http://127.0.0.1:41758 | head -n 1 || echo "❌ Панель на порту 41758 не отвечает через HTTP"
curl -Is -k https://127.0.0.1:41758 | head -n 1 || echo "❌ Панель на порту 41758 не отвечает через HTTPS"
echo ""

# 3.5 Проверка обратной связи изнутри контейнера Docker x3-ui на порт SSL-декриптора (3443)
echo "--- 🐳 3.5 Проверка доступности хоста из контейнера x3-ui (Reality Fallback) ---"
if docker ps | grep -q "x3-ui"; then
    echo "Контейнер x3-ui запущен. Проверяем резолв host.docker.internal..."
    docker exec x3-ui ping -c 1 -W 2 host.docker.internal &>/dev/null
    if [ $? -eq 0 ]; then
        echo "  ✅ host.docker.internal успешно резолвится внутри контейнера!"
    else
        echo "  ⚠️ ПРИМЕЧАНИЕ: Стандартный ping внутри x3-ui заблокирован или не резолвится."
    fi

    echo "Проверяем подключение на порт 3443 изнутри контейнера (wget/nc)..."
    docker exec x3-ui wget -qO- --no-check-certificate --spider --timeout=3 https://host.docker.internal:3443/ &>/dev/null
    if [ $? -eq 0 ]; then
        echo "  🟢 [Внутриконтейнерный тест]: ДОСТУПЕН! Контейнер x3-ui видит хост-порт 3443 (Nginx ssl_decrypt). Поток Fallback будет работать идеально!"
    else
        echo "  🔴 [Внутриконтейнерный тест]: ОШИБКА! x3-ui НЕ может достучаться до host.docker.internal:3443"
        echo "     Это означает, что Reality Fallback НЕ сможет передавать веб-трафик на сайт при входе в личный кабинет через https на порту 443!"
        echo "     Возможные причины: "
        echo "     1. UFW или iptables блокирует соединения из docker на хост (проверьте правила ufw и разрешите ufw allow 3443/tcp)."
        echo "     2. Nginx на хосте не слушает порт 3443 со всех адресов (убедитесь, что там listen 3443 ssl, а не 127.0.0.1:3443)."
    fi
else
    echo "❌ Контейнер x3-ui НЕ запущен!"
fi
echo ""

# 4. Проверка DNS домена izinet.online
echo "--- 🌐 4. Проверка DNS Домена izinet.online ---"
echo "Куда резолвится ваш домен на самом сервере:"
nslookup izinet.online 2>/dev/null || host izinet.online 2>/dev/null || ping -c 1 -t 1 izinet.online 2>/dev/null || echo "❌ DNS утилиты недоступны или домен не резолвится"
echo "Внешний IP сервера (определено через Ifconfig): $(curl -s ifconfig.me)"
echo ""

# 5. Изучаем серое облако Cloudflare (проверка хоста сайта)
echo "--- ☁️ 5. Проверка заголовков и доступности через DNS ---"
echo "Проверка HTTP на порту 80:"
curl -Is http://izinet.online/ | head -n 5 || echo "❌ http://izinet.online/ недоступен"
echo "Проверка HTTPS на порту 443:"
curl -Is -k https://izinet.online/ | head -n 5 || echo "❌ https://izinet.online/ недоступен"
echo ""

# 6. Чтение последних строк логов приложений
echo "--- ⚠️ 6. Последние 15 строк логов приложений ---"
echo ">>> ЛОГИ izinet-app:"
docker logs --tail 15 izinet-app
echo ""
echo ">>> ЛОГИ x3-ui:"
docker logs --tail 15 x3-ui
echo "============================================="
echo "🏁 ДИАГНОСТИКА ЗАВЕРШЕНА. Скопируйте этот вывод в чат!"
echo "============================================="
