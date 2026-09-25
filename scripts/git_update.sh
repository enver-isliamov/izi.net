#!/bin/bash
# 🚀 IZINET — Полное обновление проекта из GitHub ветки main
# Выполняет синхронизацию, чистку и запуск update.sh

set -e

PROJECT_DIR="/opt/izinet"
if [ ! -d "$PROJECT_DIR" ]; then
    PROJECT_DIR="$(pwd)"
fi

cd "$PROJECT_DIR"

mkdir -p backups
LOG_FILE="backups/git_update.log"

echo "====================================================" | tee "$LOG_FILE"
echo "🚀 [$(date '+%Y-%m-%d %H:%M:%S')] СТАРТ ОБНОВЛЕНИЯ ИЗ GITHUB" | tee -a "$LOG_FILE"
echo "Команда: cd /opt/izinet && git fetch origin main && git reset --hard origin/main && bash update.sh" | tee -a "$LOG_FILE"
echo "====================================================" | tee -a "$LOG_FILE"

echo "📡 1/4: Загрузка свежего кода (git fetch origin main)..." | tee -a "$LOG_FILE"
git fetch origin main 2>&1 | tee -a "$LOG_FILE"

echo "🔄 2/4: Сброс локальной ветки (git reset --hard origin/main)..." | tee -a "$LOG_FILE"
git reset --hard origin/main 2>&1 | tee -a "$LOG_FILE"

echo "⚙️ 3/4: Запуск процедуры обновления и сборки контейнеров (bash update.sh)..." | tee -a "$LOG_FILE"
bash update.sh 2>&1 | tee -a "$LOG_FILE"

echo "====================================================" | tee -a "$LOG_FILE"
echo "🎉 [$(date '+%Y-%m-%d %H:%M:%S')] ОБНОВЛЕНИЕ ИЗ GITHUB УСПЕШНО ЗАВЕРШЕНО!" | tee -a "$LOG_FILE"
echo "====================================================" | tee -a "$LOG_FILE"
