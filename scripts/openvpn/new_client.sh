#!/usr/bin/env bash
# ============================================================================
# Выдача клиенту готового файла OpenVPN (.ovpn) с вшитыми сертификатами.
# Запуск:  bash scripts/openvpn/new_client.sh <имя_клиента>
# Пример:  bash scripts/openvpn/new_client.sh ivan
# Файл появится в /root/ovpn-clients/<имя>.ovpn — его можно отправить пользователю.
# Отзыв доступа: bash scripts/openvpn/revoke_client.sh <имя>
# ============================================================================
set -euo pipefail

NAME="${1:-}"
if [ -z "${NAME}" ]; then
  echo "Укажи имя клиента: bash scripts/openvpn/new_client.sh ivan"
  exit 1
fi

EASYRSA_DIR="/etc/openvpn/easy-rsa"
OUT_DIR="/root/ovpn-clients"
PORT="${OVPN_PORT:-1194}"
PROTO="${OVPN_PROTO:-udp}"
SERVER_IP="${OVPN_HOST:-$(curl -s -4 --max-time 10 https://api.ipify.org || echo 194.50.94.28)}"

[ -d "${EASYRSA_DIR}/pki" ] || { echo "Сначала запусти setup_openvpn.sh"; exit 1; }
mkdir -p "${OUT_DIR}"
cd "${EASYRSA_DIR}"

if [ ! -f "pki/issued/${NAME}.crt" ]; then
  ./easyrsa --batch --req-cn="${NAME}" build-client-full "${NAME}" nopass
  echo "Сертификат для ${NAME} создан"
else
  echo "Сертификат для ${NAME} уже есть — пересобираю только .ovpn"
fi

OUT="${OUT_DIR}/${NAME}.ovpn"
cat > "${OUT}" <<EOF
client
dev tun
proto ${PROTO}
remote ${SERVER_IP} ${PORT}
resolv-retry infinite
nobind
persist-key
persist-tun
remote-cert-tls server
data-ciphers AES-256-GCM:AES-128-GCM
data-ciphers-fallback AES-256-GCM
auth SHA256
verb 3

<ca>
$(cat pki/ca.crt)
</ca>

<cert>
$(openssl x509 -in "pki/issued/${NAME}.crt")
</cert>

<key>
$(cat "pki/private/${NAME}.key")
</key>

<tls-crypt>
$(cat /etc/openvpn/tls-crypt.key)
</tls-crypt>
EOF

chmod 600 "${OUT}"
echo "Готово: ${OUT}  (${SERVER_IP}:${PORT}/${PROTO})"
echo "Проверка не нужна: файл самодостаточный, ключи вшиты внутрь."
