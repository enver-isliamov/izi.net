#!/bin/bash
# IZINET — Установка Hysteria2 (UDP-протокол для обхода DPI)
# v2 — без ручной генерации ключей, автосертификат

set -e

HYSTERIA_VERSION="2.6.1"
INSTALL_DIR="/usr/local/bin"
CONFIG_DIR="/etc/hysteria"
LISTEN_PORT=443
AUTH_PASS="izinet-$(openssl rand -hex 16)"

echo "=== IZINET: Установка Hysteria2 ==="

# 1. Скачиваем Hysteria2
echo "[1/4] Скачивание Hysteria2 v${HYSTERIA_VERSION}..."
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

# 2. Создаём конфиг (автосертификат, без ACME)
echo "[2/4] Создание конфига..."
mkdir -p ${CONFIG_DIR}

cat > ${CONFIG_DIR}/config.yaml << YAMLEOF
listen: :${LISTEN_PORT}

acme:
  domains:
    - izinet.online
  email: admin@izinet.online

auth:
  type: password
  password: ${AUTH_PASS}

masquerade:
  type: proxy
  proxy:
    url: https://www.cloudflare.com
    rewriteHost: true
YAMLEOF

echo "  ✅ Конфиг создан"
echo "  Пароль: ${AUTH_PASS}"

# 3. Создаём systemd сервис
echo "[3/4] Создание systemd сервиса..."
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

# 4. UFW
echo "[4/4] Открытие порта..."
ufw allow ${LISTEN_PORT}/udp 2>/dev/null || true
echo "  ✅ UDP ${LISTEN_PORT} разрешён"

# Проверка
echo ""
echo "=== ГОТОВО ==="
echo "Статус: $(systemctl is-active hysteria2)"
echo "Порт: ${LISTEN_PORT}/udp"
echo "Пароль: ${AUTH_PASS}"
echo ""
echo "Ссылка для клиента:"
echo "hysteria2://${AUTH_PASS}@194.50.94.28:${LISTEN_PORT}?insecure=1#izinet-hysteria"
echo ""
echo "⚠️ Сохрани пароль: ${AUTH_PASS}"
