#!/bin/bash
# Исправление routing rules в Xray config.json

echo "=== Исправление routing rules ==="

# 1. Останавливаем x3-ui
echo "[1/3] Остановка x3-ui..."
docker stop x3-ui 2>/dev/null || true
sleep 2

# 2. Применяем routing rules
echo "[2/3] Применение routing rules..."
docker start x3-ui
sleep 5

# Копируем и запускаем скрипт патчинга
docker cp /opt/izinet/server/src/scripts/patch_xray_config.py x3-ui:/tmp/patch.py
docker exec x3-ui python3 /tmp/patch.py

# 3. Перезапуск Xray
echo "[3/3] Перезапуск x3-ui..."
docker restart x3-ui
sleep 10

# Проверка
echo ""
echo "=== ПРОВЕРКА ==="
docker exec x3-ui cat /app/bin/config.json | python3 -c "
import sys, json
c = json.load(sys.stdin)
rules = c.get('routing', {}).get('rules', [])
outbounds = [o.get('tag') for o in c.get('outbounds', [])]
print(f'Правил: {len(rules)}')
for r in rules:
    print(f'  → {r.get(\"outboundTag\", \"?\")} ({r.get(\"domain\", r.get(\"ip\", r.get(\"inboundTag\", \"?\")))})')
print(f'Outbounds: {outbounds}')
"
