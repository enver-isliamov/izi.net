#!/bin/bash

# izinet Installer for VPS (Ubuntu/Debian)
# Этот скрипт устанавливает Docker, клонирует репозиторий и настраивает проект.

set -e

# Цвета для вывода
GREEN='\033[0;32m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 Начинаем установку izinet на ваш VPS...${NC}"

# 1. Обновление системы и установка зависимостей
echo "📦 Обновляем системные пакеты..."
sudo apt-get update && sudo apt-get install -y curl git jq

# 2. Установка Docker, если он не установлен
if ! [ -x "$(command -v docker)" ]; then
    echo "🐳 Устанавливаем Docker..."
    curl -fsSL https://get.docker.com -o get-docker.sh
    sudo sh get-docker.sh
    sudo usermod -aG docker $USER
fi

# Установка Docker Compose, если он не установлен
if ! [ -x "$(command -v docker-compose)" ]; then
    echo "🐳 Устанавливаем Docker Compose..."
    sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    sudo chmod +x /usr/local/bin/docker-compose
fi

# 3. Клонирование репозитория (если мы еще не в нем)
INSTALL_DIR="/opt/izinet"
if [ ! -f "docker-compose.yml" ]; then
    if [ ! -d "$INSTALL_DIR" ]; then
        echo "📂 Клонируем репозиторий в $INSTALL_DIR..."
        sudo mkdir -p $INSTALL_DIR
        sudo chown $USER:$USER $INSTALL_DIR
        git clone https://github.com/enver-isliamov/izi.net.git $INSTALL_DIR
    fi
    cd $INSTALL_DIR
fi

# 4. Настройка .env (Интерактивно)
ENV_NEEDS_CONFIG=false
if [ ! -f .env ]; then
    ENV_NEEDS_CONFIG=true
else
    # Проверяем, пустые ли ключевые переменные (это бывает, если первый запуск прошел без терминала)
    if grep -q "VITE_SUPABASE_URL=$" .env || [ -z "$(grep "VITE_SUPABASE_URL=" .env | cut -d'=' -f2-)" ]; then
        ENV_NEEDS_CONFIG=true
    fi
fi

if [ "$ENV_NEEDS_CONFIG" = "true" ]; then
    echo -e "${GREEN}⚙️ Настройка окружения. Нам нужны ваши ключи Supabase:${NC}"
    
    # Считываем данные с терминала напрямую
    read -p "Supabase URL (например, https://xxx.supabase.co): " SB_URL < /dev/tty
    read -p "Supabase Anon Key: " SB_ANON < /dev/tty
    read -p "Supabase Service Role Key: " SB_SERVICE < /dev/tty
    read -p "Telegram Bot Token: " TG_TOKEN < /dev/tty
    read -p "Telegram Bot Name (без @): " TG_NAME < /dev/tty

    cp .env.example .env
    
    # Используем '|' как разделитель в sed, чтобы избежать проблем с '/' в URL
    sed -i "s|VITE_SUPABASE_URL=.*|VITE_SUPABASE_URL=$SB_URL|" .env
    sed -i "s|VITE_SUPABASE_ANON_KEY=.*|VITE_SUPABASE_ANON_KEY=$SB_ANON|" .env
    sed -i "s|SUPABASE_SERVICE_ROLE_KEY=.*|SUPABASE_SERVICE_ROLE_KEY=$SB_SERVICE|" .env
    sed -i "s|TELEGRAM_BOT_TOKEN=.*|TELEGRAM_BOT_TOKEN=$TG_TOKEN|" .env
    sed -i "s|VITE_TELEGRAM_BOT_NAME=.*|VITE_TELEGRAM_BOT_NAME=$TG_NAME|" .env
    
    # Настройки для встроенного 3x-ui
    sed -i "s|XUI_HOST=.*|XUI_HOST=http://x3-ui:2053|" .env
    sed -i "s|XUI_USERNAME=.*|XUI_USERNAME=admin|" .env
    sed -i "s|XUI_PASSWORD=.*|XUI_PASSWORD=admin|" .env
    
    # Получаем IP сервера для VITE_API_URL
    SERVER_IP=$(curl -s https://ifconfig.me)
    sed -i "s|VITE_API_URL=.*|VITE_API_URL=http://$SERVER_IP:3005|" .env
else
    echo -e "${GREEN}✅ Файл .env уже настроен. Пропускаем шаг конфигурации.${NC}"
    echo -e "Если вы хотите перенастроить ключи, удалите файл .env на VPS (rm /opt/izinet/.env) и запустите скрипт заново."
fi

# 5. Запуск
echo -e "${GREEN}🚢 Запускаем контейнеры...${NC}"
docker-compose up -d --build

echo -e "${GREEN}✅ Готово! izinet запущен.${NC}"
echo -e "Дашборд доступен по адресу: http://$(curl -s ifconfig.me):3005"
echo -e "Панель 3x-ui: http://$(curl -s ifconfig.me):2053 (логин/пароль: admin/admin)"
echo -e "Не забудьте сменить стандартный пароль в панели 3x-ui!"
