#!/bin/bash
# ✅ ПОЛНАЯ ПРОВЕРКА СИСТЕМЫ

set -e

cd /opt/izinet || exit 1

echo "════════════════════════════════════════════════════════════════"
echo "✅ FULL HEALTH CHECK — ПОЛНАЯ ПРОВЕРКА IZINET"
echo "════════════════════════════════════════════════════════════════"
echo ""

PASS=0
FAIL=0

# Функция для результата
check() {
    local name="$1"
    local result="$2"
    if [ "$result" = "1" ]; then
        echo "  ✅ $name"
        ((PASS++))
    else
        echo "  ❌ $name"
        ((FAIL++))
    fi
}

# 1. Docker контейнеры
echo "🐳 DOCKER КОНТЕЙНЕРЫ:"
RUNNING_APP=$(docker ps | grep -c "izinet-app" || echo 0)
check "izinet-app работает" "$RUNNING_APP"

RUNNING_X3UI=$(docker ps | grep -c "x3-ui" || echo 0)
check "x3-ui работает" "$RUNNING_X3UI"

echo ""
echo "🌐 СЕТЕВАЯ ДОСТУПНОСТЬ:"

# 2. API на порту 3005
API_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3005/api/subscription/plans || echo "000")
if [ "$API_RESPONSE" = "200" ]; then
    check "API /api/subscription/plans доступен" 1
else
    check "API /api/subscription/plans доступен (код: $API_RESPONSE)" 0
fi

# 3. Nginx на 3443
NGINX_RESPONSE=$(curl -sk -o /dev/null -w "%{http_code}" https://localhost:3443/ || echo "000")
if [ "$NGINX_RESPONSE" != "000" ]; then
    check "Nginx на порту 3443 отвечает" 1
else
    check "Nginx на порту 3443 отвечает" 0
fi

# 4. Docker fallback
echo ""
echo "🔗 FALLBACK (Docker → Nginx → App):"
FALLBACK=$(docker exec x3-ui wget -qO- --no-check-certificate --spider --timeout=5 https://host.docker.internal:3443/ 2>&1 | grep -c "200\|Spider" || echo 0)
if [ "$FALLBACK" -gt 0 ]; then
    check "Fallback работает" 1
else
    check "Fallback работает" 0
fi

# 5. Reality keys
echo ""
echo "🔐 REALITY КЛЮЧИ:"
DB_PUB=$(sqlite3 /opt/izinet/xui-db/x-ui.db \
    "SELECT json_extract(stream_settings, '$.realitySettings.publicKey') FROM inbounds WHERE port=443 LIMIT 1" 2>/dev/null || echo "NOT_FOUND")
ENV_PUB=$(grep "XUI_REALITY_PUB_KEY=" .env | cut -d= -f2 || echo "NOT_FOUND")

if [ "$DB_PUB" = "$ENV_PUB" ] && [ "$DB_PUB" != "NOT_FOUND" ]; then
    check "Public keys совпадают" 1
    echo "    Key: ${DB_PUB:0:30}..."
else
    check "Public keys совпадают" 0
    echo "    DB:  ${DB_PUB:0:30}..."
    echo "    ENV: ${ENV_PUB:0:30}..."
fi

# 6. .env файл
echo ""
echo "📝 КОНФИГУРАЦИЯ:"
ENV_COUNT=$(grep -c "^[A-Z_]" .env 2>/dev/null || echo 0)
if [ "$ENV_COUNT" -gt 10 ]; then
    check ".env содержит переменные ($ENV_COUNT)" 1
else
    check ".env содержит переменные ($ENV_COUNT)" 0
fi

HAS_SUPABASE=$(grep -c "VITE_SUPABASE" .env 2>/dev/null || echo 0)
if [ "$HAS_SUPABASE" -gt 0 ]; then
    check "Supabase переменные заполнены" 1
else
    check "Supabase переменные заполнены" 0
fi

# 7. Тест подписки
echo ""
echo "📦 ФУНКЦИОНАЛЬНОСТЬ:"

# Получаем подписку из Supabase
SUPABASE_URL=$(grep "VITE_SUPABASE_URL=" .env | cut -d= -f2)
SERVICE_KEY=$(grep "SUPABASE_SERVICE_ROLE_KEY=" .env | cut -d= -f2)

if [ -n "$SUPABASE_URL" ] && [ -n "$SERVICE_KEY" ]; then
    SUBS=$(curl -s "${SUPABASE_URL}/rest/v1/subscriptions?status=eq.active&limit=1" \
        -H "apikey: $SERVICE_KEY" \
        -H "Authorization: Bearer $SERVICE_KEY" 2>/dev/null | grep -c '"id"' || echo 0)
    
    if [ "$SUBS" -gt 0 ]; then
        check "Supabase доступна и содержит подписки" 1
    else
        check "Supabase доступна и содержит подписки" 0
    fi
else
    check "Supabase доступна и содержит подписки" 0
fi

# === ИТОГИ ===
echo ""
echo "════════════════════════════════════════════════════════════════"
echo "📊 ИТОГОВЫЙ РЕЗУЛЬТАТ:"
echo "  ✅ Passed: $PASS"
echo "  ❌ Failed: $FAIL"
echo ""

if [ "$FAIL" -eq 0 ]; then
    echo "🎉 ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ! Система работает корректно."
elif [ "$FAIL" -le 2 ]; then
    echo "⚠️  Есть небольшие проблемы, но система в целом работает"
else
    echo "🔴 КРИТИЧЕСКИЕ ПРОБЛЕМЫ. Требуется дополнительное исправление."
fi

echo "════════════════════════════════════════════════════════════════"

