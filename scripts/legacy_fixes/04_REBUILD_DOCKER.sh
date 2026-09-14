#!/bin/bash
# 🐳 СКРИПТ ДЛЯ ПЕРЕСБОРКИ DOCKER И ПЕРЕЗАПУСКА

set -e

cd /opt/izinet || exit 1

echo "════════════════════════════════════════════════════════════════"
echo "🐳 ПЕРЕСБОРКА И ПЕРЕЗАПУСК DOCKER"
echo "════════════════════════════════════════════════════════════════"
echo ""

echo "📋 Текущее состояние:"
docker ps

echo ""
echo "🛑 Останавливаю контейнеры..."
docker compose down

echo ""
echo "🧹 Очищаю неиспользуемые образы..."
docker image prune -f

echo ""
echo "📦 Собираю свежий образ izinet-app..."
docker compose build --no-cache izinet-app

echo ""
echo "🚀 Запускаю контейнеры..."
docker compose up -d

echo ""
echo "⏳ Жду 30 секунд для стартапа..."
sleep 30

echo ""
echo "📊 Статус контейнеров:"
docker ps

echo ""
echo "🔴 Логи app (последние 30 строк):"
docker logs --tail 30 izinet-app 2>&1

echo ""
echo "════════════════════════════════════════════════════════════════"
echo "✅ ПЕРЕСБОРКА ЗАВЕРШЕНА"
echo "════════════════════════════════════════════════════════════════"

