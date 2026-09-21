#!/usr/bin/env bash
# ============================================================================
# Установка AmneziaWG на izinet VPS. Что делает по шагам (и печатает это же):
#   1) ставит awg-tools (3 пути: PPA → apt-репозиторий Amnezia → сборка из GitHub)
#   2) проверяет модуль ядра; если он не собрался (частая проблема на Ubuntu 24.04)
#      — автоматически переходит на userspace-реализацию amneziawg-go
#   3) создаёт интерфейс awg0 с обфускацией, включает NAT/forward, открывает UFW
#   4) сохраняет параметры сервера для нашего приложения
# Запуск: bash scripts/amneziawg/setup_awg.sh
# ============================================================================
set -euo pipefail

AWG_DIR="/etc/amnezia/amneziawg"
IFACE="awg0"
PORT="${AWG_PORT:-51820}"
SUBNET="10.9.0"
SERVER_JSON="${AWG_DIR}/izinet-server.json"

echo "=== 0/8 Подготовка системы ==="
export DEBIAN_FRONTEND=noninteractive
umask 077
apt-get update -qq
apt-get install -y --no-install-recommends curl gnupg ca-certificates iptables software-properties-common python3 >/dev/null 2>&1 || true

install_tools() {
  if ! command -v awg >/dev/null 2>&1; then
    echo "  → путь 1: PPA amnezia/ppa"
    add-apt-repository -y ppa:amnezia/ppa >/dev/null 2>&1 || true
    apt-get update -qq >/dev/null 2>&1 || true
    apt-get install -y amneziawg awg-tools amneziawg-tools >/dev/null 2>&1 || true
  fi
  if ! command -v awg >/dev/null 2>&1; then
    echo "  → путь 2: apt-репозиторий repo.amnezia.org"
    mkdir -p /etc/apt/keyrings
    if curl -fsSL --max-time 20 https://repo.amnezia.org/amneziawg.deb.pub -o /etc/apt/keyrings/amneziawg.asc 2>/dev/null && [ -s /etc/apt/keyrings/amneziawg.asc ]; then
      . /etc/os-release
      echo "deb [signed-by=/etc/apt/keyrings/amneziawg.asc] https://repo.amnezia.org/debian ${VERSION_CODENAME} main" > /etc/apt/sources.list.d/amneziawg.list
      apt-get update -qq >/dev/null 2>&1 || true
      apt-get install -y amneziawg amneziawg-tools >/dev/null 2>&1 || true
    else
      echo "     репозиторий Amnezia недоступен с этого сервера — идём дальше"
    fi
  fi
  if ! command -v awg >/dev/null 2>&1; then
    echo "  → путь 3: сборка awg-tools из исходников (GitHub)"
    apt-get install -y --no-install-recommends git build-essential >/dev/null 2>&1 || true
    local tmp; tmp="$(mktemp -d)"
    if git clone --depth 1 https://github.com/amnezia-vpn/amneziawg-tools.git "${tmp}/tools" >/dev/null 2>&1; then
      ( cd "${tmp}/tools/src" && make >/dev/null 2>&1 && make install >/dev/null 2>&1 ) || true
    fi
    rm -rf "${tmp}"
  fi
  command -v awg >/dev/null 2>&1
}

if ! command -v awg >/dev/null 2>&1; then
  echo "=== 1/8 Устанавливаю awg-tools ==="
  install_tools || true
else
  echo "=== 1/8 awg-tools уже установлены ==="
fi
if ! command -v awg >/dev/null 2>&1; then
  echo "❌ Не удалось поставить awg-tools. Запустите по SSH:"
  echo "   apt-get install -y build-essential git && git clone --depth 1 https://github.com/amnezia-vpn/amneziawg-tools.git && cd amneziawg-tools/src && make && make install"
  exit 1
fi
echo "  awg на месте: $(awg --version 2>/dev/null || echo 'ok')"

echo "=== 2/8 Модуль ядра AmneziaWG ==="
modprobe amneziawg 2>/dev/null || true
if lsmod | grep -q '^amneziawg'; then
  echo "  модуль ядра загружен — режим: ядро (быстрый)"
else
  echo "  модуль ядра НЕ загрузился (на Ubuntu 24.04 это известная проблема сборки)."
  echo "  пробую собрать модуль под текущее ядро..."
  apt-get install -y --no-install-recommends "linux-headers-$(uname -r)" >/dev/null 2>&1 || \
    apt-get install -y --no-install-recommends linux-headers-generic >/dev/null 2>&1 || true
  command -v dkms >/dev/null 2>&1 && dkms autoinstall >/dev/null 2>&1 || true
  modprobe amneziawg 2>/dev/null || true
fi

USERSPACE=0
if ! lsmod | grep -q '^amneziawg'; then
  USERSPACE=1
  echo "  → перехожу на userspace-режим (amneziawg-go): работает без модуля ядра"
  if ! command -v amneziawg-go >/dev/null 2>&1; then
    apt-get install -y --no-install-recommends amneziawg-go >/dev/null 2>&1 || true
  fi
  if ! command -v amneziawg-go >/dev/null 2>&1; then
    apt-get install -y --no-install-recommends golang-go git >/dev/null 2>&1 || true
    local_tmp="$(mktemp -d)"
    if git clone --depth 1 https://github.com/amnezia-vpn/amneziawg-go.git "${local_tmp}/awg-go" >/dev/null 2>&1; then
      ( cd "${local_tmp}/awg-go" && make >/dev/null 2>&1 && make install >/dev/null 2>&1 ) || true
    fi
    rm -rf "${local_tmp}"
  fi
  if command -v amneziawg-go >/dev/null 2>&1; then
    mkdir -p "/etc/systemd/system/awg-quick@${IFACE}.service.d"
    cat > "/etc/systemd/system/awg-quick@${IFACE}.service.d/userspace.conf" <<'EOF'
[Service]
Environment=AWG_QUICK_USERSPACE_IMPLEMENTATION=amneziawg-go
Environment=WG_QUICK_USERSPACE_IMPLEMENTATION=amneziawg-go
EOF
    systemctl daemon-reload
    echo "  userspace-реализация подключена (amneziawg-go)"
  else
    echo "  ⚠️ amneziawg-go поставить не удалось — интерфейс не поднимется без модуля ядра."
    echo "     Вариант: обновить ядро и перезагрузиться (apt-get install -y linux-generic && reboot), затем повторить скрипт."
  fi
fi

echo "=== 3/8 Ключи и параметры обфускации ==="
mkdir -p "${AWG_DIR}"; chmod 700 "${AWG_DIR}"
if [ ! -f "${AWG_DIR}/server.key" ]; then
  (umask 077 && awg genkey > "${AWG_DIR}/server.key")
  chmod 600 "${AWG_DIR}/server.key"
  awg pubkey < "${AWG_DIR}/server.key" > "${AWG_DIR}/server.pub"
fi
SERVER_PRIV="$(cat "${AWG_DIR}/server.key")"
SERVER_PUB="$(cat "${AWG_DIR}/server.pub")"

if [ ! -f "${SERVER_JSON}" ]; then
  JC=$((3 + RANDOM % 7)); JMIN=$((40 + RANDOM % 50)); JMAX=$((JMIN + 500 + RANDOM % 500))
  S1=$((15 + RANDOM % 140)); S2=$((15 + RANDOM % 140))
  H1=$((100000000 + RANDOM % 800000000)); H2=$((H1 + 100000000 + RANDOM % 500000000))
  H3=$((H2 + 100000000 + RANDOM % 500000000)); H4=$((H3 + 100000000 + RANDOM % 500000000))
else
  eval "$(python3 - "$SERVER_JSON" <<'PY'
import json,sys
d=json.load(open(sys.argv[1]))
print("JC=%s;JMIN=%s;JMAX=%s;S1=%s;S2=%s;H1=%s;H2=%s;H3=%s;H4=%s"%(d["jc"],d["jmin"],d["jmax"],d["s1"],d["s2"],d["h1"],d["h2"],d["h3"],d["h4"]))
PY
)"
fi

echo "=== 4/8 Конфигурация интерфейса ==="
cat > "${AWG_DIR}/${IFACE}.conf" <<EOF
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
EOF
chmod 600 "${AWG_DIR}/${IFACE}.conf"

echo "=== 5/8 Форвардинг и NAT ==="
sysctl -w net.ipv4.ip_forward=1 >/dev/null
grep -q '^net.ipv4.ip_forward=1' /etc/sysctl.conf || echo 'net.ipv4.ip_forward=1' >> /etc/sysctl.conf
WAN="$(ip route show default | awk '/default/ {print $5; exit}')"
iptables -t nat -C POSTROUTING -s ${SUBNET}.0/24 -o "${WAN}" -j MASQUERADE 2>/dev/null || \
  iptables -t nat -A POSTROUTING -s ${SUBNET}.0/24 -o "${WAN}" -j MASQUERADE
iptables -C FORWARD -i ${IFACE} -o "${WAN}" -j ACCEPT 2>/dev/null || iptables -A FORWARD -i ${IFACE} -o "${WAN}" -j ACCEPT
iptables -C FORWARD -i "${WAN}" -o ${IFACE} -m state --state RELATED,ESTABLISHED -j ACCEPT 2>/dev/null || \
  iptables -A FORWARD -i "${WAN}" -o ${IFACE} -m state --state RELATED,ESTABLISHED -j ACCEPT
command -v netfilter-persistent >/dev/null && netfilter-persistent save >/dev/null 2>&1 || true
echo "  NAT настроен (внешний интерфейс ${WAN})"

echo "=== 6/8 Порты UFW ==="
if command -v ufw >/dev/null; then
  ufw allow "${PORT}/udp" 2>/dev/null || true
  ufw reload 2>/dev/null || true
  echo "  разрешён UDP ${PORT}"
fi

echo "=== 7/8 Запуск интерфейса ==="
systemctl enable "awg-quick@${IFACE}" >/dev/null 2>&1 || true
if systemctl restart "awg-quick@${IFACE}"; then
  sleep 2
  echo "  интерфейс поднят:"
  awg show "${IFACE}" || true
else
  echo "  ❌ интерфейс не поднялся. Диагностика:"
  systemctl --no-pager status "awg-quick@${IFACE}" 2>&1 | tail -15 || true
  echo "  Если видите 'No such device' — нет модуля ядра и не подхватился userspace."
  echo "  Проверьте: lsmod | grep amneziawg ; command -v amneziawg-go ; journalctl -xeu awg-quick@${IFACE} -n 30"
  echo "  Лечение: обновить ядро и перезагрузиться (apt-get install -y linux-generic && reboot), затем повторить скрипт."
fi

echo "=== 8/8 Параметры для приложения ==="
if [ ! -f "${SERVER_JSON}" ]; then
  python3 - "$SERVER_JSON" "$SERVER_PUB" "$PORT" "$SUBNET" "$JC" "$JMIN" "$JMAX" "$S1" "$S2" "$H1" "$H2" "$H3" "$H4" <<'PY'
import json,sys
out, pub, port, subnet, jc, jmin, jmax, s1, s2, h1, h2, h3, h4 = sys.argv[1:14]
json.dump({
  "interface": "awg0", "public_key": pub, "port": int(port), "subnet": subnet,
  "jc": int(jc), "jmin": int(jmin), "jmax": int(jmax), "s1": int(s1), "s2": int(s2),
  "h1": int(h1), "h2": int(h2), "h3": int(h3), "h4": int(h4),
}, open(out, "w"), ensure_ascii=False, indent=2)
PY
  chmod 600 "${SERVER_JSON}"
fi
[ -f "${AWG_DIR}/izinet-peers.json" ] || { echo '{"peers":[]}' > "${AWG_DIR}/izinet-peers.json"; chmod 600 "${AWG_DIR}/izinet-peers.json"; }

echo ""
echo "Режим: $([ "${USERSPACE}" = "1" ] && echo 'userspace (amneziawg-go)' || echo 'ядро (amneziawg)')"
echo "Проверка в приложении: админка → Настройки → «AmneziaWG» → «Проверить AmneziaWG»"
echo "Проверка в консоли:    awg show ${IFACE}"
