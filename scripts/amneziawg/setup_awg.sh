#!/usr/bin/env bash
# ============================================================================
# Установка AmneziaWG на izinet VPS (обфусцированный WireGuard).
# Идемпотентно: чистит остатки прошлых попыток, сам выбирает свободную подсеть,
# пересоздаёт конфигурацию интерфейса, поднимает awg0 и сохраняет параметры для приложения.
#
# Пути установки awg-tools: PPA amnezia/ppa → apt-репозиторий → сборка из GitHub.
# Режимы: модуль ядра (быстро) или userspace amneziawg-go (если модуль не собрался).
#
# Запуск: bash scripts/amneziawg/setup_awg.sh
# ============================================================================
set -euo pipefail

AWG_DIR="/etc/amnezia/amneziawg"
IFACE="awg0"
PORT="${AWG_PORT:-51820}"
SERVER_JSON="${AWG_DIR}/izinet-server.json"

echo "=== 0/9 Подготовка системы ==="
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

echo "=== 1/9 Установка awg-tools ==="
if ! command -v awg >/dev/null 2>&1; then install_tools || true; else echo "  awg-tools уже установлены"; fi
if ! command -v awg >/dev/null 2>&1; then
  echo "❌ Не удалось поставить awg-tools. По SSH:"
  echo "   apt-get install -y build-essential git && git clone --depth 1 https://github.com/amnezia-vpn/amneziawg-tools.git && cd amneziawg-tools/src && make && make install"
  exit 1
fi
echo "  версия: $(awg --version 2>/dev/null || echo ok)"

echo "=== 2/9 Чистка остатков прошлых попыток ==="
systemctl stop "awg-quick@${IFACE}" >/dev/null 2>&1 || true
systemctl reset-failed "awg-quick@${IFACE}" >/dev/null 2>&1 || true
if ip link show "${IFACE}" >/dev/null 2>&1; then
  ip link delete "${IFACE}" >/dev/null 2>&1 && echo "  удалён старый интерфейс ${IFACE}"
fi
# освободить адрес, если он остался висеть на другом интерфейсе
OLD_ADDR="$(ip -4 -o addr show | awk '/10\.(9|10|11|77|88)\.0\.1\// {print $2" "$4}')"
if [ -n "${OLD_ADDR}" ]; then
  echo "  найден висящий адрес: ${OLD_ADDR} — снимаю"
  for pair in ${OLD_ADDR}; do :; done
  echo "${OLD_ADDR}" | while read -r dev addr; do ip addr del "${addr}" dev "${dev}" >/dev/null 2>&1 || true; done
fi

echo "=== 3/9 Модуль ядра AmneziaWG ==="
modprobe amneziawg 2>/dev/null || true
if lsmod | grep -q '^amneziawg'; then
  echo "  модуль ядра загружен — режим: ядро (быстрый)"
  USERSPACE=0
else
  echo "  модуль ядра не загрузился — пробую собрать под текущее ядро"
  apt-get install -y --no-install-recommends "linux-headers-$(uname -r)" >/dev/null 2>&1 || \
    apt-get install -y --no-install-recommends linux-headers-generic >/dev/null 2>&1 || true
  command -v dkms >/dev/null 2>&1 && dkms autoinstall >/dev/null 2>&1 || true
  modprobe amneziawg 2>/dev/null || true
  if lsmod | grep -q '^amneziawg'; then
    echo "  модуль собран и загружен"
    USERSPACE=0
  else
    USERSPACE=1
    echo "  → перехожу на userspace-режим (amneziawg-go): работает без модуля ядра"
    command -v amneziawg-go >/dev/null 2>&1 || apt-get install -y --no-install-recommends amneziawg-go >/dev/null 2>&1 || true
    if ! command -v amneziawg-go >/dev/null 2>&1; then
      apt-get install -y --no-install-recommends golang-go git >/dev/null 2>&1 || true
      t="$(mktemp -d)"
      if git clone --depth 1 https://github.com/amnezia-vpn/amneziawg-go.git "${t}/go" >/dev/null 2>&1; then
        ( cd "${t}/go" && make >/dev/null 2>&1 && make install >/dev/null 2>&1 ) || true
      fi
      rm -rf "${t}"
    fi
    if command -v amneziawg-go >/dev/null 2>&1; then
      mkdir -p "/etc/systemd/system/awg-quick@${IFACE}.service.d"
      cat > "/etc/systemd/system/awg-quick@${IFACE}.service.d/userspace.conf" <<'EOF'
[Service]
Environment=AWG_QUICK_USERSPACE_IMPLEMENTATION=amneziawg-go
Environment=WG_QUICK_USERSPACE_IMPLEMENTATION=amneziawg-go
EOF
      systemctl daemon-reload
      echo "  userspace-реализация подключена"
    else
      echo "  ⚠️ amneziawg-go поставить не удалось"
    fi
  fi
fi

echo "=== 4/9 Свободная подсеть ==="
PARAMS="$(python3 - "$SERVER_JSON" <<'PY'
import json, os, sys
p = sys.argv[1]
if os.path.exists(p):
    try:
        d = json.load(open(p))
        print("%s|%s|%s|%s|%s|%s|%s|%s|%s|%s" % (d.get("jc"), d.get("jmin"), d.get("jmax"), d.get("s1"), d.get("s2"), d.get("h1"), d.get("h2"), d.get("h3"), d.get("h4"), d.get("subnet","")))
    except Exception:
        print("|||||||||")
else:
    print("|||||||||")
PY
)"
IFS='|' read -r P_JC P_JMIN P_JMAX P_S1 P_S2 P_H1 P_H2 P_H3 P_H4 P_SUBNET <<<"${PARAMS}"

is_free() {
  local net="$1"
  # достоверная проверка: пробуем назначить адрес на lo и сразу снимаем
  if ip addr add "${net}.1/24" dev lo 2>/dev/null; then
    ip addr del "${net}.1/24" dev lo 2>/dev/null || true
    return 0
  fi
  return 1
}

SUBNET=""
for cand in "${P_SUBNET:-10.9.0}" 10.9.0 10.10.0 10.11.0 10.77.0 10.88.0 10.123.0; do
  [ -z "${cand}" ] && continue
  if is_free "${cand}"; then SUBNET="${cand}"; break; fi
  echo "  подсеть ${cand}.0/24 занята — пробую следующую"
done
if [ -z "${SUBNET}" ]; then
  echo "❌ Не нашёл свободную подсеть — проверьте: ip route show ; ip -4 addr show"
  exit 1
fi
echo "  выбрана подсеть: ${SUBNET}.0/24"

echo "=== 5/9 Ключи и обфускация ==="
mkdir -p "${AWG_DIR}"; chmod 700 "${AWG_DIR}"
if [ ! -f "${AWG_DIR}/server.key" ]; then
  (umask 077 && awg genkey > "${AWG_DIR}/server.key")
  chmod 600 "${AWG_DIR}/server.key"
  awg pubkey < "${AWG_DIR}/server.key" > "${AWG_DIR}/server.pub"
fi
SERVER_PRIV="$(cat "${AWG_DIR}/server.key")"
SERVER_PUB="$(cat "${AWG_DIR}/server.pub")"

if [ -z "${P_JC}" ]; then
  JC=$((3 + RANDOM % 7)); JMIN=$((40 + RANDOM % 50)); JMAX=$((JMIN + 500 + RANDOM % 500))
  S1=$((15 + RANDOM % 140)); S2=$((15 + RANDOM % 140))
  H1=$((100000000 + RANDOM % 800000000)); H2=$((H1 + 100000000 + RANDOM % 500000000))
  H3=$((H2 + 100000000 + RANDOM % 500000000)); H4=$((H3 + 100000000 + RANDOM % 500000000))
else
  JC="${P_JC}"; JMIN="${P_JMIN}"; JMAX="${P_JMAX}"; S1="${P_S1}"; S2="${P_S2}"
  H1="${P_H1}"; H2="${P_H2}"; H3="${P_H3}"; H4="${P_H4}"
fi

echo "=== 6/9 UDP-порт и конфигурация интерфейса ==="
# На хосте может уже работать другой VPN (например wg0 на 10.66.66.0/24),
# который занимает UDP 51820 — поэтому порт выбираем свободный.
port_free() {
  ss -lun 2>/dev/null | awk '{print $5}' | grep -qE "[:.]$1$" && return 1
  return 0
}
for cand in "${PORT}" 51821 51822 51823 51900 51999 41820; do
  if port_free "${cand}"; then PORT="${cand}"; break; fi
  echo "  UDP ${cand} занят — пробую следующий"
done
echo "  выбран UDP-порт: ${PORT}"

# Пиры сохраняем из реестра, чтобы не потерять выданных клиентов
PEERS_BLOCK="$(
python3 - "${AWG_DIR}/izinet-peers.json" <<'PY'
import json, os, sys
p = sys.argv[1]
if not os.path.exists(p):
    print("")
    sys.exit(0)
try:
    peers = json.load(open(p)).get("peers", [])
except Exception:
    peers = []
out = []
for peer in peers:
    out.append("[Peer]")
    out.append("PublicKey = %s" % peer.get("public_key", ""))
    out.append("AllowedIPs = %s/32" % peer.get("address", ""))
    out.append("")
print("\n".join(out))
PY
)"

{
  echo "[Interface]"
  # /32 вместо /24: не конфликтует с уже существующими адресами, подсеть подключаем маршрутом
  echo "Address = ${SUBNET}.1/32"
  echo "PostUp = ip -4 route add ${SUBNET}.0/24 dev %i || true"
  echo "PostDown = ip -4 route del ${SUBNET}.0/24 dev %i || true"
  echo "ListenPort = ${PORT}"
  echo "PrivateKey = ${SERVER_PRIV}"
  echo "MTU = 1280"
  echo "Jc = ${JC}"
  echo "Jmin = ${JMIN}"
  echo "Jmax = ${JMAX}"
  echo "S1 = ${S1}"
  echo "S2 = ${S2}"
  echo "H1 = ${H1}"
  echo "H2 = ${H2}"
  echo "H3 = ${H3}"
  echo "H4 = ${H4}"
  echo ""
  [ -n "${PEERS_BLOCK}" ] && echo "${PEERS_BLOCK}"
} > "${AWG_DIR}/${IFACE}.conf"
chmod 600 "${AWG_DIR}/${IFACE}.conf"

echo "=== 7/9 Форвардинг и NAT ==="
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
command -v ufw >/dev/null && { ufw allow "${PORT}/udp" 2>/dev/null || true; ufw reload 2>/dev/null || true; }
echo "  разрешён UDP ${PORT}"

echo "=== 8/9 Запуск интерфейса ==="
echo "  адреса на хосте (для контроля конфликтов):"
ip -4 -o addr show | awk '{print "    "$2" -> "$4}' | head -20
echo "  маршруты 10.*:"
(ip route show | grep -E "^10\." || echo "    нет") | sed 's/^/    /'
systemctl enable "awg-quick@${IFACE}" >/dev/null 2>&1 || true
if systemctl restart "awg-quick@${IFACE}"; then
  sleep 2
  echo "  ✅ интерфейс поднят:"
  awg show "${IFACE}" || true
  RESULT="ok"
else
  echo "  ❌ интерфейс не поднялся. Что случилось (последние строки службы):"
  journalctl -u "awg-quick@${IFACE}" -n 12 --no-pager 2>/dev/null | sed 's/^/    /' || true
  echo "    Если снова 'Address already in use' — освободите адрес: ip -4 -o addr show | grep ${SUBNET}"
  echo "    Если 'No such device' — нет модуля ядра и не подхватился userspace."
  RESULT="fail"
fi

echo "=== 9/9 Параметры для приложения ==="
python3 - "$SERVER_JSON" "$SERVER_PUB" "$PORT" "$SUBNET" "$JC" "$JMIN" "$JMAX" "$S1" "$S2" "$H1" "$H2" "$H3" "$H4" "$([ "${USERSPACE}" = "1" ] && echo container || echo kernel)" <<'PY'
import json, sys
out, pub, port, subnet, jc, jmin, jmax, s1, s2, h1, h2, h3, h4, mode = sys.argv[1:15]
json.dump({
  "interface": "awg0", "public_key": pub, "port": int(port), "subnet": subnet,
  "jc": int(jc), "jmin": int(jmin), "jmax": int(jmax), "s1": int(s1), "s2": int(s2),
  "h1": int(h1), "h2": int(h2), "h3": int(h3), "h4": int(h4), "mode": mode,
}, open(out, "w"), ensure_ascii=False, indent=2)
PY
chmod 600 "${SERVER_JSON}"
[ -f "${AWG_DIR}/izinet-peers.json" ] || { echo '{"peers":[]}' > "${AWG_DIR}/izinet-peers.json"; chmod 600 "${AWG_DIR}/izinet-peers.json"; }

echo ""
echo "==============================================="
echo " Итог: режим $([ "${USERSPACE}" = "1" ] && echo 'userspace (amneziawg-go)' || echo 'ядро (amneziawg)'), подсеть ${SUBNET}.0/24, UDP ${PORT}"
echo " Интерфейс: $([ "${RESULT}" = "ok" ] && echo 'поднят ✅' || echo 'НЕ поднят ❌ (см. строки выше)')"
echo " Проверка:  awg show ${IFACE}"
echo " В кабинете: «Мои устройства» → «Файл AmneziaWG (роутер)» → «Скачать файл»"
echo " В админке:  Настройки → «AmneziaWG» → «Проверить AmneziaWG»"
echo "==============================================="
