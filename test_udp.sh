#!/bin/bash
# Тест: проверка UDP портов на сервере

echo "=== Тест UDP портов ==="

# 1. Проверяем UDP на порту 1194
echo "[1] UDP порт 1194..."
ss -ulnp | grep 1194 || echo "  ❌ UDP 1194 не слушает"

# 2. Проверяем UFW для UDP
echo "[2] UFW UDP правила:"
ufw status | grep -i udp || echo "  Нет UDP правил"

# 3. Проверяем TCP vs UDP на порту 443
echo "[3] TCP порт 443:"
ss -tlnp | grep 443 || echo "  ❌ TCP 443 не слушает"

echo "[4] UDP порт 443:"
ss -ulnp | grep 443 || echo "  ❌ UDP 443 не слушает"

# 4. Проверяем доступность UDP снаружи
echo "[5] Тест UDP снаружи (нужен клиент):"
echo "  На компьютере выполни: nc -u -z -v 194.50.94.28 1194"

# 5. Проверяем какие UDP порты открыты
echo "[6] Все открытые UDP порты:"
ss -ulnp | head -20

# 6. Проверяем Xray конфиг на наличие UDP
echo "[7] Xray inbound конфиги (protocol):"
docker exec x3-ui cat /app/bin/config.json 2>/dev/null | python3 -c "
import sys, json
c = json.load(sys.stdin)
for ib in c.get('inbounds', []):
    print(f'  port={ib.get(\"port\")} protocol={ib.get(\"protocol\")} network={ib.get(\"streamSettings\",{}).get(\"network\",\"tcp\")}')
" 2>/dev/null || echo "  Не удалось прочитать конфиг"
