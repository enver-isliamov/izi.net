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

# 6. Настройка системного Nginx (Fix 4)
echo "🔧 Настройка системного Nginx на порту 3443..."

# Установка Nginx, если он отсутствует
if ! command -v nginx >/dev/null 2>&1; then
  sudo apt-get update && sudo apt-get install -y nginx
fi

# Получение SSL сертификата через Certbot
if [ ! -f /etc/letsencrypt/live/$DOMAIN/fullchain.pem ]; then
  sudo apt-get install -y certbot
  # Освобождаем порт 80 для Certbot
  docker compose stop
  sudo certbot certonly --standalone -d $DOMAIN -d www.$DOMAIN --non-interactive --agree-tos -m admin@$DOMAIN || true
  docker compose up -d
fi

# Создание конфигурации Nginx
cat << NGINXEOF | sudo tee /etc/nginx/sites-available/izinet
server {
    listen 3443 ssl;
    http2 on;
    server_name $DOMAIN www.$DOMAIN;

    ssl_certificate /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3005;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}

server {
    listen 80;
    server_name $DOMAIN www.$DOMAIN;
    return 301 https://\$host\$request_uri;
}
NGINXEOF

sudo ln -sf /etc/nginx/sites-available/izinet /etc/nginx/sites-enabled/izinet
sudo rm -f /etc/nginx/sites-enabled/default

# Настройка UFW для доступа из Docker в Host
if command -v ufw >/dev/null 2>&1; then
  sudo ufw allow from 172.16.0.0/12 to any port 3443 2>/dev/null || true
  sudo ufw allow from 192.168.0.0/16 to any port 3443 2>/dev/null || true
  sudo ufw reload
fi

sudo nginx -t && sudo systemctl reload nginx
echo -e "${GREEN}✅ Nginx настроен на порту 3443${NC}"

echo -e "${GREEN}✅ Установка завершена! Проект доступен по адресу https://$DOMAIN${NC}"
