#!/usr/bin/env bash
# ============================================================================
# Миграция пиров AmneziaWG в актуальную подсеть.
# Зачем: после смены подсети (например 10.88.0 → 10.9.0) у части пиров в реестре
# остаются старые адреса — выданные ранее конфиги у клиентов не смогут
# маршрутизироваться (нет маршрута/натинга для старой подсети).
#
# Что делает:
#   1) каждому пиру со «старым» адресом назначает свободный адрес в текущей подсети;
#   2) старый адрес сохраняет как алиас: allowed-ips "новый/32, старый/32" —
#      уже выданные клиентам файлы продолжают работать;
#   3) пересобирает конфиг интерфейса (с сохранением PrivateKey!) и добавляет
#      маршруты/NAT для всех задействованных подсетей;
#   4) обновляет реестр /etc/amnezia/amneziawg/izinet-peers.json.
#
# Ничего не удаляет. Повторный запуск безопасен.
# Запуск: bash scripts/amneziawg/migrate_peers_subnet.sh
# ============================================================================
set -euo pipefail

AWG_DIR="/etc/amnezia/amneziawg"
IFACE="${AWG_IFACE:-awg0}"
SERVER_JSON="${AWG_DIR}/izinet-server.json"
PEERS_JSON="${AWG_DIR}/izinet-peers.json"
CONF="${AWG_DIR}/${IFACE}.conf"

[ -f "${SERVER_JSON}" ] || { echo "❌ Нет ${SERVER_JSON} — сначала запустите setup_awg.sh"; exit 1; }
[ -f "${PEERS_JSON}" ] || { echo "❌ Нет ${PEERS_JSON} — реестр пиров отсутствует"; exit 1; }

echo "=== 0/4 Проверка интерфейса ==="
IFACE_UP=1
awg show "${IFACE}" >/dev/null 2>&1 || { IFACE_UP=0; echo "  ⚠️ Интерфейс ${IFACE} сейчас не поднят — изменения будут записаны в файлы и применятся при следующем запуске."; }

echo "=== 1/4 Переназначение адресов (реестр) ==="
python3 - "$SERVER_JSON" "$PEERS_JSON" <<'PY'
import json, sys

server_path, peers_path = sys.argv[1:3]
server = json.load(open(server_path))
data = json.load(open(peers_path))
peers = data.get("peers", [])

def subnet_base(value: str) -> str:
    parts = [p for p in str(value or "").replace("/", ".").split(".") if p][:3]
    while len(parts) < 3:
        parts.append("0")
    return ".".join(parts)

cur = subnet_base(server.get("subnet"))
used = set()
for p in peers:
    if subnet_base(p.get("address")) == cur:
        used.add(int(str(p.get("address")).split(".")[-1]))

def next_free():
    for i in range(2, 255):
        if i not in used:
            used.add(i)
            return f"{cur}.{i}"
    raise SystemExit("❌ Нет свободных адресов в подсети")

changed = []
for p in peers:
    addr = str(p.get("address") or "")
    if not addr or subnet_base(addr) == cur:
        continue
    new_addr = next_free()
    p["alias"] = p.get("alias") or addr
    p["address"] = new_addr
    changed.append((p.get("name", "?"), addr, new_addr))

json.dump({"peers": peers}, open(peers_path, "w"), ensure_ascii=False, indent=2)
import os
os.chmod(peers_path, 0o600)

if changed:
    print(f"  Переназначено пиров: {len(changed)}")
    for name, old, new in changed:
        print(f"    {name}: {old} -> {new} (старый адрес сохранён алиасом)")
else:
    print("  Все пиры уже в актуальной подсети — ничего менять не нужно.")
PY

echo "=== 2/4 Живой интерфейс (allowed-ips) ==="
if [ "${IFACE_UP}" = "1" ]; then
  python3 - "$PEERS_JSON" "$IFACE" <<'PY'
import json, subprocess, sys

peers_path, iface = sys.argv[1:3]
peers = json.load(open(peers_path)).get("peers", [])
ok = 0
for p in peers:
    new = p.get("address")
    alias = p.get("alias")
    ips = f"{new}/32, {alias}/32" if alias else f"{new}/32"
    r = subprocess.run(["bash", "-lc", f"awg set {iface} peer '{p['public_key']}' allowed-ips '{ips}'"], capture_output=True, text=True)
    if r.returncode == 0:
        ok += 1
    else:
        print(f"  ⚠️ {p.get('name','?')}: {r.stderr.strip()}")
print(f"  Применено пиров: {ok}/{len(peers)}")
PY
else
  echo "  Пропущено (интерфейс не поднят)."
fi

echo "=== 3/4 Конфиг интерфейса и маршруты (с сохранением PrivateKey) ==="
python3 - "$SERVER_JSON" "$PEERS_JSON" "$CONF" "$IFACE" <<'PY'
import json, os, re, subprocess, sys

server_path, peers_path, conf_path, iface = sys.argv[1:5]
server = json.load(open(server_path))
peers = json.load(open(peers_path)).get("peers", [])

def subnet_base(value: str) -> str:
    parts = [p for p in str(value or "").replace("/", ".").split(".") if p][:3]
    while len(parts) < 3:
        parts.append("0")
    return ".".join(parts)

base = subnet_base(server.get("subnet"))

# PrivateKey берём из текущего файла — ни в коем случае не теряем
priv = ""
if os.path.exists(conf_path):
    m = re.search(r"^PrivateKey\s*=\s*(.+)$", open(conf_path).read(), re.M)
    priv = m.group(1).strip() if m else ""
if not priv and os.path.exists(f"{os.path.dirname(conf_path)}/server.key"):
    priv = open(f"{os.path.dirname(conf_path)}/server.key").read().strip()
if not priv:
    raise SystemExit("❌ Не удалось определить PrivateKey интерфейса — конфиг не перезаписываю")

route_nets = {base}
for p in peers:
    if p.get("alias"):
        route_nets.add(subnet_base(p["alias"]))

up = "; ".join(f"ip -4 route add {n}.0/24 dev %i || true" for n in sorted(route_nets))
down = "; ".join(f"ip -4 route del {n}.0/24 dev %i || true" for n in sorted(route_nets))

lines = [
    "[Interface]",
    f"Address = {base}.1/32",
    f"PostUp = {up}",
    f"PostDown = {down}",
    f"ListenPort = {server.get('port', 51820)}",
    f"PrivateKey = {priv}",
    "MTU = 1280",
    f"Jc = {server.get('jc', 4)}",
    f"Jmin = {server.get('jmin', 50)}",
    f"Jmax = {server.get('jmax', 1000)}",
    f"S1 = {server.get('s1', 64)}",
    f"S2 = {server.get('s2', 128)}",
    f"H1 = {server.get('h1', 1)}",
    f"H2 = {server.get('h2', 2)}",
    f"H3 = {server.get('h3', 3)}",
    f"H4 = {server.get('h4', 4)}",
    "",
]
for p in peers:
    ips = f"{p['address']}/32, {p['alias']}/32" if p.get("alias") else f"{p['address']}/32"
    lines += ["[Peer]", f"PublicKey = {p['public_key']}", f"AllowedIPs = {ips}", ""]

with open(conf_path, "w") as f:
    f.write("\n".join(lines))
os.chmod(conf_path, 0o600)
print(f"  Конфиг пересобран: {conf_path} (пиров: {len(peers)})")

# Маршруты и NAT для всех подсетей (идемпотентно)
for n in sorted(route_nets):
    subprocess.run(["bash", "-lc", f"ip -4 route replace {n}.0/24 dev {iface}"], check=False)
try:
    wan = subprocess.run(["bash", "-lc", "ip route show default | awk '/default/ {print $5; exit}'"], capture_output=True, text=True).stdout.strip()
    for n in sorted(route_nets):
        chk = subprocess.run(["bash", "-lc", f"iptables -t nat -C POSTROUTING -s {n}.0/24 -o {wan} -j MASQUERADE"], check=False).returncode
        if chk != 0:
            subprocess.run(["bash", "-lc", f"iptables -t nat -A POSTROUTING -s {n}.0/24 -o {wan} -j MASQUERADE"], check=False)
    print(f"  NAT обновлён для подсетей: {', '.join(sorted(route_nets))} (интерфейс {wan})")
except Exception as e:
    print(f"  ⚠️ NAT: {e}")
PY

echo "=== 4/4 Проверка ==="
awg show "${IFACE}" | awk '/peer:|allowed ips:/ {print "  "$0}' | head -30 || true
echo ""
echo "==============================================="
echo " Итог: пиры переведены в подсеть из ${SERVER_JSON}"
echo " Старые адреса сохранены алиасами — уже выданные файлы работают."
echo " Рекомендация: попросите пользователей перекачать свежий .conf"
echo " (кабинет → «Файл AmneziaWG (роутер)» → «Скачать файл»)."
echo " После того как все перекачают — алиасы можно не хранить."
echo "==============================================="
