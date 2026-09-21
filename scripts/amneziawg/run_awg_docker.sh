#!/usr/bin/env bash
# ============================================================================
# AmneziaWG БЕЗ модуля ядра — запуск в контейнере (userspace amneziawg-go).
# Использовать, если setup_awg.sh написал "No such device" (модуль ядра не собрался).
# Запуск: bash scripts/amneziawg/run_awg_docker.sh
# Результат: контейнер izinet-awg поднимает awg0, порт UDP 51820 на хосте.
# ============================================================================
set -euo pipefail

AWG_DIR="/etc/amnezia/amneziawg"
IFACE="${AWG_IFACE:-awg0}"
PORT="${AWG_PORT:-51820}"
SUBNET="${AWG_SUBNET:-10.9.0}"
NAME="izinet-awg"
IMAGE="izinet-awg:local"

echo "=== 1/5 Каталог конфигурации ==="
mkdir -p "${AWG_DIR}"
chmod 700 "${AWG_DIR}"

echo "=== 2/5 Ключи и параметры (если ещё нет) ==="
if ! command -v awg >/dev/null 2>&1; then
  echo "  ПРЕДУПРЕЖДЕНИЕ: awg-tools нет на хосте — сгенерирую ключи внутри контейнера после сборки"
fi

echo "=== 3/5 Сборка образа ${IMAGE} ==="
docker build -t "${IMAGE}" -f "$(dirname "$0")/Dockerfile" "$(dirname "$0")"

echo "=== 4/5 Подготовка конфигурации интерфейса ==="
if [ ! -f "${AWG_DIR}/${IFACE}.conf" ]; then
  # ключи генерируем через образ (на хосте awg может отсутствовать)
  PRIV="$(docker run --rm "${IMAGE}" awg genkey)"
  PUB="$(printf '%s' "${PRIV}" | docker run --rm -i "${IMAGE}" awg pubkey)"
  JC=$((3 + RANDOM % 7)); JMIN=$((40 + RANDOM % 50)); JMAX=$((JMIN + 500 + RANDOM % 500))
  S1=$((15 + RANDOM % 140)); S2=$((15 + RANDOM % 140))
  H1=$((100000000 + RANDOM % 800000000)); H2=$((H1 + 100000000 + RANDOM % 500000000))
  H3=$((H2 + 100000000 + RANDOM % 500000000)); H4=$((H3 + 100000000 + RANDOM % 500000000))

  cat > "${AWG_DIR}/${IFACE}.conf" <<EOF
[Interface]
Address = ${SUBNET}.1/24
ListenPort = ${PORT}
PrivateKey = ${PRIV}
MTU = 1280
Jc = ${JC}
Jmin = ${JMIN}
Jmax = ${JMAX}
S1 = ${S1}
S2 = ${S2}
H1 = ${H1}
H2 = ${H2}
H3 = ${H3}
H4 = ${H4}
EOF
  chmod 600 "${AWG_DIR}/${IFACE}.conf"

  cat > "${AWG_DIR}/izinet-server.json" <<EOF
{
  "interface": "${IFACE}",
  "public_key": "${PUB}",
  "port": ${PORT},
  "subnet": "${SUBNET}",
  "jc": ${JC}, "jmin": ${JMIN}, "jmax": ${JMAX},
  "s1": ${S1}, "s2": ${S2},
  "h1": ${H1}, "h2": ${H2}, "h3": ${H3}, "h4": ${H4},
  "mode": "container"
}
EOF
  chmod 600 "${AWG_DIR}/izinet-server.json"
  echo "  ключи и параметры созданы"
else
  echo "  конфигурация уже есть — не перезаписываю"
fi
[ -f "${AWG_DIR}/izinet-peers.json" ] || { echo '{"peers":[]}' > "${AWG_DIR}/izinet-peers.json"; chmod 600 "${AWG_DIR}/izinet-peers.json"; }

echo "=== 5/5 Запуск контейнера ==="
docker rm -f "${NAME}" >/dev/null 2>&1 || true
docker run -d \
  --name "${NAME}" \
  --restart unless-stopped \
  --network host \
  --cap-add NET_ADMIN \
  -e AWG_IFACE="${IFACE}" \
  -v "${AWG_DIR}:/etc/amnezia/amneziawg" \
  "${IMAGE}" >/dev/null

sleep 6
echo "  статус контейнера: $(docker inspect -f '{{.State.Status}}' "${NAME}")"
echo "  интерфейс внутри контейнера:"
docker exec "${NAME}" awg show "${IFACE}" 2>/dev/null || echo "  (интерфейс ещё не поднят — смотрите docker logs ${NAME})"

echo ""
echo "Дальше: NAT и порт на хосте"
WAN="$(ip route show default | awk '/default/ {print $5; exit}')"
iptables -t nat -C POSTROUTING -s ${SUBNET}.0/24 -o "${WAN}" -j MASQUERADE 2>/dev/null || \
  iptables -t nat -A POSTROUTING -s ${SUBNET}.0/24 -o "${WAN}" -j MASQUERADE
iptables -C FORWARD -i ${IFACE} -o "${WAN}" -j ACCEPT 2>/dev/null || iptables -A FORWARD -i ${IFACE} -o "${WAN}" -j ACCEPT
command -v ufw >/dev/null && { ufw allow "${PORT}/udp" 2>/dev/null || true; ufw reload 2>/dev/null || true; }
echo "  NAT настроен (${WAN}), UDP ${PORT} разрешён"

echo ""
echo "Проверка: docker exec ${NAME} awg show ${IFACE}"
echo "В приложении: админка → Настройки → «AmneziaWG» → «Проверить AmneziaWG»"
