#!/usr/bin/env bash
# ============================================================================
# Установка AmneziaWG-сервера на izinet VPS (обфусцированный WireGuard).
# Что делает: ставит amneziawg (модуль ядра + awg-tools), создаёт интерфейс awg0
# с обфускационными параметрами, включает NAT/forward, открывает UDP-порт в UFW,
# запускает awg-quick@awg0 и сохраняет параметры сервера для нашего приложения.
# Запуск: bash scripts/amneziawg/setup_awg.sh
# Выдача файла пользователю из CLI: bash scripts/amneziawg/new_awg_client.sh <имя>
# ============================================================================
set -euo pipefail

AWG_DIR="/etc/amnezia/amneziawg"
IFACE="awg0"
PORT="${AWG_PORT:-51820}"
SUBNET="10.9.0"
SERVER_JSON="${AWG_DIR}/izinet-server.json"

echo "=== 1/7 Установка пакетов ==="
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y --no-install-recommends curl gnupg ca-certificates iptables

# Официальный репозиторий Amnezia (amneziawg-tools + amneziawg-dkms)
if ! command -v awg >/dev/null 2>&1; then
  curl -fsSL https://repo.amnezia.org/amneziawg.deb.pub -o /etc/apt/keyrings/amneziawg.asc 2>/dev/null || true
  if [ -s /etc/apt/keyrings/amneziawg.asc ]; then
    . /etc/os-release
    echo "deb [signed-by=/etc/apt/keyrings/amneziawg.asc] https://repo.amnezia.org/debian ${VERSION_CODENAME} main" \
      > /etc/apt/sources.list.d/amneziawg.list
    apt-get update -qq || true
    apt-get install -y amneziawg amneziawg-tools || echo "ПРЕДУПРЕЖДЕНИЕ: пакеты AmneziaWG не установились автоматически — поставьте вручную (см. README)"
  else
    echo "ПРЕДУПРЕЖДЕНИЕ: ключ репозитория Amnezia недоступен — поставьте amneziawg/amneziawg-tools вручную"
  fi
fi

command -v awg >/dev/null 2>&1 || { echo "awg-tools не найдены — установите amneziawg-tools и повторите"; exit 1; }

echo "=== 2/7 Обфускационные параметры и ключи ==="
mkdir -p "${AWG_DIR}"
chmod 700 "${AWG_DIR}"

if [ ! -f "${AWG_DIR}/server.key" ]; then
  awg genkey > "${AWG_DIR}/server.key"
  chmod 600 "${AWG_DIR}/server.key"
  awg pubkey < "${AWG_DIR}/server.key" > "${AWG_DIR}/server.pub"
fi
SERVER_PRIV="$(cat "${AWG_DIR}/server.key")"
SERVER_PUB="$(cat "${AWG_DIR}/server.pub")"

# Параметры обфускации (генерируются один раз и сохраняются)
if [ ! -f "${SERVER_JSON}" ]; then
  JC=$((3 + RANDOM % 7))          # 3..9
  JMIN=$((40 + RANDOM % 50))      # 40..89
  JMAX=$((JMIN + 500 + RANDOM % 500))
  S1=$((15 + RANDOM % 140))
  S2=$((15 + RANDOM % 140))
  H1=$((100000000 + RANDOM % 800000000))
  H2=$((H1 + 100000000 + RANDOM % 500000000))
  H3=$((H2 + 100000000 + RANDOM % 500000000))
  H4=$((H3 + 100000000 + RANDOM % 500000000))
else
  eval "$(python3 - "$SERVER_JSON" <<'PY'
import json,sys
d=json.load(open(sys.argv[1]))
print("JC=%s;JMIN=%s;JMAX=%s;S1=%s;S2=%s;H1=%s;H2=%s;H3=%s;H4=%s"%(d["jc"],d["jmin"],d["jmax"],d["s1"],d["s2"],d["h1"],d["h2"],d["h3"],d["h4"]))
PY
)"
fi

echo "=== 3/7 Конфигурация интерфейса ==="
cat > "/etc/amnezia/amneziawg/${IFACE}.conf" <<EOF
[Interface]
Address = ${SUBNET}.1/24
ListenPort = ${PORT}
PrivateKey = ${SERVER_PRIV}
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

# peers добавляет приложение (izinet-app) или скрипт new_awg_client.sh
# учёт: /etc/amnezia/amneziawg/izinet-peers.json
EOF
chmod 600 "/etc/amnezia/amneziawg/${IFACE}.conf"

echo "=== 4/7 Форвардинг и NAT ==="
sysctl -w net.ipv4.ip_forward=1 >/dev/null
grep -q '^net.ipv4.ip_forward=1' /etc/sysctl.conf || echo 'net.ipv4.ip_forward=1' >> /etc/sysctl.conf
WAN="$(ip route show default | awk '/default/ {print $5; exit}')"
iptables -t nat -C POSTROUTING -s ${SUBNET}.0/24 -o "${WAN}" -j MASQUERADE 2>/dev/null || \
  iptables -t nat -A POSTROUTING -s ${SUBNET}.0/24 -o "${WAN}" -j MASQUERADE
iptables -C FORWARD -i ${IFACE} -o "${WAN}" -j ACCEPT 2>/dev/null || iptables -A FORWARD -i ${IFACE} -o "${WAN}" -j ACCEPT
iptables -C FORWARD -i "${WAN}" -o ${IFACE} -m state --state RELATED,ESTABLISHED -j ACCEPT 2>/dev/null || \
  iptables -A FORWARD -i "${WAN}" -o ${IFACE} -m state --state RELATED,ESTABLISHED -j ACCEPT
command -v netfilter-persistent >/dev/null && netfilter-persistent save >/dev/null 2>&1 || true
echo "NAT настроен (wan=${WAN})"

echo "=== 5/7 Порты UFW ==="
if command -v ufw >/dev/null; then
  ufw allow "${PORT}/udp" 2>/dev/null || true
  ufw reload 2>/dev/null || true
fi

echo "=== 6/7 Запуск интерфейса ==="
systemctl enable "awg-quick@${IFACE}" >/dev/null 2>&1 || true
systemctl restart "awg-quick@${IFACE}"
sleep 2
awg show "${IFACE}" || true

echo "=== 7/7 Параметры для приложения ==="
if [ ! -f "${SERVER_JSON}" ]; then
  python3 - "$SERVER_JSON" "$SERVER_PUB" "$PORT" "$SUBNET" "$JC" "$JMIN" "$JMAX" "$S1" "$S2" "$H1" "$H2" "$H3" "$H4" <<'PY'
import json,sys
out, pub, port, subnet, jc, jmin, jmax, s1, s2, h1, h2, h3, h4 = sys.argv[1:14]
json.dump({
  "interface": "awg0", "public_key": pub, "port": int(port), "subnet": subnet,
  "jc": int(jc), "jmin": int(jmin), "jmax": int(jmax),
  "s1": int(s1), "s2": int(s2),
  "h1": int(h1), "h2": int(h2), "h3": int(h3), "h4": int(h4),
}, open(out, "w"), ensure_ascii=False, indent=2)
PY
  chmod 600 "${SERVER_JSON}"
fi
if [ ! -f "${AWG_DIR}/izinet-peers.json" ]; then
  echo '{"peers":[]}' > "${AWG_DIR}/izinet-peers.json"
  chmod 600 "${AWG_DIR}/izinet-peers.json"
fi

cat <<EOF

Готово.
  Интерфейс:   ${IFACE} (UDP ${PORT})
  Публичный ключ сервера сохранён в ${SERVER_JSON}
  Учёт клиентов: ${AWG_DIR}/izinet-peers.json
  Проверка:    awg show ${IFACE}

Дальше: в приложении (админка → Пользователи → устройство → «AmneziaWG») или CLI:
  bash scripts/amneziawg/new_awg_client.sh test-user
EOF
