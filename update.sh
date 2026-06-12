#!/bin/bash
# 🚀 IZINET — УНИВЕРСАЛЬНЫЙ ОБНОВЛЯТОР (Termius One-Liner)
# Этот скрипт принудительно обновляет код, чинит .env и перезапускает Docker.

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

echo -e "${GREEN}🔄 Начинаю процесс принудительного обновления...${NC}"

# 1. Синхронизация с GitHub
echo "📡 Скачиваю свежий код из ветки main..."
git fetch origin main
git reset --hard origin/main

# 2. Чистка .env от мусора Windows
echo "🧹 Очищаю .env от невидимых символов..."
if [ -f .env ]; then
    sed -i 's/\r//' .env
    echo "✅ .env очищен."
else
    echo -e "${RED}⚠️ Файл .env не найден!${NC}"
fi

# 3. Перезапуск Docker с пересборкой
echo "🐳 Пересобираю и запускаю контейнеры..."
docker compose down
docker compose up -d --build

# 4. Проверка логов
echo -e "${GREEN}⏳ Жду 10 секунд для запуска...${NC}"
sleep 10
echo -e "${GREEN}📊 Статус контейнеров:${NC}"
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

echo ""
echo -e "${GREEN}✅ ОБНОВЛЕНИЕ ЗАВЕРШЕНО!${NC}"
echo "Логи приложения (последние 20 строк):"
docker logs --tail 20 izinet-app
