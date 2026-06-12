#!/bin/bash
# 🛠 IZINET — УНИВЕРСАЛЬНЫЙ УСТАНОВЩИК (CURL Ready)
# Предназначен для настройки НОВОГО сервера с нуля.

set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}====================================================${NC}"
echo -e "${GREEN}🚀 Начинаем установку IZINET (Версия 2026)${NC}"
echo -e "${BLUE}====================================================${NC}"

# 1. Проверка зависимостей
echo "🔍 Проверяю Docker..."
if ! command -v docker &> /dev/null; then
    echo "📦 Устанавливаю Docker и Docker Compose..."
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    sudo usermod -aG docker $USER
fi

# 2. Сбор данных
echo -e "\n${BLUE}📝 Настройка переменных окружения:${NC}"
read -p "Введите ваш домен (izinet.online): " DOMAIN
read -p "Supabase URL: " SB_URL
read -p "Supabase Anon Key: " SB_ANON
read -p "Supabase Service Key: " SB_SERVICE
read -p "Telegram Bot Token: " TG_TOKEN
read -p "Enot.io Merchant ID: " ENOT_ID
read -p "Enot.io Secret Key: " ENOT_SECRET

# 3. Создание .env
echo "🔑 Генерирую ключи и создаю .env..."
REALITY_PRIV_KEY=$(openssl rand -base64 32 | tr -d '/+' | cut -c1-43)
REALITY_PUB_KEY="CXL0o8BEC7wz-TIuA7w-QBbJIadSsb9xL7G6UB410Xw" # Пример или генерация

cat <<EOF > .env
DOMAIN=$DOMAIN
PUBLIC_URL=https://$DOMAIN
VITE_SUPABASE_URL=$SB_URL
VITE_SUPABASE_ANON_KEY=$SB_ANON
SUPABASE_SERVICE_ROLE_KEY=$SB_SERVICE
TELEGRAM_BOT_TOKEN=$TG_TOKEN
ENOT_MERCHANT_ID=$ENOT_ID
ENOT_SECRET_KEY=$ENOT_SECRET
ENOT_SECRET_KEY2=$ENOT_SECRET
XUI_REALITY_PRIV_KEY=$REALITY_PRIV_KEY
XUI_REALITY_PUB_KEY=$REALITY_PUB_KEY
XUI_USERNAME=admin
XUI_PASSWORD=admin
XUI_HOST=http://x3-ui:2053
NODE_ENV=production
IS_DOCKER=true
EOF

# 4. Настройка Nginx и SSL
echo "🔒 Настройка SSL и Nginx..."
sudo apt-get update && sudo apt-get install -y nginx certbot python3-certbot-nginx

# Остановка контейнеров для выпуска сертификата (порт 80)
docker compose stop || true
sudo certbot certonly --standalone -d $DOMAIN --non-interactive --agree-tos -m admin@$DOMAIN || true

# Создание конфига Nginx (Proxy на 3005 порт)
cat << NGINXEOF | sudo tee /etc/nginx/sites-available/izinet
server {
    listen 80;
    server_name $DOMAIN;
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl;
    server_name $DOMAIN;

    ssl_certificate /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3005;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
    }
}
NGINXEOF

sudo ln -sf /etc/nginx/sites-available/izinet /etc/nginx/sites-enabled/izinet
sudo rm -f /etc/nginx/sites-enabled/default
sudo systemctl restart nginx

# 5. Запуск системы
echo "🐳 Запускаю проект через Docker Compose..."
docker compose up -d --build

echo -e "\n${GREEN}✅ УСТАНОВКА ЗАВЕРШЕНА!${NC}"
echo -e "Сайт доступен по адресу: ${BLUE}https://$DOMAIN${NC}"
echo -e "Админка (пароль из базы): ${BLUE}https://$DOMAIN/admin${NC}"
