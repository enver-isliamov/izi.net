#!/usr/bin/env bash
# ============================================================================
# Проверка: есть ли на сервере УЖЕ работающий AmneziaWG/WireGuard (например wg0)
# и почему не поднимается наш второй интерфейс awg0.
# Запуск: bash scripts/amneziawg/check_existing_awg.sh
# Ничего не меняет.
# ============================================================================
set -uo pipefail

echo "=========== 1. Все интерфейсы AmneziaWG ==========="
awg show 2>/dev/null | sed 's/^/  /' || echo "  awg show ничего не вернул"

echo "=========== 2. Интерфейсы WireGuard (если есть) ==========="
command -v wg >/dev/null 2>&1 && { wg show 2>/dev/null | sed 's/^/  /' || echo "  wg show пусто"; } || echo "  wg не установлен"

echo "=========== 3. Сетевые интерфейсы и адреса ==========="
ip -4 -o addr show | awk '{print "  "$2" -> "$4}'

echo "=========== 4. Какие UDP-порты слушаются (VPN) ==========="
ss -lunp 2>/dev/null | awk 'NR==1 || /51820|51821|10\.|443|1194/' | sed 's/^/  /'

echo "=========== 5. Конфиги AmneziaWG на хосте ==========="
ls -la /etc/amnezia/amneziawg/ 2>/dev/null | sed 's/^/  /' || echo "  папки /etc/amnezia/amneziawg нет"

echo "=========== 6. Есть ли конфиг wg0 ==========="
for f in /etc/wireguard/wg0.conf /etc/amnezia/amneziawg/wg0.conf /etc/amnezia/amneziawg/awg0.conf; do
  if [ -f "$f" ]; then
    echo "  найден $f:"
    grep -E '^(Address|ListenPort|\[Interface\])' "$f" | sed 's/^/    /'
  fi
done

echo "=========== 7. Служба wg0 (если есть) ==========="
systemctl is-active wg-quick@wg0 2>/dev/null || echo "  служба wg-quick@wg0 не активна/не найдена"
systemctl is-active awg-quick@wg0 2>/dev/null || echo "  служба awg-quick@wg0 не активна/не найдена"

echo "=========== 8. Модули ==========="
lsmod | grep -E 'amneziawg|^wireguard' | sed 's/^/  /' || echo "  модули не загружены"

echo "=========== 9. Попытка создать тестовый интерфейс ==========="
ip link add awgtest0 type amneziawg 2>/tmp/awgtest_err && {
  echo "  интерфейс создаётся нормально"
  ip link del awgtest0 2>/dev/null || true
} || {
  echo "  ОШИБКА при создании: $(cat /tmp/awgtest_err 2>/dev/null)"
}
rm -f /tmp/awgtest_err

echo ""
echo "Как читать результат:"
echo "  • раздел 1 показывает wg0 → на сервере УЖЕ есть AmneziaWG: можно использовать его,"
echo "    не создавая второй интерфейс (сообщите мне — я переключу приложение на wg0)."
echo "  • раздел 4 показывает 51820 занятым → порт действительно занят, нужен другой."
echo "  • раздел 9 без ошибки → модуль в порядке, дело только в имени/порте интерфейса."
