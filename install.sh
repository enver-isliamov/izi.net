#!/bin/bash

# izinet installer for clean Ubuntu/Debian VPS.
# Installs Docker, prepares /opt/izinet, creates .env, starts 3x-ui,
# then repairs/provisions the persistent 3x-ui SQLite DB for VLESS Reality.
set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'
INSTALL_DIR="/opt/izinet"
REPO_URL="https://github.com/enver-isliamov/izi.net.git"

echo -e "${GREEN}Starting izinet clean VPS installation...${NC}"

need_root_cmd() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  else
    sudo "$@"
  fi
}

read_value() {
  local var_name="$1"
  local prompt="$2"
  local default_value="${3:-}"
  local current_value="${!var_name:-}"
  if [ -n "$current_value" ]; then
    printf '%s' "$current_value"
    return
  fi
  if [ -n "$default_value" ]; then
    read -r -p "$prompt [$default_value]: " value < /dev/tty || value=""
    printf '%s' "${value:-$default_value}"
  else
    read -r -p "$prompt: " value < /dev/tty
    printf '%s' "$value"
  fi
}

compose_cmd() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose "$@"
  else
    echo "Docker Compose is not installed" >&2
    exit 1
  fi
}

echo "Installing system dependencies..."
need_root_cmd apt-get update
need_root_cmd apt-get install -y curl git jq cron sqlite3 python3 ca-certificates openssl

need_root_cmd systemctl enable cron >/dev/null 2>&1 || true
need_root_cmd systemctl start cron >/dev/null 2>&1 || true

if ! command -v docker >/dev/null 2>&1; then
  echo "Installing Docker..."
  curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
  need_root_cmd sh /tmp/get-docker.sh
  need_root_cmd usermod -aG docker "${SUDO_USER:-$USER}" || true
fi

if ! docker compose version >/dev/null 2>&1 && ! command -v docker-compose >/dev/null 2>&1; then
  echo "Installing Docker Compose plugin..."
  need_root_cmd apt-get install -y docker-compose-plugin || true
fi

if [ ! -d "$INSTALL_DIR/.git" ]; then
  echo "Cloning izinet to $INSTALL_DIR..."
  need_root_cmd mkdir -p "$INSTALL_DIR"
  need_root_cmd chown "${SUDO_USER:-$USER}:${SUDO_USER:-$USER}" "$INSTALL_DIR" || true
  git clone "$REPO_URL" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"

echo "Preparing environment..."
DOMAIN=$(read_value DOMAIN "Domain for the service" "izinet.online")
VITE_SUPABASE_URL=$(read_value VITE_SUPABASE_URL "Supabase URL")
VITE_SUPABASE_ANON_KEY=$(read_value VITE_SUPABASE_ANON_KEY "Supabase anon key")
SUPABASE_SERVICE_ROLE_KEY=$(read_value SUPABASE_SERVICE_ROLE_KEY "Supabase service role key")
TELEGRAM_BOT_TOKEN=$(read_value TELEGRAM_BOT_TOKEN "Telegram bot token (optional)" "")
VITE_TELEGRAM_BOT_NAME=$(read_value VITE_TELEGRAM_BOT_NAME "Telegram bot username without @ (optional)" "")
SERVER_IP=$(curl -fsS https://ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')

cat > .env <<EOF
DOMAIN=$DOMAIN
PUBLIC_URL=https://$DOMAIN
VITE_API_URL=http://$SERVER_IP:3005
VITE_SUPABASE_URL=$VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_KEY
TELEGRAM_BOT_TOKEN=$TELEGRAM_BOT_TOKEN
VITE_TELEGRAM_BOT_NAME=$VITE_TELEGRAM_BOT_NAME
XUI_HOST=http://x3-ui:2053
XUI_USERNAME=admin
XUI_PASSWORD=admin
XUI_INBOUND_ID=1
NODE_ENV=production
EOF

echo "Starting containers for initial 3x-ui database creation..."
compose_cmd up -d --build

if [ -f ./xui_bootstrap.py ]; then
  echo "Waiting for 3x-ui SQLite database..."
  for i in $(seq 1 60); do
    if [ -f ./xui-db/x-ui.db ]; then
      break
    fi
    sleep 2
  done

  echo "Provisioning and repairing 3x-ui VLESS Reality configuration..."
  python3 ./xui_bootstrap.py --wait-db 30 || true
  compose_cmd restart x3-ui || true
fi

echo "Finalizing stack startup..."
compose_cmd up -d --build

echo -e "${GREEN}Installation completed.${NC}"
echo -e "Dashboard: http://$SERVER_IP:3005"
echo -e "3x-ui panel: http://$SERVER_IP:2053 (default login/password: admin/admin)"
echo -e "${YELLOW}Change the default 3x-ui password after first login.${NC}"
