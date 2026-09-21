#!/usr/bin/env bash
# ============================================================================
# Установка OpenVPN-сервера на izinet VPS (Ubuntu/Debian).
# Что делает: ставит openvpn + easy-rsa, создаёт PKI, поднимает сервер (UDP 1194),
# включает форвардинг и NAT, открывает порт в UFW, готовит шаблон клиента.
# Запуск:  bash scripts/openvpn/setup_openvpn.sh
# Выдача клиенту файла: bash scripts/openvpn/new_client.sh <имя_клиента>
# ============================================================================
set -euo pipefail

OVPN_DIR="/etc/openvpn"
EASYRSA_DIR="${OVPN_DIR}/easy-rsa"
CLIENTS_DIR="/root/ovpn-clients"
PORT="${OVPN_PORT:-1194}"
PROTO="${OVPN_PROTO:-udp}"
DNS1="${OVPN_DNS1:-1.1.1.1}"
DNS2="${OVPN_DNS2:-8.8.8.8}"

echo "=== 1/7 Установка пакетов ==="
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y --no-install-recommends openvpn easy-rsa iptables

echo "=== 2/7 Подготовка PKI (easy-rsa) ==="
if [ ! -d "${EASYRSA_DIR}/pki" ]; then
  mkdir -p "${OVPN_DIR}"
  make-cadir "${EASYRSA_DIR}"
  cd "${EASYRSA_DIR}"
  ./easyrsa --batch init-pki
  ./easyrsa --batch --req-cn=izinet-CA build-ca nopass
  ./easyrsa --batch --req-cn=server build-server-full server nopass
  ./easyrsa --batch gen-crl
  openvpn --genkey secret "${OVPN_DIR}/tls-crypt.key"
  echo "PKI создан: ${EASYRSA_DIR}/pki"
else
  echo "PKI уже есть — пропускаю (ничего не перезаписываю)"
fi

echo "=== 3/7 Конфигурация сервера ==="
cat > "${OVPN_DIR}/server.conf" <<EOF
port ${PORT}
proto ${PROTO}
dev tun
topology subnet
server 10.8.0.0 255.255.255.0
ca ${EASYRSA_DIR}/pki/ca.crt
cert ${EASYRSA_DIR}/pki/issued/server.crt
key ${EASYRSA_DIR}/pki/private/server.key
crl-verify ${EASYRSA_DIR}/pki/crl.pem
dh none
tls-crypt ${OVPN_DIR}/tls-crypt.key
tls-version-min 1.2
data-ciphers AES-256-GCM:AES-128-GCM
data-ciphers-fallback AES-256-GCM
auth SHA256
ecdh-curve prime256v1
user nobody
group nogroup
persist-key
persist-tun
keepalive 10 60
ping-timer-rem
explicit-exit-notify 1
push "redirect-gateway def1 bypass-dhcp"
push "dhcp-option DNS ${DNS1}"
push "dhcp-option DNS ${DNS2}"
push "block-outside-dns"
verb 3
status ${OVPN_DIR}/openvpn-status.log
log-append /var/log/openvpn.log
mute 20
EOF
chmod 600 "${OVPN_DIR}/tls-crypt.key" || true

echo "=== 4/7 Форвардинг и NAT ==="
sysctl -w net.ipv4.ip_forward=1 >/dev/null
grep -q '^net.ipv4.ip_forward=1' /etc/sysctl.conf || echo 'net.ipv4.ip_forward=1' >> /etc/sysctl.conf
IFACE="$(ip route show default | awk '/default/ {print $5; exit}')"
iptables -t nat -C POSTROUTING -s 10.8.0.0/24 -o "${IFACE}" -j MASQUERADE 2>/dev/null || \
  iptables -t nat -A POSTROUTING -s 10.8.0.0/24 -o "${IFACE}" -j MASQUERADE
iptables -C FORWARD -i tun+ -o "${IFACE}" -j ACCEPT 2>/dev/null || iptables -A FORWARD -i tun+ -o "${IFACE}" -j ACCEPT
iptables -C FORWARD -i "${IFACE}" -o tun+ -m state --state RELATED,ESTABLISHED -j ACCEPT 2>/dev/null || \
  iptables -A FORWARD -i "${IFACE}" -o tun+ -m state --state RELATED,ESTABLISHED -j ACCEPT
command -v netfilter-persistent >/dev/null && netfilter-persistent save >/dev/null 2>&1 || true
echo "NAT настроен для интерфейса ${IFACE}"

echo "=== 5/7 Порты в UFW ==="
if command -v ufw >/dev/null; then
  ufw allow "${PORT}/${PROTO}" 2>/dev/null || true
  ufw allow 1194/udp 2>/dev/null || true
  ufw reload 2>/dev/null || true
  echo "UFW: разрешён ${PORT}/${PROTO}"
fi

echo "=== 6/7 Запуск службы ==="
systemctl enable openvpn-server@server >/dev/null 2>&1 || true
systemctl restart openvpn-server@server || systemctl restart openvpn@server
sleep 3
systemctl is-active openvpn-server@server || systemctl is-active openvpn@server || true

echo "=== 7/7 Проверка ==="
mkdir -p "${CLIENTS_DIR}"
ss -lunp | grep ":${PORT}" || echo "ВНИМАНИЕ: служба не слушает порт ${PORT} — смотрите: journalctl -u openvpn-server@server -n 50"

cat <<EOF

Готово.
  Тестовый клиент:  bash scripts/openvpn/new_client.sh test-user
  Папка с .ovpn:    ${CLIENTS_DIR}
  Логи:             journalctl -u openvpn-server@server -n 50

ВАЖНО про РФ: OpenVPN имеет узнаваемый handshake и часто режется DPI.
Как резервный протокол он рабочий, но Hysteria2 и VLESS Reality устойчивее.
EOF
