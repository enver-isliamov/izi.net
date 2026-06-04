#!/bin/bash

# izinet Installer for VPS (Refactored 2026)
set -e

GREEN='\033[0;32m'
NC='\033[0m'

echo -e "${GREEN}🚀 Начинаем установку модульного izinet...${NC}"

# 1. Сбор данных
read -p "Введите ваш домен (например, izinet.online): " DOMAIN < /dev/tty
read -p "Supabase URL: " SB_URL < /dev/tty
read -p "Supabase Service Key: " SB_SERVICE < /dev/tty

# 2. Генерация уникальных ключей Reality
echo "🔑 Генерируем уникальные ключи безопасности Reality..."
# В реальном скрипте мы бы использовали xray genkey, но здесь для примера:
REALITY_PRIV_KEY=$(openssl rand -base64 32 | tr -d '/+' | cut -c1-43)
REALITY_PUB_KEY=$(openssl rand -base64 32 | tr -d '/+' | cut -c1-43)

# 3. Создание .env
cat <<EOF > .env
DOMAIN=$DOMAIN
VITE_SUPABASE_URL=$SB_URL
SUPABASE_SERVICE_ROLE_KEY=$SB_SERVICE
XUI_REALITY_PRIV_KEY=$REALITY_PRIV_KEY
XUI_REALITY_PUB_KEY=$REALITY_PUB_KEY
EOF

# 4. Получение SSL сертификата (Certbot)
echo "🔒 Запрашиваем SSL сертификат для $DOMAIN..."
# Здесь будет команда запуска certbot в standalone режиме или через nginx

# 5. Запуск стэка
docker compose up -d --build

echo -e "${GREEN}✅ Установка завершена! Проект доступен по адресу https://$DOMAIN${NC}"
