#!/bin/bash
# IZINET — Исправление Hysteria2 (self-signed сертификат)
# Запускать если Hysteria2 не стартует из-за проблем с сертификатом

set -e

CONFIG_DIR="/etc/hysteria"
CONFIG="${CONFIG_DIR}/config.yaml"

echo "=== IZINET: Исправление Hysteria2 ==="

# Проверяем установлен ли
if ! command -v hysteria2 &>/dev/null; then
  echo "❌ Hysteria2 не установлен. Запусти: bash install_hysteria.sh"
  exit 1
fi

# Сохраняем текущий пароль
AUTH_PASS=$(grep "password:" $CONFIG 2>/dev/null | awk '{print $2}' | tr -d '"' | tr -d "'")
if [ -z "$AUTH_PASS" ]; then
  AUTH_PASS="izinet-$(openssl rand -hex 16)"
  echo "⚠️ Пароль не найден, сгенерирован новый: ${AUTH_PASS}"
fi

# 1. Останавливаем сервис
echo "[1/4] Остановка hysteria2..."
systemctl stop hysteria2 2>/dev/null || true

# 2. Генерируем сертификат
echo "[2/4] Генерация сертификата..."
mkdir -p ${CONFIG_DIR}
openssl req -x509 -newkey rsa:2048 -keyout ${CONFIG_DIR}/key.pem -out ${CONFIG_DIR}/cert.pem -days 3650 -nodes -subj "/CN=izinet.online" 2>/dev/null
echo "  ✅ Сертификат создан"

# 3. Перезаписываем конфиг
echo "[3/4] Обновление конфига..."
cat > ${CONFIG} << YAMLEOF
listen: :443

tls:
  cert: ${CONFIG_DIR}/cert.pem
  key: ${CONFIG_DIR}/key.pem

auth:
  type: password
  password: ${AUTH_PASS}

masquerade:
  type: proxy
  proxy:
    url: https://www.cloudflare.com
    rewriteHost: true
YAMLEOF

echo "  ✅ Конфиг обновлен"

# 4. Запускаем
echo "[4/4] Запуск hysteria2..."
systemctl daemon-reload
systemctl enable hysteria2 2>/dev/null || true
systemctl start hysteria2
sleep 2

STATUS=$(systemctl is-active hysteria2)
echo ""
echo "=== ГОТОВО ==="
echo "Статус: ${STATUS}"
echo "Порт: 443/udp"
echo "Пароль: ${AUTH_PASS}"
echo ""
echo "Ссылка: hysteria2://${AUTH_PASS}@194.50.94.28:443?insecure=1#izinet-hysteria"

if [ "$STATUS" != "active" ]; then
  echo ""
  echo "❌ Hysteria2 не запустился. Логи:"
  journalctl -u hysteria2 -n 20 --no-pager
fi
