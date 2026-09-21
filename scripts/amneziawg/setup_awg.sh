#!/usr/bin/env bash
# ============================================================================
# Установка AmneziaWG-сервера на izinet VPS (обфусцированный WireGuard).
# Установка идёт по трём путям, пока не сработает один:
#   1) PPA amnezia/ppa            2) apt-репозиторий repo.amnezia.org
#   3) СБОРКА ИЗ ИСХОДНИКОВ с GitHub (работает, когда репозиторий Amnezia недоступен)
# Затем: интерфейс awg0 с обфускацией, NAT/forward, UFW, автозапуск, параметры для приложения.
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
apt-get update -qq
apt-get install -y --no-install-recommends curl gnupg ca-certificates iptables software-properties-common >/dev/null 2>&1 || true

install_awg() {
  # --- путь 1: PPA ---
  if ! command -v awg >/dev/null 2>&1; then
    echo "→ путь 1: PPA amnezia/ppa"
    add-apt-repository -y ppa:amnezia/ppa >/dev/null 2>&1 || true
    apt-get update -qq >/dev/null 2>&1 || true
    apt-get install -y amneziawg amneziawg-tools >/dev/null 2>&1 || true
  fi

  # --- путь 2: apt-репозиторий Amnezia ---
  if ! command -v awg >/dev/null 2>&1; then
    echo "→ путь 2: apt-репозиторий repo.amnezia.org"
    mkdir -p /etc/apt/keyrings
    if curl -fsSL --max-time 20 https://repo.amnezia.org/amneziawg.deb.pub -o /etc/apt/keyrings/amneziawg.asc 2>/dev/null && [ -s /etc/apt/keyrings/amneziawg.asc ]; then
      . /etc/os-release
      echo "deb [signed-by=/etc/apt/keyrings/amneziawg.asc] https://repo.amnezia.org/debian ${VERSION_CODENAME} main" \
        > /etc/apt/sources.list.d/amneziawg.list
      apt-get update -qq >/dev/null 2>&1 || true
      apt-get install -y amneziawg amneziawg-tools >/dev/null 2>&1 || true
    else
      echo "   репозиторий Amnezia недоступен с сервера (это не ошибка вашей конфигурации)"
    fi
  fi

  # --- путь 3: сборка из исходников (GitHub) ---
  if ! command -v awg >/dev/null 2>&1; then
    echo "→ путь 3: сборка из исходников с GitHub"
    apt-get install -y --no-install-recommends git build-essential dkms >/dev/null 2>&1 || true
    apt-get install -y "linux-headers-$(uname -r)" >/dev/null 2>&1 || \
      apt-get install -y linux-headers-generic >/dev/null 2>&1 || true

    local tmp
    tmp="$(mktemp -d)"
    for repo in amneziawg-linux-kernel-module awg-linux-kernel-module; do
      if git clone --depth 1 "https://github.com/amnezia-vpn/${repo}.git" "${tmp}/kernel" >/dev/null 2>&1; then
        echo "   кернел-модуль: ${repo}"
        break
      fi
    done
    if [ -d "${tmp}/kernel/src" ]; then
      ( cd "${tmp}/kernel/src" && make >/dev/null 2>&1 && make install >/dev/null 2>&1 ) || echo "   сборка модуля не удалась (см. вывод выше)"
    else
      echo "   не удалось скачать исходники модуля с GitHub"
    fi

    if git clone --depth 1 https://github.com/amnezia-vpn/amneziawg-tools.git "${tmp}/tools" >/dev/null 2>&1; then
      ( cd "${tmp}/tools/src" && make >/dev/null 2>&1 && make install >/dev/null 2>&1 ) || echo "   сборка awg-tools не удалась"
    else
      echo "   не удалось скачать исходники amneziawg-tools с GitHub"
    fi
    rm -rf "${tmp}"
  fi

  command -v awg >/dev/null 2>&1
}

if ! command -v awg >/dev/null 2>&1; then
  echo "=== 1/8 Установка AmneziaWG (3 пути) ==="
  install_awg || true
else
  echo "=== 1/8 AmneziaWG уже установлен ==="
fi

if ! command -v awg >/dev/null 2>&1; then
  cat <<'EOF'
❌ Не удалось установить AmneziaWG автоматически.

Что проверить и сделать вручную (по SSH):
  1) Есть ли доступ в интернет:      curl -sI https://github.com | head -1
  2) Пакеты ядра для сборки:         apt-get install -y build-essential dkms linux-headers-$(uname -r)
  3) Собрать модуль вручную:
       git clone --depth 1 https://github.com/amnezia-vpn/amneziawg-linux-kernel-module.git
       cd amneziawg-linux-kernel-module/src && make && make install
       git clone --depth 1 https://github.com/amnezia-vpn/amneziawg-tools.git
       cd amneziawg-tools/src && make && make install
       modprobe amneziawg && awg --version
  4) Альтернатива без сборки — AmneziaVPN официальный установщик: https://docs.amnezia.org

После появления команды awg повторите: bash scripts/amneziawg/setup_awg.sh
EOF
  exit 1
fi

echo "=== 2/8 Обфускационные параметры и ключи ==="
mkdir -p "${AWG_DIR}"
chmod 700 "${AWG_DIR}"
modprobe amneziawg 2>/dev/null || true
echo "amneziawg" > /etc/modules-load.d/amneziawg.conf

if [ ! -f "${AWG_DIR}/server.key" ]; then
  awg genkey > "${AWG_DIR}/server.key"
  chmod 600 "${AWG_DIR}/server.key"
  awg pubkey < "${AWG_DIR}/server.key" > "${AWG_DIR}/server.pub"
fi
SERVER_PRIV="$(cat "${AWG_DIR}/server.key")"
SERVER_PUB="$(cat "${AWG_DIR}/server.pub")"

if [ ! -f "${SERVER_JSON}" ]; then
  JC=$((3 + RANDOM % 7))
  JMIN=$((40 + RANDOM % 50))
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

echo "=== 3/8 Конфигурация интерфейса ==="
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

# клиентов добавляет приложение (izinet-app) или скрипт new_awg_client.sh
# реестр: ${AWG_DIR}/izinet-peers.json
EOF
chmod 600 "${AWG_DIR}/${IFACE}.conf"

echo "=== 4/8 Форвардинг и NAT ==="
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

echo "=== 5/8 Порты UFW ==="
if command -v ufw >/dev/null; then
  ufw allow "${PORT}/udp" 2>/dev/null || true
  ufw reload 2>/dev/null || true
fi

echo "=== 6/8 Запуск интерфейса ==="
systemctl enable "awg-quick@${IFACE}" >/dev/null 2>&1 || true
systemctl restart "awg-quick@${IFACE}"
sleep 2
awg show "${IFACE}" || true

echo "=== 7/8 Параметры для приложения ==="
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
[ -f "${AWG_DIR}/izinet-peers.json" ] || { echo '{"peers":[]}' > "${AWG_DIR}/izinet-peers.json"; chmod 600 "${AWG_DIR}/izinet-peers.json"; }

echo "=== 8/8 Готово ==="
cat <<EOF
  Версия:      $(awg --version 2>/dev/null || echo 'awg установлен')
  Интерфейс:   ${IFACE} (UDP ${PORT})
  Ключ сервера: ${SERVER_JSON}
  Реестр:      ${AWG_DIR}/izinet-peers.json
  Проверка:    awg show ${IFACE}

Дальше: кабинет → «Мои устройства» → «Файл AmneziaWG (роутер)», либо CLI:
  bash scripts/amneziawg/new_awg_client.sh test-user
EOF
