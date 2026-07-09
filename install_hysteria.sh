#!/bin/bash
# IZINET — Установка Hysteria2 (UDP-протокол для обхода DPI)
# Работает РЯДОМ с Xray на том же порту 443 (TCP vs UDP)

set -e

HYSTERIA_VERSION="2.6.1"
INSTALL_DIR="/usr/local/bin"
CONFIG_DIR="/etc/hysteria"
LISTEN_PORT=443

echo "=== IZINET: Установка Hysteria2 ==="

# 1. Скачиваем Hysteria2
echo "[1/5] Скачивание Hysteria2 v${HYSTERIA_VERSION}..."
ARCH=$(uname -m)
case $ARCH in
  x86_64)  ARCH_NAME="amd64" ;;
  aarch64) ARCH_NAME="arm64" ;;
  armv7l)  ARCH_NAME="armv7" ;;
  *) echo "  ОШИБКА: Архитектура $ARCH не поддерживается"; exit 1 ;;
esac

URL="https://github.com/apernet/hysteria/releases/download/app%2Fv${HYSTERIA_VERSION}/hysteria-linux-${ARCH_NAME}"
curl -sL "$URL" -o /tmp/hysteria
chmod +x /tmp/hysteria
mv /tmp/hysteria ${INSTALL_DIR}/hysteria2
echo "  ✅ Hysteria2 установлен: $(hysteria2 version 2>/dev/null || echo 'ok')"

# 2. Генерируем ключи
echo "[2/5] Генерация ключей..."
mkdir -p ${CONFIG_DIR}
hysteria2 genkey > ${CONFIG_DIR}/server.key 2>/dev/null
cat ${CONFIG_DIR}/server.key > ${CONFIG_DIR}/server.pub
# pub ключ генерируется из приватного
PUB_KEY=$(hysteria2 genkey --public ${CONFIG_DIR}/server.key 2>/dev/null || echo "")
if [ -z "$PUB_KEY" ]; then
  # Альтернативный способ
  PUB_KEY=$(openssl pkey -in ${CONFIG_DIR}/server.key -pubout 2>/dev/null | tail -n +2 | tr -d '\n' || echo "")
fi
echo "  Public Key: ${PUB_KEY:0:30}..."

# 3. Создаём конфиг
echo "[3/5] Создание конфига..."
cat > ${CONFIG_DIR}/config.yaml << YAMLEOF
listen: :${LISTEN_PORT}

tls:
  cert: /etc/letsencrypt/live/izinet.online/fullchain.pem
  key: /etc/letsencrypt/live/izinet.online/privkey.pem

auth:
  type: password
  password: izinet-hysteria-$(openssl rand -hex 8)

masquerade:
  type: proxy
  proxy:
    url: https://www.cloudflare.com
    rewriteHost: true
YAMLEOF

# Читаем пароль
AUTH_PASS=$(grep "password:" ${CONFIG_DIR}/config.yaml | awk '{print $2}')
echo "  ✅ Конфиг создан"
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

# 5. UFW
echo "[5/5] Открытие порта..."
ufw allow ${LISTEN_PORT}/udp 2>/dev/null || true
echo "  ✅ UDP ${LISTEN_PORT} разрешён"

# Проверка
echo ""
echo "=== ГОТОВО ==="
echo "Статус: $(systemctl is-active hysteria2)"
echo "Порт: ${LISTEN_PORT}/udp"
echo "Пароль: ${AUTH_PASS}"
echo ""
echo "Ссылка для клиента (пример):"
echo "hysteria2://${AUTH_PASS}@194.50.94.28:${LISTEN_PORT}?insecure=1#izinet-hysteria"
echo ""
echo "⚠️ Сохрани пароль: ${AUTH_PASS}"
