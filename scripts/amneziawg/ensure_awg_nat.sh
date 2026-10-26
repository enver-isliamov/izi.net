#!/usr/bin/env bash
# ============================================================================
# IZINET — идемпотентно восстановить NAT/forwarding для AmneziaWG.
#
# Зачем: setup_awg.sh добавляет iptables-правила, но на чистой Ubuntu
# netfilter-persistent может отсутствовать. После reboot MASQUERADE/FORWARD
# исчезают: handshake проходит, а интернета у клиента нет.
#
# Запуск:
#   sudo bash scripts/amneziawg/ensure_awg_nat.sh
#   sudo AWG_IFACE=awg0 AWG_SUBNET=10.9.0 bash scripts/amneziawg/ensure_awg_nat.sh
#
# Скрипт также ставит systemd-юнит izinet-awg-nat.service, чтобы правила
# восстанавливались после каждой загрузки. Ничего не удаляет.
# ============================================================================
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${IZINET_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
AWG_DIR="${AWG_DIR:-/etc/amnezia/amneziawg}"
IFACE="${AWG_IFACE:-awg0}"
SUBNET="${AWG_SUBNET:-}"
SERVER_JSON="$AWG_DIR/izinet-server.json"
PEERS_JSON="$AWG_DIR/izinet-peers.json"

log()  { printf '%s %s\n' "$(date '+%H:%M:%S')" "$*"; }
warn() { printf '⚠ %s\n' "$*" >&2; }
die()  { printf '✗ %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Запускать от root"

if [[ -z "$SUBNET" && -f "$SERVER_JSON" ]]; then
  SUBNET="$(python3 - "$SERVER_JSON" <<'PY' 2>/dev/null || true
import json, sys
try:
    d = json.load(open(sys.argv[1]))
    print(str(d.get("subnet", "")).strip())
except Exception:
    pass
PY
)"
fi

if [[ -z "$SUBNET" ]]; then
  SUBNET="$(ip -4 -o addr show dev "$IFACE" 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | awk -F. '{print $1"."$2"."$3}' | head -1)"
fi
[[ -n "$SUBNET" ]] || SUBNET="10.9.0"
SUBNET="${SUBNET%%/*}"
SUBNET="$(printf '%s\n' "$SUBNET" | awk -F. 'NF >= 3 {print $1"."$2"."$3; exit}')"
[[ "$SUBNET" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "Некорректная подсеть: $SUBNET"

# Старые клиенты могут иметь адрес из 10.88.0.0/24 (алиас после миграции).
# NAT нужен для ВСЕХ подсетей, которые встречаются в реестре пиров.
SUBNETS=("$SUBNET")
if [[ -f "$PEERS_JSON" ]]; then
  while IFS= read -r extra; do
    [[ -n "$extra" ]] || continue
    found=0
    for existing in "${SUBNETS[@]}"; do
      [[ "$existing" = "$extra" ]] && { found=1; break; }
    done
    (( found )) || SUBNETS+=("$extra")
  done < <(python3 - "$PEERS_JSON" <<'PY' 2>/dev/null || true
import json, sys
try:
    peers = json.load(open(sys.argv[1])).get("peers", [])
except Exception:
    peers = []
nets = set()
for p in peers:
    for key in ("address", "alias"):
        parts = str(p.get(key) or "").split(".")
        if len(parts) >= 3 and all(x.isdigit() for x in parts[:3]):
            nets.add(".".join(parts[:3]))
print("\n".join(sorted(nets)))
PY
)
fi

WAN="${AWG_WAN:-$(ip route show default 2>/dev/null | awk '/default/ {print $5; exit}')}"
[[ -n "$WAN" ]] || die "Не найден default route (WAN-интерфейс)"
command -v iptables >/dev/null || die "iptables не установлен"
command -v sysctl >/dev/null || die "sysctl не установлен"

log "AWG NAT: iface=$IFACE subnets=$(printf '%s.0/24 ' "${SUBNETS[@]}") wan=$WAN"

# 1. IP forwarding (сразу и постоянно)
sysctl -w net.ipv4.ip_forward=1 >/dev/null || warn "sysctl -w ip_forward не сработал"
mkdir -p /etc/sysctl.d
printf 'net.ipv4.ip_forward=1\n' > /etc/sysctl.d/99-izinet-awg.conf
sysctl --system >/dev/null 2>&1 || true

# 2. NAT + forward (idempotent)
for net in "${SUBNETS[@]}"; do
  iptables -w 5 -t nat -C POSTROUTING -s "${net}.0/24" -o "$WAN" -j MASQUERADE 2>/dev/null || \
    iptables -w 5 -t nat -A POSTROUTING -s "${net}.0/24" -o "$WAN" -j MASQUERADE
done

iptables -w 5 -C FORWARD -i "$IFACE" -o "$WAN" -j ACCEPT 2>/dev/null || \
  iptables -w 5 -A FORWARD -i "$IFACE" -o "$WAN" -j ACCEPT

iptables -w 5 -C FORWARD -i "$WAN" -o "$IFACE" -m state --state RELATED,ESTABLISHED -j ACCEPT 2>/dev/null || \
  iptables -w 5 -A FORWARD -i "$WAN" -o "$IFACE" -m state --state RELATED,ESTABLISHED -j ACCEPT

# 3. Сохранить правила, если установлен netfilter-persistent
if command -v netfilter-persistent >/dev/null 2>&1; then
  netfilter-persistent save >/dev/null 2>&1 || warn "netfilter-persistent save failed"
fi

# 4. systemd-юнит: восстановление после reboot
if [[ "${IZINET_NAT_NO_SYSTEMD:-0}" != "1" ]] && command -v systemctl >/dev/null 2>&1; then
  UNIT="/etc/systemd/system/izinet-awg-nat.service"
  cat > "$UNIT" <<EOF
[Unit]
Description=IZINET AmneziaWG NAT and forwarding
After=network-online.target awg-quick@${IFACE}.service
Wants=awg-quick@${IFACE}.service

[Service]
Type=oneshot
Environment=IZINET_NAT_NO_SYSTEMD=1
Environment=AWG_IFACE=${IFACE}
Environment=AWG_SUBNET=${SUBNET}
ExecStart=${SCRIPT_DIR}/ensure_awg_nat.sh
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable izinet-awg-nat.service >/dev/null 2>&1 || warn "systemctl enable не удался"
  # Запускаем через unit, чтобы проверить его конфигурацию; скрипт не рекурсирует.
  systemctl restart izinet-awg-nat.service >/dev/null 2>&1 || warn "systemctl restart izinet-awg-nat.service не удался"
  ok_unit=""
  if systemctl is-active --quiet izinet-awg-nat.service; then ok_unit="active"; fi
  log "systemd unit izinet-awg-nat.service: ${ok_unit:-unknown}"
fi

# 5. Показать фактическое состояние
echo
echo "=== iptables NAT ==="
for net in "${SUBNETS[@]}"; do
  iptables -w 5 -t nat -S POSTROUTING | grep -F "${net}.0/24" || true
done
echo "=== iptables FORWARD ==="
iptables -w 5 -S FORWARD | grep -E "(${IFACE}|${WAN}).*ACCEPT" || true
echo "=== ip_forward ==="
sysctl -n net.ipv4.ip_forward
echo "=== awg interface ==="
ip -4 -o addr show dev "$IFACE" 2>/dev/null || warn "интерфейс $IFACE сейчас не поднят"

log "Готово. Если интернет у AWG-клиента всё ещё не работает:"
echo "  • проверьте handshake: awg show $IFACE"
echo "  • проверьте DNS клиента: 1.1.1.1 должен быть доступен через туннель"
echo "  • проверьте, что default route на сервере идёт через $WAN"
echo "  • запустите: bash scripts/amneziawg/diagnose_awg.sh"
