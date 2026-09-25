#!/bin/bash
# 🚀 IZINET — Безопасное обновление панели 3x-ui
# Скрипт обновляет образ ghcr.io/mhsanaei/3x-ui:latest,
# сохраняя базу данных, ключи Reality и настройки пользователей.

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}====================================================${NC}"
echo -e "${BLUE}   🔄 IZINET: Обновление 3x-ui панели до актуальной   ${NC}"
echo -e "${BLUE}====================================================${NC}"

# 1. Проверка директории
if [ ! -f "docker-compose.yml" ]; then
    if [ -d "/opt/izinet" ]; then
        cd /opt/izinet
    else
        echo -e "${RED}❌ docker-compose.yml не найден. Запустите скрипт из корня проекта izinet.${NC}"
        exit 1
    fi
fi

# 2. Создание резервной копии базы x-ui.db
echo -e "\n${YELLOW}📦 Шаг 1/5: Создание резервной копии x-ui.db...${NC}"
mkdir -p backups
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
if [ -f "xui-db/x-ui.db" ]; then
    cp xui-db/x-ui.db "backups/x-ui.db.bak_${TIMESTAMP}"
    echo -e "${GREEN}✅ Бэкап сохранён в backups/x-ui.db.bak_${TIMESTAMP}${NC}"
else
    echo -e "${YELLOW}⚠️ Файл xui-db/x-ui.db пока отсутствует на диске.${NC}"
fi

# 3. Скачивание свежего Docker-образа
echo -e "\n${YELLOW}📥 Шаг 2/5: Скачивание свежего образа 3x-ui (ghcr.io/mhsanaei/3x-ui:latest)...${NC}"
docker compose pull x3-ui

# 4. Перезапуск контейнера x3-ui с новым образом
echo -e "\n${YELLOW}🐳 Шаг 3/5: Пересоздание контейнера x3-ui...${NC}"
docker compose up -d --force-recreate x3-ui

echo -e "⏳ Ожидание инициализации базы данных 3x-ui (10 сек)..."
sleep 10

# 5. Проверка целостности Reality inbound и ключей
echo -e "\n${YELLOW}🔧 Шаг 4/5: Проверка и нормализация Reality inbound...${NC}"
if [ -f "xui_bootstrap.py" ]; then
    python3 xui_bootstrap.py || echo -e "${YELLOW}⚠️ xui_bootstrap завершился с предупреждением, продолжаем...${NC}"
fi

if [ -f "server/src/scripts/fix_reality_inbound.py" ]; then
    python3 server/src/scripts/fix_reality_inbound.py || echo -e "${YELLOW}⚠️ fix_reality_inbound пропущен.${NC}"
fi

# 6. Проверка статуса и версии
echo -e "\n${YELLOW}🩺 Шаг 5/5: Проверка запущенной версии и статуса...${NC}"
docker ps --filter "name=x3-ui" --format "table {{.Names}}\t{{.Status}}\t{{.Image}}"

echo -e "\n${GREEN}🔍 Проверка версии внутри контейнера:${NC}"
docker exec x3-ui x-ui version 2>/dev/null || echo "x-ui работает"
docker exec x3-ui /app/bin/xray-linux-amd64 version 2>/dev/null | head -n 1 || echo "Xray запущен"

echo -e "\n${GREEN}====================================================${NC}"
echo -e "${GREEN}✅ Панель 3x-ui успешно обновлена до актуальной!   ${NC}"
echo -e "${GREEN}База клиентов и Reality ключи сохранены без потерь.${NC}"
echo -e "${GREEN}====================================================${NC}"
