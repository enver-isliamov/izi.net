#!/bin/bash
# izinet VPS Diagnostic Tool
# This script inspects the VPS networks, docker containers, sqlite settings, SSL certificates, and local ports.

echo "============================================="
echo "🔍 НАЧАЛО ДИАГНОСТИКИ СЕРВЕРА IZINET"
echo "============================================="
echo "Текущее время: $(date)"
echo ""

# 1. Проверка существования и контента БД X-UI
echo "--- 📦 1. Конфигурация Панели 3x-ui (SQLite DB) ---"
DB_PATH="/opt/izinet/xui-db/x-ui.db"
if [ -f "$DB_PATH" ]; then
    echo "✅ Файл базы данных найден: $DB_PATH"
    
    # Пытаемся найти sqlite3 на хосте, если нет, пробуем выполнить sqlite3 внутри контейнера x3-ui
    if command -v sqlite3 &> /dev/null; then
        echo "Порт, базовый путь и сертификаты из базы настроек:"
        sqlite3 "$DB_PATH" "SELECT key, value FROM settings WHERE key IN ('webPort', 'webBasePath', 'webCertFile', 'webKeyFile');"
    else
        echo "sqlite3 не установлен на хосте. Пробуем получить данные через Docker контейнер x3-ui..."
        docker exec x3-ui sqlite3 /etc/x-ui/x-ui.db "SELECT key, value FROM settings WHERE key IN ('webPort', 'webBasePath', 'webCertFile', 'webKeyFile');" 2>/dev/null || echo "❌ Не удалось прочитать БД даже через докер."
    fi
else
    echo "❌ Файл базы данных x-ui.db по пути $DB_PATH НЕ найден!"
fi
echo ""

# 2. Проверка SSL Сертификатов
echo "--- 🔑 2. Наличие SSL Сертификатов на хосте ---"
CERT_DIR="/opt/izinet/xui-cert"
if [ -d "$CERT_DIR" ]; then
    echo "Содержимое папки сертификатов $CERT_DIR:"
    ls -la "$CERT_DIR"
else
    echo "❌ Директория сертификатов $CERT_DIR НЕ найдена!"
fi
echo ""

# 3. Анализ локальной доступности портов (curl на localhost)
echo "--- 🔌 3. Проверка доступности веб-сервисов (локальный curl) ---"

echo "Бекенд (изнутри хоста, порт 3005):"
curl -Is http://127.0.0.1:3005 | head -n 1 || echo "❌ Бекенд на порту 3005 не отвечает"

echo "Панель 3x-ui по умолчанию (порт 2053):"
curl -Is http://127.0.0.1:2053 | head -n 1 || echo "❌ Панель на порту 2053 не отвечает через HTTP"
curl -Is -k https://127.0.0.1:2053 | head -n 1 || echo "❌ Панель на порту 2053 не отвечает через HTTPS"

echo "Панель 3x-ui кастомная (порт 41758):"
curl -Is http://127.0.0.1:41758 | head -n 1 || echo "❌ Панель на порту 41758 не отвечает через HTTP"
curl -Is -k https://127.0.0.1:41758 | head -n 1 || echo "❌ Панель на порту 41758 не отвечает через HTTPS"
echo ""

# 4. Проверка DNS домена izinet.online
echo "--- 🌐 4. Проверка DNS Домена izinet.online ---"
echo "Куда резолвится ваш домен на самом сервере:"
nslookup izinet.online 2>/dev/null || host izinet.online 2>/dev/null || ping -c 1 -t 1 izinet.online 2>/dev/null || echo "❌ DNS утилиты недоступны или домен не резолвится"
echo "Внешний IP сервера (определено через Ifconfig): $(curl -s ifconfig.me)"
echo ""

# 5. Изучаем серое облако Cloudflare (проверка хоста сайта)
echo "--- ☁️ 5. Проверка заголовков и доступности через DNS ---"
echo "Проверка HTTP на порту 80:"
curl -Is http://izinet.online/ | head -n 5 || echo "❌ http://izinet.online/ недоступен"
echo "Проверка HTTPS на порту 443:"
curl -Is -k https://izinet.online/ | head -n 5 || echo "❌ https://izinet.online/ недоступен"
echo ""

# 6. Чтение последних строк логов приложений
echo "--- ⚠️ 6. Последние 15 строк логов приложений ---"
echo ">>> ЛОГИ izinet-app:"
docker logs --tail 15 izinet-app
echo ""
echo ">>> ЛОГИ x3-ui:"
docker logs --tail 15 x3-ui
echo "============================================="
echo "🏁 ДИАГНОСТИКА ЗАВЕРШЕНА. Скопируйте этот вывод в чат!"
echo "============================================="
