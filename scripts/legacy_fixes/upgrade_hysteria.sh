#!/bin/bash
# IZINET — безопасное обновление Hysteria2 до указанной версии (по умолчанию 2.13.0).
# Делает: бэкап бинарника/конфига/ACL → скачивание с проверкой SHA256 → preflight на копии
# конфига (listen 127.0.0.1:0) → замена бинарника → рестарт → функциональная проверка
# через локальный клиент и SOCKS5 → автоматический откат при любой ошибке.
#
# Запуск (root):  bash scripts/legacy_fixes/upgrade_hysteria.sh
# Другая версия:  HYSTERIA_VERSION=2.13.0 bash scripts/legacy_fixes/upgrade_hysteria.sh

set -euo pipefail

NEW_VER="${HYSTERIA_VERSION:-2.13.0}"
BIN="/usr/local/bin/hysteria2"
CONF="/etc/hysteria/config.yaml"
ACL="/etc/hysteria/acl.txt"
SERVICE="hysteria2"
PROBE_PORT="${PROBE_PORT:-19080}"
TS="$(date +%Y%m%d-%H%M%S)"
BAK="/root/izinet-hysteria-upgrade-${TS}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

log()  { echo -e "\033[1;36m[$(date +%H:%M:%S)]\033[0m $*"; }
warn() { echo -e "\033[1;33m[!]\033[0m $*"; }
fail() { echo -e "\033[1;31m[✗]\033[0m $*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "нужен root"
[ -x "$BIN" ] || fail "не найден $BIN"
[ -f "$CONF" ] || fail "не найден $CONF"

CUR="$("$BIN" version 2>&1 | awk -F'\t' '/^Version:/{print $2; exit}' || true)"
log "Текущая версия: ${CUR:-unknown}"

# ---------- 1. Бэкап ----------
mkdir -p "$BAK"
cp -a "$BIN" "$BAK/hysteria2.old"
cp -a "$CONF" "$BAK/config.yaml"
[ -f "$ACL" ] && cp -a "$ACL" "$BAK/acl.txt" || true
systemctl cat "$SERVICE" > "$BAK/${SERVICE}.service.txt" 2>/dev/null || true
log "Бэкап: $BAK"

# ---------- 2. Скачивание и проверка ----------
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64)  A="amd64" ;;
  aarch64) A="arm64" ;;
  *) fail "архитектура $ARCH не поддерживается" ;;
esac
BASE="https://github.com/apernet/hysteria/releases/download/app%2Fv${NEW_VER}"

log "Скачивание Hysteria v${NEW_VER} (linux-${A})..."
curl -fsSL --retry 3 --max-time 180 "$BASE/hysteria-linux-${A}" -o "$TMP/hysteria.new" || fail "не удалось скачать бинарник"
curl -fsSL --retry 3 --max-time 90  "$BASE/hashes.txt"           -o "$TMP/hashes.txt"    || fail "не удалось скачать hashes.txt"

EXPECTED="$(awk -v f="build/hysteria-linux-${A}" '$2==f {print $1}' "$TMP/hashes.txt" | head -1)"
[ -n "$EXPECTED" ] || fail "в hashes.txt нет записи для hysteria-linux-${A}"
ACTUAL="$(sha256sum "$TMP/hysteria.new" | awk '{print $1}')"
[ "$EXPECTED" = "$ACTUAL" ] || fail "SHA256 не совпал (ожидали $EXPECTED, получили $ACTUAL)"
chmod +x "$TMP/hysteria.new"
log "SHA256 OK: ${ACTUAL:0:16}…"

# ---------- 3. Preflight на копии конфига ----------
if command -v python3 >/dev/null 2>&1; then
  python3 - "$CONF" "$TMP/preflight.yaml" <<'PY'
import re, sys
src, dst = sys.argv[1], sys.argv[2]
s = open(src, encoding="utf-8").read()
s = re.sub(r'(?m)^listen:.*$', 'listen: 127.0.0.1:0', s, count=1)
open(dst, "w", encoding="utf-8").write(s)
PY
else
  sed -E '0,/^listen:/s//listen: 127.0.0.1:0/' "$CONF" > "$TMP/preflight.yaml"
fi

timeout 6 "$TMP/hysteria.new" server -c "$TMP/preflight.yaml" >"$TMP/preflight.log" 2>&1 || true
if grep -qiE "FATAL|failed to load server config|invalid config" "$TMP/preflight.log"; then
  tail -20 "$TMP/preflight.log"
  fail "preflight не пройден: конфиг/ACL несовместимы с v${NEW_VER}. Сервис НЕ тронут."
fi
grep -q "server up and running" "$TMP/preflight.log" || { tail -20 "$TMP/preflight.log"; fail "preflight: сервер не поднялся. Сервис НЕ тронут."; }
log "Preflight OK — конфиг совместим"

rollback() {
  warn "Откат на предыдущую версию..."
  cp -a "$BAK/hysteria2.old" "$BIN"
  systemctl restart "$SERVICE" || true
  sleep 1
  systemctl is-active --quiet "$SERVICE" && log "Откат выполнен, сервис активен"
}

# ---------- 4. Установка и рестарт ----------
install -m 0755 "$TMP/hysteria.new" "$BIN"
systemctl restart "$SERVICE"
ACTIVE=no
for _ in $(seq 1 10); do
  if systemctl is-active --quiet "$SERVICE"; then ACTIVE=yes; break; fi
  sleep 1
done
if [ "$ACTIVE" != "yes" ]; then
  journalctl -u "$SERVICE" -n 40 --no-pager || true
  rollback
  fail "новая версия не запустилась — обновление отменено"
fi
log "Сервис активен: $("$BIN" version 2>&1 | awk -F'\t' '/^Version:/{print $2; exit}')"

# ---------- 5. Функциональная проверка ----------
PW="$(awk '/^auth:/{f=1;next} f&&/^[[:space:]]*password:/{sub(/^[[:space:]]*password:[[:space:]]*/,"");print;exit}' "$CONF" || true)"
if [ -n "$PW" ]; then
  cat > "$TMP/probe.yaml" <<EOF
server: 127.0.0.1:443
auth: ${PW}
tls:
  sni: izinet.online
  insecure: true
socks5:
  listen: 127.0.0.1:${PROBE_PORT}
EOF
  "$BIN" client -c "$TMP/probe.yaml" >"$TMP/probe.log" 2>&1 &
  CPID=$!
  sleep 2
  OK=no
  for _ in 1 2 3; do
    IP="$(curl -sS -m 8 --socks5-hostname "127.0.0.1:${PROBE_PORT}" https://api.ipify.org 2>/dev/null || true)"
    if [ "$IP" = "194.50.94.28" ]; then OK=yes; break; fi
    sleep 1
  done
  kill "$CPID" 2>/dev/null || true
  wait "$CPID" 2>/dev/null || true
  if [ "$OK" != "yes" ]; then
    tail -15 "$TMP/probe.log" || true
    rollback
    fail "функциональная проверка не прошла (трафик через туннель не пошёл) — обновление отменено"
  fi
  log "Функциональная проверка OK: внешний IP 194.50.94.28"
else
  warn "пароль в конфиге не найден — функциональная проверка пропущена"
fi

# ---------- 6. Итог ----------
log "Готово. Версия: $("$BIN" version 2>&1 | awk -F'\t' '/^Version:/{print $2; exit}')"
systemctl status "$SERVICE" --no-pager | head -6
echo
echo "Бэкап для отката: $BAK"
echo "Откат вручную: cp -a $BAK/hysteria2.old $BIN && systemctl restart $SERVICE"

