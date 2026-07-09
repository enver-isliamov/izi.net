#!/bin/bash
# Исправление Hysteria2 — убираем ACME, используем self-signed

CONFIG="/etc/hysteria/config.yaml"
AUTH_PASS=$(grep "password:" $CONFIG | awk '{print $2}')

echo "=== Исправление Hysteria2 ==="

# 1. Останавливаем сервис
echo "[1/3] Остановка hysteria2..."
systemctl stop hysteria2

# 2. Перезаписываем конфиг без ACME
echo "[2/3] Обновление конфига..."
cat > ${CONFIG} << YAMLEOF
listen: :443

auth:
  type: password
  password: ${AUTH_PASS}

tls:
  cert: /etc/hysteria/cert.pem
  key: /etc/hysteria/key.pem

masquerade:
  type: proxy
  proxy:
    url: https://www.cloudflare.com
    rewriteHost: true
YAMLEOF

# Генерируем самоподписанный сертификат
echo "  Генерация самоподписанного сертификата..."
openssl req -x509 -newkey rsa:2048 -keyout /etc/hysteria/key.pem -out /etc/hysteria/cert.pem -days 3650 -nodes -subj "/CN=izinet.online" 2>/dev/null
echo "  ✅ Сертификат создан"

# 3. Запускаем
echo "[3/3] Запуск hysteria2..."
systemctl start hysteria2
sleep 2
systemctl status hysteria2 --no-pager | head -5

echo ""
echo "=== Готово ==="
echo "Пароль: ${AUTH_PASS}"
echo "Ссылка: hysteria2://${AUTH_PASS}@194.50.94.28:443?insecure=1#izinet-hysteria"
