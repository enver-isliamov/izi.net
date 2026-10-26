#!/usr/bin/env bash
# ============================================================================
# IZINET — безопасное обновление без разрыва VPN
#
# По умолчанию:
#   • обновляет только izinet-app;
#   • НЕ делает docker compose down;
#   • НЕ перезапускает x3-ui и Hysteria2;
#   • при ошибке возвращает предыдущий образ приложения.
#
# Опции:
#   --with-panel   обновить и x3-ui (только в окно обслуживания)
#   --bootstrap    выполнить xui_bootstrap/fix_reality/routing после обновления панели
#   --skip-git     не делать fetch/reset (использовать текущий checkout)
#   --force        пересобрать даже если commit не изменился
#   --dry-run      показать план, ничего не менять
#   -h, --help     эта справка
#
# Примеры:
#   ./update.sh                 # обычное безопасное обновление
#   ./update.sh --dry-run       # проверить план
#   ./update.sh --with-panel    # обновить панель + приложение (окно обслуживания)
# ============================================================================
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="$ROOT_DIR/backups/update-$STAMP"
LOCK_FILE="/var/lock/izinet-update.lock"
APP_SERVICE="izinet-app"
APP_CONTAINER="izinet-app"
PANEL_CONTAINER="x3-ui"
WITH_PANEL=0
BOOTSTRAP=0
SKIP_GIT=0
FORCE=0
DRY_RUN=0
APP_IMAGE=""
APP_ROLLBACK_TAG=""
PANEL_IMAGE=""
PANEL_ROLLBACK_TAG=""

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { printf '%s %s\n' "$(date '+%H:%M:%S')" "$*"; }
ok()   { printf "${GREEN}✓${NC} %s\n" "$*"; }
warn() { printf "${YELLOW}⚠${NC} %s\n" "$*"; }
die()  { printf "${RED}✗${NC} %s\n" "$*" >&2; exit 1; }

usage() { sed -n '2,27p' "$0" | sed 's/^# \{0,1\}//'; }

while (($#)); do
  case "$1" in
    --with-panel) WITH_PANEL=1 ;;
    --bootstrap) BOOTSTRAP=1 ;;
    --skip-git) SKIP_GIT=1 ;;
    --force) FORCE=1 ;;
    --dry-run) DRY_RUN=1 ;;
    -h|--help) usage; exit 0 ;;
    *) die "Неизвестная опция: $1 (см. --help)" ;;
  esac
  shift
done

# --- 0. Базовые проверки ----------------------------------------------------
if (( ! DRY_RUN )); then [[ $EUID -eq 0 ]] || die "Запускать от root: sudo ./update.sh"; fi

if (( ! DRY_RUN )); then
  command -v docker >/dev/null || die "docker не установлен"
  command -v git >/dev/null || die "git не установлен"
  command -v curl >/dev/null || die "curl не установлен"
  docker compose version >/dev/null 2>&1 || die "docker compose недоступен"

  mkdir -p "$BACKUP_DIR"
  # лог одновременно в файл и на экран
  exec > >(tee -a "$BACKUP_DIR/update.log") 2>&1
  exec 9>"$LOCK_FILE"
  flock -n 9 || die "Другой update.sh уже выполняется"

  [[ -f .env ]] || die "Не найден .env"
  [[ -f docker-compose.yml ]] || die "Не найден docker-compose.yml"

  # Панель должна быть жива: иначе обновление приложения не имеет смысла.
  docker inspect "$PANEL_CONTAINER" >/dev/null 2>&1 || die "Контейнер $PANEL_CONTAINER не найден"
  PANEL_STATUS="$(docker inspect -f '{{.State.Status}}' "$PANEL_CONTAINER")"
  [[ "$PANEL_STATUS" = "running" ]] || die "$PANEL_CONTAINER не running ($PANEL_STATUS); сначала восстановите панель"

  AVAIL_KB="$(df -Pk "$ROOT_DIR" | awk 'NR==2 {print $4}')"
  (( AVAIL_KB >= 8*1024*1024 )) || die "Мало места: нужно ≥ 8 ГБ свободно, сейчас $((AVAIL_KB/1024/1024)) ГБ"

  SWAP_KB="$(awk '/SwapTotal/ {print $2}' /proc/meminfo 2>/dev/null || echo 0)"
  if (( SWAP_KB < 1024*1024 )); then
    warn "Swap < 1 ГБ. Для 2-ГБ VPS рекомендуется 2 ГБ swap (см. README)."
  fi
fi

log "=== IZINET safe update $STAMP ==="
log "repo=$ROOT_DIR"
log "backup=$BACKUP_DIR"

# --- 1. Код ----------------------------------------------------------------
OLD_REV="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
NEW_REV="$OLD_REV"

if (( ! SKIP_GIT )); then
  if (( DRY_RUN )); then
    log "[dry-run] git fetch origin main && git reset --hard origin/main"
  else
    if ! git diff --quiet || ! git diff --cached --quiet; then
      die "В репозитории есть локальные изменения tracked-файлов. Сделайте commit/stash или используйте --skip-git."
    fi
    git fetch origin main
    NEW_REV="$(git rev-parse --short origin/main)"
    if [[ "$OLD_REV" = "$NEW_REV" ]] && (( ! FORCE )); then
      ok "Код уже на $NEW_REV; пересборка не нужна (--force чтобы пересобрать)"
      exit 0
    fi
    git reset --hard origin/main
    ok "Код: $OLD_REV → $NEW_REV"
  fi
fi

# --- 2. Бэкап и текущий образ ----------------------------------------------
if (( ! DRY_RUN )); then
  cp -a .env "$BACKUP_DIR/env"
  if [[ -f xui-db/x-ui.db ]]; then
    cp -a xui-db/x-ui.db "$BACKUP_DIR/x-ui.db"
  fi
  if [[ -f /etc/hysteria/config.yaml ]]; then
    cp -a /etc/hysteria/config.yaml "$BACKUP_DIR/hysteria-config.yaml" 2>/dev/null || true
  fi
  if [[ -f /etc/hysteria/acl.txt ]]; then
    cp -a /etc/hysteria/acl.txt "$BACKUP_DIR/hysteria-acl.txt" 2>/dev/null || true
  fi

  APP_IMAGE="$(docker inspect -f '{{.Config.Image}}' "$APP_CONTAINER" 2>/dev/null || echo 'izinet-izinet-app:latest')"
  APP_ROLLBACK_TAG="${APP_IMAGE%:*}:pre-update-$STAMP"
  docker tag "$APP_IMAGE" "$APP_ROLLBACK_TAG"
  ok "Бэкап: $BACKUP_DIR; rollback image: $APP_ROLLBACK_TAG"
else
  log "[dry-run] backup .env, x-ui.db, hysteria config; tag app image"
fi

# --- 3. Сборка только приложения -------------------------------------------
# Важно: build не трогает работающий контейнер. Если сборка упадёт,
# старый izinet-app продолжит обслуживать пользователей.
if (( DRY_RUN )); then
  log "[dry-run] nice -n 10 ionice -c2 -n7 docker compose build $APP_SERVICE"
else
  log "Сборка $APP_SERVICE (x3-ui не пересобирается)..."
  if command -v nice >/dev/null && command -v ionice >/dev/null; then
    nice -n 10 ionice -c2 -n7 docker compose build "$APP_SERVICE"
  else
    docker compose build "$APP_SERVICE"
  fi
  ok "Образ $APP_SERVICE собран"
fi

# --- 4. Запуск только приложения -------------------------------------------
if (( DRY_RUN )); then
  log "[dry-run] docker compose up -d --force-recreate --no-deps --no-build $APP_SERVICE"
else
  docker compose up -d --force-recreate --no-deps --no-build "$APP_SERVICE"
  ok "$APP_SERVICE пересоздан; x3-ui не тронут"
fi

# --- 5. Health + автоматический откат --------------------------------------
if (( ! DRY_RUN )); then
  HEALTH_OK=0
  for _ in $(seq 1 30); do
    CODE="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:3005/api/health 2>/dev/null || true)"
    if [[ "$CODE" = "200" ]]; then HEALTH_OK=1; break; fi
    sleep 2
  done
  if (( ! HEALTH_OK )); then
    warn "Health не 200. Откатываю $APP_SERVICE на $APP_ROLLBACK_TAG"
    docker tag "$APP_ROLLBACK_TAG" "$APP_IMAGE"
    docker compose up -d --force-recreate --no-deps --no-build "$APP_SERVICE"
    die "Обновление отменено; приложение возвращено на предыдущий образ"
  fi
  ok "Health 200"

  # AWG NAT: после reboot правила могли исчезнуть. Скрипт идемпотентный.
  if [[ -x scripts/amneziawg/ensure_awg_nat.sh ]]; then
    log "Проверяю NAT AmneziaWG..."
    bash scripts/amneziawg/ensure_awg_nat.sh || warn "AWG NAT не применён; проверьте scripts/amneziawg/diagnose_awg.sh"
  fi
else
  log "[dry-run] curl health loop + ensure_awg_nat.sh"
fi

# --- 6. Опционально: панель -------------------------------------------------
if (( WITH_PANEL )); then
  if (( DRY_RUN )); then
    log "[dry-run] backup x-ui.db; docker compose pull/up x3-ui; health check"
  else
    log "Обновление x3-ui (окно обслуживания)..."
    cp -a xui-db/x-ui.db "$BACKUP_DIR/x-ui.db.before-panel" 2>/dev/null || true
    PANEL_IMAGE="$(docker inspect -f '{{.Config.Image}}' "$PANEL_CONTAINER")"
    PANEL_ROLLBACK_TAG="${PANEL_IMAGE%:*}:pre-update-$STAMP"
    docker tag "$PANEL_IMAGE" "$PANEL_ROLLBACK_TAG"

    docker compose pull "$PANEL_CONTAINER" || warn "Не удалось pull x3-ui; использую локальный образ"
    docker compose up -d --no-deps --force-recreate "$PANEL_CONTAINER"

    PANEL_OK=0
    for _ in $(seq 1 30); do
      PS="$(docker inspect -f '{{.State.Health.Status}}' "$PANEL_CONTAINER" 2>/dev/null || echo unknown)"
      [[ "$PS" = "healthy" ]] && { PANEL_OK=1; break; }
      sleep 2
    done
    if (( ! PANEL_OK )); then
      warn "x3-ui не healthy. Откатываю панель на $PANEL_ROLLBACK_TAG"
      docker tag "$PANEL_ROLLBACK_TAG" "$PANEL_IMAGE"
      docker compose up -d --no-deps --force-recreate "$PANEL_CONTAINER"
      die "Панель откатена; приложение уже обновлено, проверьте логи x3-ui"
    fi
    ok "x3-ui healthy"

    if (( BOOTSTRAP )); then
      log "Bootstrap x3-ui (только по явному --bootstrap)..."
      python3 xui_bootstrap.py || warn "xui_bootstrap.py failed"
      python3 server/src/scripts/fix_reality_inbound.py || warn "fix_reality_inbound.py failed"
      python3 server/src/scripts/patch_xray_routing.py || warn "patch_xray_routing.py failed"
    fi
  fi
fi

# --- 7. Итог ----------------------------------------------------------------
if (( ! DRY_RUN )); then
  echo
  docker ps --format 'table {{.Names}}\t{{.Status}}'
  echo
  log "Публичный health:"
  curl -sS -m 8 -o /dev/null -w 'https://izinet.online/api/health -> %{http_code}\n' https://izinet.online/api/health || true
  log "Логи $APP_SERVICE (последние 20 строк):"
  docker logs --tail 20 "$APP_SERVICE" || true
  echo
  ok "Готово. Бэкап: $BACKUP_DIR"
  log "При проблемах: docker tag $APP_ROLLBACK_TAG $APP_IMAGE && docker compose up -d --force-recreate --no-deps --no-build $APP_SERVICE"
else
  ok "Dry-run завершён; изменения не вносились"
fi
