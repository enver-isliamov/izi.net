#!/usr/bin/env bash
# Выдача AmneziaWG-конфига из CLI (серверный резерв для приложения).
# Запуск: bash scripts/amneziawg/new_awg_client.sh <имя>
set -euo pipefail

NAME="${1:-}"
[ -z "${NAME}" ] && { echo "Укажи имя: bash scripts/amneziawg/new_awg_client.sh router-home"; exit 1; }

AWG_DIR="/etc/amnezia/amneziawg"
IFACE="awg0"
OUT_DIR="/root/awg-clients"
SERVER_JSON="${AWG_DIR}/izinet-server.json"
PEERS_JSON="${AWG_DIR}/izinet-peers.json"
SERVER_IP="${AWG_HOST:-$(curl -s -4 --max-time 10 https://api.ipify.org || echo 194.50.94.28)}"

[ -f "${SERVER_JSON}" ] || { echo "Сначала запусти setup_awg.sh"; exit 1; }
mkdir -p "${OUT_DIR}"

read -r SERVER_PUB PORT SUBNET JC JMIN JMAX S1 S2 H1 H2 H3 H4 <<<"$(python3 - "$SERVER_JSON" <<'PY'
import json,sys
d=json.load(open(sys.argv[1]))
print(d["public_key"], d["port"], d["subnet"], d["jc"], d["jmin"], d["jmax"], d["s1"], d["s2"], d["h1"], d["h2"], d["h3"], d["h4"])
PY
)"

PRIV="$(awg genkey)"
PUB="$(printf '%s' "${PRIV}" | awg pubkey)"
LAST_OCTET="$(python3 - "$PEERS_JSON" <<'PY'
import json,sys
d=json.load(open(sys.argv[1]))
used={int(p["address"].split(".")[-1]) for p in d.get("peers",[])}
for i in range(2,255):
    if i not in used:
        print(i); break
PY
)"
ADDR="${SUBNET}.${LAST_OCTET}"

awg set "${IFACE}" peer "${PUB}" allowed-ips "${ADDR}/32"
awg-quick save "${IFACE}"

python3 - "$PEERS_JSON" "$NAME" "$PUB" "$ADDR" <<'PY'
import json,sys
path,name,pub,addr=sys.argv[1:5]
d=json.load(open(path))
d.setdefault("peers",[]).append({"name":name,"public_key":pub,"address":addr,"created_at":__import__("datetime").datetime.utcnow().isoformat()+"Z"})
json.dump(d,open(path,"w"),ensure_ascii=False,indent=2)
PY

OUT="${OUT_DIR}/${NAME}.conf"
cat > "${OUT}" <<EOF
[Interface]
PrivateKey = ${PRIV}
Address = ${ADDR}/32
DNS = 1.1.1.1, 8.8.8.8
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

[Peer]
PublicKey = ${SERVER_PUB}
Endpoint = ${SERVER_IP}:${PORT}
AllowedIPs = 0.0.0.0/0
PersistentKeepalive = 25
EOF
chmod 600 "${OUT}"
echo "Готово: ${OUT} (${SERVER_IP}:${PORT}, адрес ${ADDR})"
