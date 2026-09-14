#!/bin/bash
# IZINET — Быстрая установка Hysteria2 на сервер
# Запустить на сервере через SSH: bash setup_hysteria_on_server.sh

set -e

echo "=========================================="
echo "  IZINET: Установка Hysteria2 (UDP)"
echo "=========================================="
echo ""

# Проверяем ROOT
if [ "$EUID" -ne 0 ]; then
  echo "❌ Запусти от root: sudo bash setup_hysteria_on_server.sh"
  exit 1
fi

# Проверяем архитектуру
ARCH=$(uname -m)
echo "Архитектура: $ARCH"
echo ""

# Копируем скрипты из репозитория (если есть)
SCRIPT_DIR="/opt/izinet"
if [ -d "$SCRIPT_DIR" ]; then
  echo "📁 Репозиторий найден: $SCRIPT_DIR"
  cp "$SCRIPT_DIR/install_hysteria.sh" /tmp/ 2>/dev/null || true
  cp "$SCRIPT_DIR/fix_hysteria.sh" /tmp/ 2>/dev/null || true
  cp "$SCRIPT_DIR/diag_hysteria.sh" /tmp/ 2>/dev/null || true
  chmod +x /tmp/install_hysteria.sh /tmp/fix_hysteria.sh /tmp/diag_hysteria.sh 2>/dev/null || true
fi

# Запускаем установку
echo "🚀 Запуск установки..."
echo ""
if [ -f /tmp/install_hysteria.sh ]; then
  bash /tmp/install_hysteria.sh
else
  echo "❌ Скрипт установки не найден. Скачай из репозитория."
  exit 1
fi

echo ""
echo "=========================================="
echo "  УСТАНОВКА ЗАВЕРШЕНА"
echo "=========================================="
echo ""
echo "Следующие шаги:"
echo "1. Перейди в админку izinet.online/admin"
echo "2. Раздел 'Hysteria2 (UDP)' покажет статус"
echo "3. Пароль уже сохранен в Supabase"
echo "4. Ссылка для клиента будет показана в админке"
echo ""
echo "Для диагностики: bash diag_hysteria.sh"
echo "Для исправления: bash fix_hysteria.sh"
