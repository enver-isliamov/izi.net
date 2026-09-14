#!/usr/bin/env bash
# ==============================================================================
# IZINET BACKUP SCRIPT (3x-ui SQLite + Hysteria2 + Environment)
# ==============================================================================
set -e

BACKUP_DIR="/opt/izinet_backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
ARCHIVE_NAME="izinet_backup_${TIMESTAMP}.tar.gz"

mkdir -p "${BACKUP_DIR}"
TEMP_STAGE="/tmp/izinet_backup_${TIMESTAMP}"
mkdir -p "${TEMP_STAGE}"

echo "📦 [1/4] Копирование базы 3x-ui (SQLite)..."
if [ -f "/etc/x-ui/x-ui.db" ]; then
    cp "/etc/x-ui/x-ui.db" "${TEMP_STAGE}/"
elif [ -f "./x-ui.db" ]; then
    cp "./x-ui.db" "${TEMP_STAGE}/"
fi

echo "📦 [2/4] Копирование конфигурации Hysteria 2..."
if [ -f "/etc/hysteria/config.yaml" ]; then
    cp "/etc/hysteria/config.yaml" "${TEMP_STAGE}/"
fi

echo "📦 [3/4] Копирование переменных окружения (.env)..."
if [ -f ".env" ]; then
    cp ".env" "${TEMP_STAGE}/"
fi

echo "🗜️ [4/4] Создание сжатого архива..."
tar -czf "${BACKUP_DIR}/${ARCHIVE_NAME}" -C "${TEMP_STAGE}" .
rm -rf "${TEMP_STAGE}"

echo "✅ Бэкап успешно создан: ${BACKUP_DIR}/${ARCHIVE_NAME}"
ls -lh "${BACKUP_DIR}/${ARCHIVE_NAME}"
