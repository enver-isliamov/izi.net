#!/bin/bash
# Сохранение пароля Hysteria2 в Supabase

CONFIG="/etc/hysteria/config.yaml"
HY_PASSWORD=$(grep "password:" $CONFIG | awk '{print $2}')

if [ -z "$HY_PASSWORD" ]; then
  echo "ОШИБКА: Пароль не найден в $CONFIG"
  exit 1
fi

SUPABASE_URL=$(grep VITE_SUPABASE_URL /opt/izinet/.env 2>/dev/null | cut -d'=' -f2 | tr -d '"' | tr -d "'")
SUPABASE_KEY=$(grep SUPABASE_SERVICE_ROLE_KEY /opt/izinet/.env 2>/dev/null | cut -d'=' -f2 | tr -d '"' | tr -d "'")

if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_KEY" ]; then
  echo "ОШИБКА: Supabase credentials не найдены в .env"
  exit 1
fi

echo "=== Сохранение Hysteria2 пароля в Supabase ==="
echo "Пароль: ${HY_PASSWORD}"

curl -s -X POST "${SUPABASE_URL}/rest/v1/settings" \
  -H "apikey: ${SUPABASE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_KEY}" \
  -H "Content-Type: application/json" \
  -H "Prefer: resolution=merge-duplicates" \
  -d "{\"key\": \"HYSTERIA_PASSWORD\", \"value\": \"${HY_PASSWORD}\"}" \
  -o /dev/null -w "HTTP %{http_code}\n"

echo "✅ Пароль сохранён в Supabase (таблица settings, ключ HYSTERIA_PASSWORD)"
