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

# 4a. Патчинг routing rules в xrayTemplateConfig (напрямую в SQLite)
echo "🔧 Патчинг routing rules..."
python3 server/src/scripts/patch_xray_routing.py || echo "⚠️ Routing patch skipped"

# 4b. Создание Reality+WebSocket inbound (если ещё нет)
echo "🔌 Проверяю Reality+WebSocket inbound..."
bash add_reality_ws.sh || echo "⚠️ Reality+WS setup skipped"

# 5. Перезапуск x3-ui чтобы перечитать SQLite
echo "🔄 Перезапускаю x3-ui..."
docker restart x3-ui
sleep 5

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
    ufw allow from 172.16.0.0/12 to any port 3443 2>/dev/null || true
    ufw reload 2>/dev/null || true
    echo "✅ UFW порты обновлены."
else
    echo "⚠️ UFW не установлен, пропускаю."
fi

# 8. Перегенерация VPN-ссылок (чтобы VLESS ссылки в Supabase совпадали с текущими Reality ключами)
echo "🔗 Перегенерирую VPN-ссылки..."
sleep 10
REGEN_RESULT=$(curl -s -X POST http://localhost:3005/api/admin/system/regenerate-all-links \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(curl -s -X POST http://localhost:3005/api/supabase-proxy/auth/v1/token?grant_type=password \
    -H "Content-Type: application/json" \
    -H "apikey: ${VITE_SUPABASE_ANON_KEY}" \
    -d "{\"email\":\"${ADMIN_EMAIL:-admin@izinet.online}\",\"password\":\"${ADMIN_PASSWORD:-admin}\"}" 2>/dev/null | python3 -c 'import sys,json;print(json.load(sys.stdin).get("access_token",""))' 2>/dev/null)" 2>/dev/null)
echo "Результат: $REGEN_RESULT"

# 9. Проверка логов
echo -e "${GREEN}⏳ Жду 5 секунд для финализации...${NC}"
sleep 5
echo -e "${GREEN}📊 Статус контейнеров:${NC}"
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

echo ""
echo -e "${GREEN}✅ ОБНОВЛЕНИЕ ЗАВЕРШЕНО!${NC}"
echo "Логи приложения (последние 20 строк):"
docker logs --tail 20 izinet-app
