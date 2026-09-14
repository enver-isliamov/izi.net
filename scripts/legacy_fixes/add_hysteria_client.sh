#!/bin/bash
# IZINET — Добавление клиента Hysteria2

CONFIG="/etc/hysteria/config.yaml"

if [ ! -f "$CONFIG" ]; then
  echo "ОШИБКА: Hysteria2 не установлен. Сначала запусти install_hysteria.sh"
  exit 1
fi

AUTH_PASS=$(grep "password:" $CONFIG | awk '{print $2}')
CLIENT_NAME=${1:-"client-$(openssl rand -hex 4)}"

echo "=== Добавление клиента Hysteria2 ==="
echo "Имя: ${CLIENT_NAME}"
echo ""

# Генерируем ссылку
LINK="hysteria2://${AUTH_PASS}@194.50.94.28:443?insecure=1#${CLIENT_NAME}"

echo "Ссылка для клиента:"
echo "${LINK}"
echo ""
echo "Настройки вручную:"
echo "  Адрес: 194.50.94.28"
echo "  Порт: 443"
echo "  Пароль: ${AUTH_PASS}"
echo "  SNI: izinet.online (или любой whitelisted домен)"
echo "  Insecure: да (для теста)"
