#!/bin/bash
# IZINET — Установка Hysteria2 (UDP-протокол для обхода DPI)
# v3 — self-signed сертификат, автосохранение пароля в Supabase

set -e

HYSTERIA_VERSION="2.6.1"
INSTALL_DIR="/usr/local/bin"
CONFIG_DIR="/etc/hysteria"
CERT_DIR="/etc/hysteria"
LISTEN_PORT=443
AUTH_PASS="izinet-$(openssl rand -hex 16)"

echo "=== IZINET: Установка Hysteria2 ==="

# 0. Проверяем, не установлен ли уже
if command -v hysteria2 &>/dev/null; then
  echo "⚠️ Hysteria2 уже установлен: $(hysteria2 version 2>&1 | head -1)"
  echo "  Если хотите переустановить, удалите: rm ${INSTALL_DIR}/hysteria2"
  echo "  И запустите этот скрипт снова."
  exit 0
fi

# 1. Скачиваем Hysteria2
echo "[1/5] Скачивание Hysteria2 v${HYSTERIA_VERSION}..."
ARCH=$(uname -m)
case $ARCH in
  x86_64)  ARCH_NAME="amd64" ;;
  aarch64) ARCH_NAME="arm64" ;;
  *) echo "  ОШИБКА: Архитектура $ARCH не поддерживается"; exit 1 ;;
esac

URL="https://github.com/apernet/hysteria/releases/download/app%2Fv${HYSTERIA_VERSION}/hysteria-linux-${ARCH_NAME}"
curl -sL "$URL" -o /tmp/hysteria
chmod +x /tmp/hysteria
mv /tmp/hysteria ${INSTALL_DIR}/hysteria2
${INSTALL_DIR}/hysteria2 version
echo "  ✅ Hysteria2 установлен"

# 2. Генерируем self-signed сертификат (надежнее ACME)
echo "[2/5] Генерация сертификата..."
mkdir -p ${CERT_DIR}
openssl req -x509 -newkey rsa:2048 -keyout ${CERT_DIR}/key.pem -out ${CERT_DIR}/cert.pem -days 3650 -nodes -subj "/CN=izinet.online" 2>/dev/null
echo "  ✅ Сертификат создан: ${CERT_DIR}/cert.pem"

# 3. Создаём конфиг
echo "[3/5] Создание конфига..."
cat > ${CONFIG_DIR}/config.yaml << YAMLEOF
listen: :${LISTEN_PORT}

tls:
  cert: ${CERT_DIR}/cert.pem
  key: ${CERT_DIR}/key.pem

auth:
  type: password
  password: ${AUTH_PASS}

masquerade:
  type: proxy
  proxy:
    url: https://www.cloudflare.com
    rewriteHost: true
YAMLEOF

echo "  ✅ Конфиг создан: ${CONFIG_DIR}/config.yaml"
echo "  Пароль: ${AUTH_PASS}"

# 4. Создаём systemd сервис
echo "[4/5] Создание systemd сервиса..."
cat > /etc/systemd/system/hysteria2.service << 'EOF'
[Unit]
Description=Hysteria2 Proxy
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/hysteria2 server -c /etc/hysteria/config.yaml
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable hysteria2
systemctl start hysteria2
echo "  ✅ Hysteria2 запущен"

# 5. Открываем порт
echo "[5/5] Открытие порта..."
ufw allow ${LISTEN_PORT}/udp 2>/dev/null || true
echo "  ✅ UDP ${LISTEN_PORT} разрешён"

# Сохраняем пароль в Supabase (если доступен)
echo ""
echo "=== Сохранение пароля в Supabase ==="
if [ -f /opt/izinet/.env ]; then
  source /opt/izinet/.env 2>/dev/null || true
fi

if [ -n "$VITE_SUPABASE_URL" ] && [ -n "$SUPABASE_SERVICE_ROLE_KEY" ]; then
  RESULT=$(curl -s -X POST "${VITE_SUPABASE_URL}/rest/v1/settings" \
    -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Content-Type: application/json" \
    -H "Prefer: resolution=merge-duplicates" \
    -d "{\"key\":\"HYSTERIA_PASSWORD\",\"value\":\"${AUTH_PASS}\"}" 2>&1)
  
  if echo "$RESULT" | grep -q "HYSTERIA_PASSWORD"; then
    echo "  ✅ Пароль сохранен в Supabase"
  else
    echo "  ⚠️ Не удалось сохранить в Supabase: $RESULT"
    echo "  Сохраните пароль вручную через админку или SQL:"
    echo "    INSERT INTO settings (key, value) VALUES ('HYSTERIA_PASSWORD', '${AUTH_PASS}');"
  fi
else
  echo "  ⚠️ Supabase не настроен. Сохраните пароль вручную:"
  echo "    INSERT INTO settings (key, value) VALUES ('HYSTERIA_PASSWORD', '${AUTH_PASS}');"
fi

# Проверка
echo ""
echo "=== ГОТОВО ==="
echo "Статус: $(systemctl is-active hysteria2)"
echo "Порт: ${LISTEN_PORT}/udp"
echo "Пароль: ${AUTH_PASS}"
echo ""
echo "Ссылка для клиента:"
echo "  hysteria2://${AUTH_PASS}@194.50.94.28:${LISTEN_PORT}?insecure=1#izinet-hysteria"
echo ""
echo "⚠️ ВАЖНО: Сохрани пароль! Он понадобится для подключения клиентов."
echo ""
echo "Для диагностики запусти: bash diag_hysteria.sh"
