#!/bin/bash
set -euo pipefail

# Print banner
echo "=================================================="
echo " 🔍 IZINET DIAGNOSTIC SCRIPT (STABILITY ANALYSIS)"
echo "=================================================="
echo ""

# Ask for server name
read -p "Введите имя этого сервера (например, Amster или OneD): " SERVER_NAME
SERVER_NAME=${SERVER_NAME:-"vps"}
echo "Идентификатор сервера: $SERVER_NAME"

DIAG_DIR="/tmp/izinet_diag_${SERVER_NAME}"
rm -rf "$DIAG_DIR"
mkdir -p "$DIAG_DIR" "$DIAG_DIR/nginx" "$DIAG_DIR/docker" "$DIAG_DIR/xui"

echo "⚡ [1/7] Сбор информации о системе..."
{
  echo "=== Окружение и Ядро ==="
  uname -a
  echo "=== Дистрибутив ==="
  cat /etc/os-release
  echo "=== Uptime ==="
  uptime
  echo "=== Оперативная Память ==="
  free -m
  echo "=== Место на Диске ==="
  df -h
  echo "=== Настройки Ядра (BBR/TCP) ==="
  sysctl net.ipv4.tcp_congestion_control net.core.somaxconn fs.file-max 2>/dev/null || true
  echo "=== Лимиты процессов ==="
  ulimit -n
} > "$DIAG_DIR/system.txt"

echo "⚡ [2/7] Чтение сетевой конфигурации..."
{
  echo "=== Активные порты ==="
  if command -v ss &>/dev/null; then
    ss -tlnp
  elif command -v netstat &>/dev/null; then
    netstat -tlnp
  else
    echo "ss и netstat не найдены"
  fi
  echo "=== Брандмауэр UFW ==="
  if command -v ufw &>/dev/null; then
    ufw status verbose 2>/dev/null || true
  else
    echo "ufw не установлен"
  fi
  echo "=== Правила iptables ==="
  iptables -L -n -v 2>/dev/null || true
} > "$DIAG_DIR/network.txt"

echo "⚡ [3/7] Извлечение конфигурации панели 3x-ui..."
DB_PATH="/opt/izinet/xui-db/x-ui.db"
if [ -f "$DB_PATH" ]; then
  # Читаем общие настройки (webPort, base path, etc.)
  python3 -c "import sqlite3, json; conn=sqlite3.connect('$DB_PATH'); c=conn.cursor(); c.execute('SELECT key, value FROM settings'); print(json.dumps(dict(c.fetchall()), indent=2))" > "$DIAG_DIR/xui/settings.json" 2>/dev/null || echo "Ошибка Python sqlite настройки" > "$DIAG_DIR/xui/settings_error.txt"
  
  # Читаем inbounds (порты, лимиты, настройки, но маскируем пароли/id клиентов)
  python3 -c "import sqlite3, json; conn=sqlite3.connect('$DB_PATH'); c=conn.cursor(); c.execute('SELECT id, port, protocol, remark, enable, stream_settings FROM inbounds'); print(json.dumps([{'id':r[0],'port':r[1],'protocol':r[2],'remark':r[3],'enable':r[4],'stream_settings':json.loads(r[5]) if r[5] else {}} for r in c.fetchall()], indent=2))" > "$DIAG_DIR/xui/inbounds.json" 2>/dev/null || echo "Ошибка Python sqlite inbounds" > "$DIAG_DIR/xui/inbounds_error.txt"
else
  echo "БД x-ui.db не найдена по пути: $DB_PATH" > "$DIAG_DIR/xui/db_missing.txt"
fi

echo "⚡ [4/7] Чтение настроек Xray из контейнеров..."
if docker ps --format '{{.Names}}' | grep -q "x3-ui"; then
  docker exec x3-ui cat /etc/x-ui/config.json > "$DIAG_DIR/xui/xray_config_etc.json" 2>/dev/null || true
  docker exec x3-ui cat /bin/config.json > "$DIAG_DIR/xui/xray_config_bin.json" 2>/dev/null || true
else
  echo "Контейнер x3-ui не запущен" > "$DIAG_DIR/xui/xray_not_running.txt"
fi

echo "⚡ [5/7] Сбор конфигурации Nginx и Docker..."
for p in "/etc/nginx/sites-available/izinet" "/etc/nginx/sites-enabled/izinet" "/etc/nginx/nginx.conf"; do
  if [ -f "$p" ]; then
    cp "$p" "$DIAG_DIR/nginx/$(basename "$p")" 2>/dev/null || true
  fi
done

if [ -f "/opt/izinet/docker-compose.yml" ]; then
  cp "/opt/izinet/docker-compose.yml" "$DIAG_DIR/docker-compose.yml"
fi

{
  echo "=== Статус контейнеров ==="
  docker ps -a
  echo "=== Сети docker ==="
  docker network ls
  docker network inspect izinet_default 2>/dev/null || docker network inspect izinet 2>/dev/null || true
} > "$DIAG_DIR/docker/docker_info.txt"

echo "⚡ [6/7] Сбор последних логов..."
docker logs --tail 300 izinet-app > "$DIAG_DIR/docker/izinet-app.log" 2>/dev/null || true
docker logs --tail 300 x3-ui > "$DIAG_DIR/docker/x-ui_container.log" 2>/dev/null || true
journalctl -u nginx --no-pager -n 150 > "$DIAG_DIR/nginx/nginx_systemd.log" 2>/dev/null || true

echo "⚡ [7/7] Упаковка диагностического архива..."
ARCHIVE_NAME="izinet_diagnostics_${SERVER_NAME}.tar.gz"
ARCHIVE_PATH="/tmp/${ARCHIVE_NAME}"
tar -czf "$ARCHIVE_PATH" -C /tmp "izinet_diag_${SERVER_NAME}"
rm -rf "$DIAG_DIR"

echo ""
echo "==========================================================="
echo "🎉 СБОР ДАННЫХ ДЛЯ СЕРВЕРА $SERVER_NAME УСПЕШНО ЗАВЕРШЕН!"
echo "Файл сохранен: $ARCHIVE_PATH"
echo "==========================================================="
echo ""
echo "📤 ПОЛУЧЕНИЕ ФАЙЛА (СПОСОБЫ):"
echo "-----------------------------------------------------------"

# Try uploading to different secure exchange services to guarantee success
echo "🚀 Попытка автозагрузки (Способ А):"
UPLOAD_URL=""

# 1. PixelDrain
if command -v curl &>/dev/null; then
  echo "Загрузка на Pixeldrain..."
  PD_RESP=$(curl -s -F "file=@$ARCHIVE_PATH" "https://pixeldrain.com/api/file" || true)
  if echo "$PD_RESP" | grep -q "id"; then
    PD_ID=$(echo "$PD_RESP" | python3 -c "import sys, json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null || true)
    if [ ! -z "$PD_ID" ]; then
      UPLOAD_URL="https://pixeldrain.com/u/$PD_ID"
    fi
  fi
fi

# 2. file.io fallback
if [ -z "$UPLOAD_URL" ] && command -v curl &>/dev/null; then
  echo "Загрузка на file.io..."
  FIO_RESP=$(curl -s -F "file=@$ARCHIVE_PATH" "https://file.io/?expires=1d" || true)
  if echo "$FIO_RESP" | grep -q "success.*true"; then
    UPLOAD_URL=$(echo "$FIO_RESP" | python3 -c "import sys, json; print(json.load(sys.stdin).get('link',''))" 2>/dev/null || true)
  fi
fi

# 3. transfer.sh fallback
if [ -z "$UPLOAD_URL" ] && command -v curl &>/dev/null; then
  echo "Загрузка на transfer.sh..."
  UPLOAD_URL=$(curl -s -T "$ARCHIVE_PATH" "https://transfer.sh/$ARCHIVE_NAME" || true)
fi

if [ ! -z "$UPLOAD_URL" ]; then
  echo "✅ УСПЕХ! Ваша ссылка на диагностический архив:"
  echo "👉 $UPLOAD_URL"
  echo "Скопируйте ее и пришлите мне в чат!"
else
  echo "❌ Автозагрузка не удалась (ограничения сети сервера)."
fi

echo ""
echo "🌐 Локальное скачивание (Способ Б):"
echo "Запустим временный веб-сервер на вашем VPS."
PUB_IP=$(curl -s ifconfig.me || curl -s icanhazip.com || echo "IP_ВАШЕГО_СЕРВЕРА")
echo "1. Кликните по ссылке ниже:"
echo "   👉 http://$PUB_IP:8080/$ARCHIVE_NAME"
echo "2. Скачайте файл и загрузите его в наш чат через файл-скрепку."
echo "3. Вернитесь в терминал и нажмите Ctrl+C для выхода."
echo "-----------------------------------------------------------"
cd /tmp && python3 -m http.server 8080 || python3 -m SimpleHTTPServer 8080 || echo "Python не установлен."
