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

# 4. Исправление SQLite (Reality ключи, fallbacks, xrayTemplateConfig)
echo "🔧 Запускаю xui_bootstrap.py..."
sleep 3
python3 xui_bootstrap.py || echo "⚠️ Bootstrap failed, continuing..."

# 4a. Исправление Reality inbound — serverNames + dest
echo "🔧 Исправляю Reality inbound (serverNames, dest)..."
python3 server/src/scripts/fix_reality_inbound.py || echo "⚠️ Reality fix skipped"

# 4b. Патчинг routing rules в xrayTemplateConfig (напрямую в SQLite)
echo "🔧 Патчинг routing rules..."
python3 server/src/scripts/patch_xray_routing.py || echo "⚠️ Routing patch skipped"

# 4b. Создание Reality+WebSocket inbound (если ещё нет)
echo "🔌 Проверяю Reality+WebSocket inbound..."
bash add_reality_ws.sh || echo "⚠️ Reality+WS setup skipped"

# 4c. Скачивание geo файлов — ОТКЛЮЧЕНО (volume mount убивает Xray binary)
# echo "📥 Скачиваю geo файлы (geosite.dat, geoip.dat)..."
# bash download_geo.sh || echo "⚠️ Geo download skipped"

# 5. Перезапуск x3-ui чтобы перечитать SQLite и geo файлы
echo "🔄 Перезапускаю x3-ui..."
docker restart x3-ui
sleep 15

# 5a. Патчинг routing rules напрямую в config.json (обход бага 3x-ui)
echo "🔧 Патчинг routing rules в xray config..."
docker cp /opt/izinet/server/src/scripts/patch_xray_config.py x3-ui:/tmp/patch_xray_config.py 2>/dev/null
docker exec x3-ui python3 /tmp/patch_xray_config.py 2>/dev/null || echo "⚠️ Routing patch skipped"

# 5b. Перезапуск x3-ui чтобы применить patched config
echo "🔄 Финальный перезапуск x3-ui..."
docker restart x3-ui
echo "⏳ Жду x3-ui (20 сек)..."
sleep 20

# 6. Запуск Nginx (fallback для сайта)
echo "🌐 Проверяю Nginx..."
if command -v nginx &> /dev/null; then
    systemctl start nginx 2>/dev/null || true
    systemctl enable nginx 2>/dev/null || true
    echo "✅ Nginx запущен."
else
    echo "⚠️ Nginx не установлен."
fi

# 7. UFW порты (всегда открывать при обновлении)
echo "🔥 Проверяю UFW порты..."
if command -v ufw &> /dev/null; then
    ufw allow 22/tcp 2>/dev/null || true
    ufw allow 80/tcp 2>/dev/null || true
    ufw allow 443/tcp 2>/dev/null || true
    ufw allow 2053/tcp 2>/dev/null || true
    ufw allow 3005/tcp 2>/dev/null || true
    ufw allow 3443/tcp 2>/dev/null || true
    ufw allow 2087/tcp 2>/dev/null || true
    ufw allow from 172.16.0.0/12 to any port 3443 2>/dev/null || true
    ufw reload 2>/dev/null || true
    echo "✅ UFW порты обновлены."
else
    echo "⚠️ UFW не установлен, пропускаю."
fi

# 8. Перегенерация VPN-ссылок — НЕ НУЖНА, backend делает это автоматически при старте
# regenerateAllVlessLinks() вызывается в index.ts через 15 сек после boot
echo "🔗 VPN-ссылки будут перегенерированы автоматически при старте backend..."

# 9. Проверка логов
echo -e "${GREEN}⏳ Жду 5 секунд для финализации...${NC}"
sleep 5
echo -e "${GREEN}📊 Статус контейнеров:${NC}"
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

echo ""
echo -e "${GREEN}✅ ОБНОВЛЕНИЕ ЗАВЕРШЕНО!${NC}"
echo "Логи приложения (последние 20 строк):"
docker logs --tail 20 izinet-app
