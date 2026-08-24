#!/bin/bash
# 🔧 СКРИПТ ДЛЯ СОЗДАНИЯ ПРАВИЛЬНОГО .env
# ТРЕБУЕТСЯ ЗАПОЛНИТЬ ЗНАЧЕНИЯ ВЗ КОНФИГУРАЦИИ!

set -e

cd /opt/izinet || exit 1

echo "════════════════════════════════════════════════════════════════"
echo "📝 ГЕНЕРАЦИЯ ПРАВИЛЬНОГО .env"
echo "════════════════════════════════════════════════════════════════"
echo ""

# === ШАГИ ПОДГОТОВКИ ===
echo "⚠️  ПЕРЕД ЗАПУСКОМ УБЕДИТЕСЬ ЧТО У ВАС ЕСТЬ:"
echo "  1. Supabase Project URL (из Dashboard → Settings)"
echo "  2. Supabase ANON KEY"
echo "  3. Supabase SERVICE_ROLE KEY"
echo "  4. Telegram Bot TOKEN"
echo "  5. ENOT.io Merchant ID и Secret Keys"
echo "  6. Пароль 3x-ui панели (admin по умолчанию)"
echo ""

# === BACKUP ===
if [ -f .env ]; then
    echo "📦 Резервная копия текущего .env..."
    cp .env .env.bak.$(date +%s)
    echo "   ✅ Сохранено как .env.bak.*"
fi

echo ""
echo "🤖 Генерирую НОВЫЙ .env..."
echo ""

# Читаем значения (или используем переменные окружения если установлены)
read -p "Supabase URL (без https://) [${SUPABASE_URL:-}]: " SUPABASE_URL
SUPABASE_URL="${SUPABASE_URL:-$SUPABASE_URL}"

read -sp "Supabase ANON KEY: " ANON_KEY
echo ""

read -sp "Supabase SERVICE_ROLE KEY: " SERVICE_KEY
echo ""

read -p "Domain [izinet.online]: " DOMAIN
DOMAIN="${DOMAIN:-izinet.online}"

read -p "Telegram Bot TOKEN: " TELEGRAM_TOKEN
read -p "Telegram Bot Username (без @): " TELEGRAM_BOT_NAME

read -p "3x-UI Password [${XUI_PASSWORD:-admin}]: " XUI_PASSWORD
XUI_PASSWORD="${XUI_PASSWORD:-admin}"

read -p "ENOT Merchant ID: " ENOT_MERCHANT_ID
read -sp "ENOT Secret Key 1: " ENOT_SECRET_1
echo ""
read -sp "ENOT Secret Key 2: " ENOT_SECRET_2
echo ""

# === ГЕНЕРАЦИЯ REALITY КЛЮЧЕЙ ===
echo ""
echo "🔐 Генерирую Reality ключи через x3-ui..."

if ! docker ps | grep -q "x3-ui"; then
    echo "❌ x3-ui контейнер не найден!"
    echo "   Запусти сначала: docker compose up -d"
    exit 1
fi

KEYS=$(docker exec x3-ui xray x25519 2>/dev/null)
PRIV_KEY=$(echo "$KEYS" | grep "Private key" | cut -d: -f2 | xargs)
PUB_KEY=$(echo "$KEYS" | grep "Public key" | cut -d: -f2 | xargs)

echo "✅ Ключи сгенерированы"
echo "   Приватный: ${PRIV_KEY:0:20}..."
echo "   Публичный: ${PUB_KEY:0:20}..."

# === СОЗДАНИЕ .env ===
cat > .env << EOF
# === SUPABASE ===
VITE_SUPABASE_URL=https://${SUPABASE_URL}.supabase.co
VITE_SUPABASE_ANON_KEY=${ANON_KEY}
SUPABASE_SERVICE_ROLE_KEY=${SERVICE_KEY}

# === ДОМЕН ===
DOMAIN=${DOMAIN}
PUBLIC_URL=https://${DOMAIN}

# === TELEGRAM BOT ===
TELEGRAM_BOT_TOKEN=${TELEGRAM_TOKEN}
VITE_TELEGRAM_BOT_NAME=${TELEGRAM_BOT_NAME}

# === 3X-UI ===
XUI_HOST=http://x3-ui:2053
XUI_USERNAME=admin
XUI_PASSWORD=${XUI_PASSWORD}
XUI_INBOUND_ID=1

# === REALITY KEYS (СВЕЖИЕ) ===
XUI_REALITY_PRIV_KEY=${PRIV_KEY}
XUI_REALITY_PUB_KEY=${PUB_KEY}

# === ПЛАТЕЖИ ===
ENOT_MERCHANT_ID=${ENOT_MERCHANT_ID}
ENOT_SECRET_KEY=${ENOT_SECRET_1}
ENOT_SECRET_KEY2=${ENOT_SECRET_2}

# === NODE ===
NODE_ENV=production
EOF

echo ""
echo "✅ .env СОЗДАН!"
echo ""
echo "Проверка:"
echo "  Переменных в .env: $(grep -c '^[A-Z_]' .env)"
echo "  Supabase URL: $(grep VITE_SUPABASE_URL .env | cut -d= -f2)"
echo "  Domain: $(grep DOMAIN .env | grep -v VITE)"
echo "  Reality PubKey: ${PUB_KEY:0:30}..."
echo ""
echo "════════════════════════════════════════════════════════════════"

