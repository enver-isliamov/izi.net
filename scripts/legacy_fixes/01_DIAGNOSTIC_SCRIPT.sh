#!/bin/bash
# 📊 ДИАГНОСТИЧЕСКИЙ СКРИПТ ДЛЯ IZINET
# Используй: bash 01_DIAGNOSTIC_SCRIPT.sh > diagnostic_report.txt 2>&1

set -e

echo "════════════════════════════════════════════════════════════════"
echo "🔍 ДИАГНОСТИКА IZINET"
echo "════════════════════════════════════════════════════════════════"
echo "Дата: $(date)"
echo "Хост: $(hostname)"
echo ""

cd /opt/izinet || exit 1

# 1. Контейнеры
echo "[1] DOCKER PS:"
docker ps -a

echo ""
echo "[2] ПОЛНЫЕ ЛОГИ APP (100 строк):"
docker logs --tail 100 izinet-app 2>&1 || echo "Контейнер не найден"

echo ""
echo "[3] ТОЛЬКО ОШИБКИ:"
docker logs izinet-app 2>&1 | grep -iE "error|cannot|undefined|is not|failed|exception|fatal|refuse" | head -20

echo ""
echo "[4] .ENV ПРОВЕРКА:"
if [ -f .env ]; then
    echo "✅ .env существует"
    echo "Переменные (без значений):"
    grep "^[A-Z_]" .env | cut -d= -f1
    echo ""
    echo "Суммарно: $(grep -c '^[A-Z_]' .env) переменных"
else
    echo "❌ .env НЕ НАЙДЕН"
fi

echo ""
echo "[5] ПОПЫТКА КУРЛА:"
curl -v http://localhost:3005/api/subscription/plans 2>&1 | head -50

echo ""
echo "[6] СЕТЕВЫЕ ИНТЕРФЕЙСЫ КОНТЕЙНЕРА:"
docker inspect izinet-app 2>/dev/null | grep -A5 '"Networks"' || echo "Ошибка инспекции"

echo ""
echo "════════════════════════════════════════════════════════════════"
echo "✅ КОНЕЦ ДИАГНОСТИКИ"
echo "════════════════════════════════════════════════════════════════"

