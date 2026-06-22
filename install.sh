#!/bin/bash
# IZINET — Full Installer for Clean VPS (Ubuntu/Debian)
# Sets up Docker, Reality VPN, Nginx SSL, Firewall — all from scratch.

set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}====================================================${NC}"
echo -e "${GREEN} IZINET Installer (2026)${NC}"
echo -e "${BLUE}====================================================${NC}"

# ── 1. System dependencies ──
echo "Installing system packages..."
sudo apt-get update -qq
sudo apt-get install -y -qq curl git jq nginx certbot python3-certbot-nginx ufw sqlite3

# ── 2. Docker ──
if ! command -v docker &> /dev/null; then
    echo "Installing Docker..."
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    rm get-docker.sh
    sudo usermod -aG docker "$USER"
fi

if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    echo "Installing Docker Compose plugin..."
    sudo apt-get install -y -qq docker-compose-plugin
fi

# ── 3. Clone repository ──
INSTALL_DIR="/opt/izinet"
if [ ! -d "$INSTALL_DIR" ]; then
    echo "Cloning repository to $INSTALL_DIR..."
    sudo mkdir -p "$INSTALL_DIR"
    sudo chown "$USER:$USER" "$INSTALL_DIR"
    git clone https://github.com/enver-isliamov/izi.net.git "$INSTALL_DIR"
fi
cd "$INSTALL_DIR"

# ── 4. Collect configuration ──
echo -e "\n${BLUE}Environment setup:${NC}"
read -p "Domain [izinet.online]: " DOMAIN
DOMAIN="${DOMAIN:-izinet.online}"
read -p "Supabase URL: " SB_URL
read -p "Supabase Anon Key: " SB_ANON
read -p "Supabase Service Role Key: " SB_SERVICE
read -p "Telegram Bot Token: " TG_TOKEN
read -p "Telegram Bot Name (without @): " TG_NAME
read -p "Enot.io Merchant ID: " ENOT_ID
read -p "Enot.io Secret Key: " ENOT_SECRET

SERVER_IP=$(curl -s ifconfig.me 2>/dev/null || echo "YOUR_IP")

# ── 5. Create .env (without Reality keys yet — we generate them after Docker starts) ──
echo "Creating .env..."
cat <<EOF > .env
DOMAIN=$DOMAIN
PUBLIC_URL=https://$DOMAIN
VITE_SUPABASE_URL=$SB_URL
VITE_SUPABASE_ANON_KEY=$SB_ANON
SUPABASE_SERVICE_ROLE_KEY=$SB_SERVICE
TELEGRAM_BOT_TOKEN=$TG_TOKEN
VITE_TELEGRAM_BOT_NAME=$TG_NAME
ENOT_MERCHANT_ID=$ENOT_ID
ENOT_SECRET_KEY=$ENOT_SECRET
ENOT_SECRET_KEY2=$ENOT_SECRET
XUI_USERNAME=admin
XUI_PASSWORD=admin
XUI_HOST=http://x3-ui:2053
XUI_INBOUND_ID=1
VITE_API_URL=https://$DOMAIN
NODE_ENV=production
IS_DOCKER=true
PORT=3005
EOF

# ── 6. Start Docker containers ──
echo "Starting Docker containers..."
docker compose up -d --build

echo "Waiting for x3-ui to start..."
sleep 15

# ── 7. Bootstrap 3x-ui (generate Reality keys + create inbound in SQLite) ──
echo "Bootstrapping 3x-ui Reality inbound (generates unique x25519 keys)..."
if [ -f "xui_bootstrap.py" ]; then
    python3 xui_bootstrap.py --wait-db 15
    echo "Reality inbound created. Keys are stored in SQLite (x-ui.db), NOT in .env."
else
    echo -e "${RED}WARNING: xui_bootstrap.py not found. Reality inbound may not be created.${NC}"
    echo "Run manually: python3 xui_bootstrap.py --wait-db 10"
fi

# ── 9. SSL certificate ──
echo "Obtaining SSL certificate..."
if [ ! -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
    # Stop containers that might bind port 80
    docker compose stop izinet-app 2>/dev/null || true
    sudo certbot certonly --standalone -d "$DOMAIN" -d "www.$DOMAIN" \
        --non-interactive --agree-tos --email "admin@$DOMAIN" || true
    docker compose start izinet-app 2>/dev/null || true
else
    echo "SSL certificate already exists."
fi

# ── 10. Nginx configuration (port 3443 — NOT 443!) ──
echo "Configuring Nginx on port 3443..."

cat <<NGINXEOF | sudo tee /etc/nginx/sites-available/izinet > /dev/null
server {
    listen 3443 ssl;
    http2 on;
    server_name $DOMAIN www.$DOMAIN;

    ssl_certificate     /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    add_header X-Backend-Server "izinet-app" always;

    location / {
        proxy_pass http://127.0.0.1:3005;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
}

server {
    listen 80;
    server_name $DOMAIN www.$DOMAIN;
    return 301 https://\$host\$request_uri;
}
NGINXEOF

sudo ln -sf /etc/nginx/sites-available/izinet /etc/nginx/sites-enabled/izinet
sudo rm -f /etc/nginx/sites-enabled/default

# Test and reload Nginx
if sudo nginx -t 2>/dev/null; then
    sudo systemctl enable nginx
    sudo systemctl restart nginx
    echo "Nginx configured on port 3443."
else
    echo -e "${RED}Nginx config test failed! Check /etc/nginx/sites-available/izinet${NC}"
fi

# ── 11. UFW Firewall ──
echo "Configuring UFW firewall..."
if command -v ufw &> /dev/null; then
    sudo ufw allow 22/tcp  2>/dev/null || true
    sudo ufw allow 80/tcp  2>/dev/null || true
    sudo ufw allow 443/tcp 2>/dev/null || true
    sudo ufw allow 2053/tcp 2>/dev/null || true
    sudo ufw allow 3005/tcp 2>/dev/null || true
    sudo ufw allow 3443/tcp 2>/dev/null || true
    sudo ufw allow 41758/tcp 2>/dev/null || true
    # Allow Docker subnet to reach host port 3443 (Reality fallback)
    sudo ufw allow from 172.16.0.0/12 to any port 3443 2>/dev/null || true
    sudo ufw allow from 192.168.0.0/16 to any port 3443 2>/dev/null || true
    echo "y" | sudo ufw enable 2>/dev/null || true
    echo "UFW configured."
else
    echo "UFW not installed. Skipping firewall setup."
fi

# ── 12. Restart everything with new config ──
echo "Final restart..."
docker compose down
docker compose up -d --build
sleep 10

# ── 13. Health check ──
echo ""
echo -e "${BLUE}====================================================${NC}"
echo -e "${GREEN} INSTALLATION COMPLETE${NC}"
echo -e "${BLUE}====================================================${NC}"
echo ""
echo "Site:     https://$DOMAIN"
echo "Admin:    https://$DOMAIN/admin"
echo "3x-ui:    http://$SERVER_IP:2053 (login: admin/admin)"
echo ""
echo "Reality keys are stored in 3x-ui SQLite (x-ui.db)."
echo "To view: docker exec x3-ui sqlite3 /etc/x-ui/x-ui.db \\"
echo "  \"SELECT json_extract(stream_settings, '$.realitySettings.publicKey') FROM inbounds WHERE port=443;\""
echo ""

# Quick health checks
echo "Running health checks..."
echo -n "  Backend (3005): "
if curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3005 | grep -q "200\|304"; then
    echo "OK"
else
    echo "FAIL"
fi

echo -n "  Nginx (3443):    "
if curl -sk -o /dev/null -w "%{http_code}" https://127.0.0.1:3443/ 2>/dev/null | grep -q "200\|304"; then
    echo "OK"
else
    echo "FAIL (check SSL cert and Nginx)"
fi

echo -n "  3x-ui (2053):    "
if curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:2053/ 2>/dev/null | grep -q "200\|302\|404"; then
    echo "OK"
else
    echo "FAIL"
fi

echo ""
echo "Important:"
echo "  - Cloudflare DNS must be DNS Only (grey cloud), NOT Proxied!"
echo "  - Change 3x-ui default password after first login"
echo "  - Run 'python3 xui_bootstrap.py' if Reality inbound is missing"
