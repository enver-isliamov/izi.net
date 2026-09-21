#!/usr/bin/env bash
# Отзыв доступа клиента OpenVPN (сертификат в CRL + отключение активной сессии).
# Запуск: bash scripts/openvpn/revoke_client.sh <имя_клиента>
set -euo pipefail
NAME="${1:-}"
if [ -z "${NAME}" ]; then
  echo "Укажи имя клиента: bash scripts/openvpn/revoke_client.sh ivan"
  exit 1
fi
EASYRSA_DIR=/etc/openvpn/easy-rsa
cd "${EASYRSA_DIR}"
./easyrsa --batch revoke "${NAME}"
./easyrsa --batch gen-crl
systemctl restart openvpn-server@server || systemctl restart openvpn@server
echo "Доступ ${NAME} отозван (сертификат в CRL). Старые файлы .ovpn больше не подключатся."
