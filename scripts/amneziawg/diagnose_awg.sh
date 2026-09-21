#!/usr/bin/env bash
# ============================================================================
# Диагностика AmneziaWG: показывает, ЧТО именно мешает поднять интерфейс awg0.
# Запуск: bash scripts/amneziawg/diagnose_awg.sh
# Ничего не меняет (кроме кратковременной проверки адреса на lo, который сразу снимается).
# ============================================================================
set -uo pipefail
IFACE="awg0"
SUBNET="${1:-10.9.0}"

echo "=========== 1. Служба ==========="
systemctl is-active "awg-quick@${IFACE}" 2>/dev/null || true
journalctl -u "awg-quick@${IFACE}" -n 12 --no-pager 2>/dev/null | sed 's/^/  /' || true

echo "=========== 2. Модуль ядра ==========="
lsmod 2>/dev/null | grep -E 'amneziawg|wireguard' | sed 's/^/  /' || echo "  модуль не загружен"
modinfo amneziawg 2>/dev/null | head -3 | sed 's/^/  /' || echo "  modinfo: нет данных (собран из исходников?)"

echo "=========== 3. Интерфейсы и адреса ==========="
ip -4 -o addr show | awk '{print "  "$2" -> "$4}' || true

echo "=========== 4. Маршруты, которые могут конфликтовать ==========="
ip route show | grep -E '(^10\.|amneziawg|awg)' | sed 's/^/  /' || echo "  нет маршрутов 10.*"

echo "=========== 5. Docker-сети (частый источник 10.x) ==========="
docker network ls 2>/dev/null | sed 's/^/  /' || true
for net in $(docker network ls --format '{{.Name}}' 2>/dev/null); do
  subnet="$(docker network inspect "$net" --format '{{range .IPAM.Config}}{{.Subnet}} {{end}}' 2>/dev/null)"
  [ -n "$subnet" ] && echo "  ${net}: ${subnet}"
done

echo "=========== 6. Прямая проверка адреса ${SUBNET}.1/24 ==========="
if ip addr add "${SUBNET}.1/24" dev lo 2>/tmp/awg_probe_err; then
  echo "  адрес ${SUBNET}.1/24 СВОБОДЕН (тестовое назначение на lo удалось, снимаю)"
  ip addr del "${SUBNET}.1/24" dev lo 2>/dev/null || true
  echo "  вывод: конфликта в ядре нет — значит мешает что-то другое (см. раздел 2 и 7)"
else
  echo "  АДРЕС ЗАНЯТ: $(cat /tmp/awg_probe_err 2>/dev/null)"
  echo "  адрес ${SUBNET}.1/24 уже существует в ядре — смотрите раздел 3 и фильтруйте по ${SUBNET}."
fi
rm -f /tmp/awg_probe_err

echo "=========== 7. Проверка свободной подсети ==========="
for cand in 10.10.0 10.11.0 10.77.0 10.88.0 10.123.0 10.234.0; do
  if ip addr add "${cand}.1/24" dev lo 2>/dev/null; then
    echo "  ${cand}.0/24 — свободна"
    ip addr del "${cand}.1/24" dev lo 2>/dev/null || true
  else
    echo "  ${cand}.0/24 — занята"
  fi
done

echo "=========== 8. Логи ядра (последние строки) ==========="
dmesg 2>/dev/null | tail -8 | sed 's/^/  /' || echo "  dmesg недоступен"

echo ""
echo "Что делать с результатом:"
echo "  • если раздел 6 пишет «АДРЕС ЗАНЯТ» — пришлите вывод раздела 3: удалим конфликтующий адрес."
echo "  • если раздел 6 пишет «СВОБОДЕН», а служба всё равно падает — пришлите разделы 1, 2 и 7."
echo "  • скрипт установки при следующем запуске сам возьмёт первую свободную подсеть из раздела 7."
