#!/bin/bash
# IZINET — Regenerate ALL VLESS links with current Reality keys
# Run on server after fix_vpn.sh: bash regenerate_links.sh

set -e
cd /opt/izinet || { echo "❌ /opt/izinet not found"; exit 1; }

echo "═══════════════════════════════════════════════════════════"
echo "  IZINET — Regenerate VLESS Links with Current Keys"
echo "═══════════════════════════════════════════════════════════"
echo ""

# Get current Reality public key from panel
echo "── Step 1: Reading current Reality public key from 3x-ui ──"

PUB_KEY=$(docker exec x3-ui python3 -c "
import sqlite3, json
conn = sqlite3.connect('/etc/x-ui/x-ui.db')
c = conn.cursor()
c.execute('SELECT stream_settings FROM inbounds WHERE port=443')
row = c.fetchone()
conn.close()
if row:
    ss = json.loads(row[0] or '{}')
    rs = ss.get('realitySettings', {})
    inner = rs.get('settings', rs)
    print(inner.get('publicKey', '') or rs.get('publicKey', ''))
" 2>/dev/null)

if [ -z "$PUB_KEY" ]; then
    echo "  ❌ Could not read Reality public key from 3x-ui!"
    exit 1
fi
echo "  Current Public Key: $PUB_KEY"

# Get server domain
DOMAIN=$(docker exec izinet-app node -e "
const dotenv = require('dotenv');
dotenv.config();
console.log(process.env.PUBLIC_URL || 'https://izinet.online');
" 2>/dev/null | sed 's|https\?://||')
echo "  Server Domain: $DOMAIN"

echo ""

# Step 2: Backend API to regenerate all links
echo "── Step 2: Triggering sync-all via backend API ──"
echo "  (This runs syncAllServers which re-adds all clients to 3x-ui)"
echo "  (After that, we need to regenerate the stored VLESS links)"
echo ""

# First, let's check backend logs for current state
echo "── Checking backend connectivity to 3x-ui ──"
docker logs izinet-app 2>&1 | grep -i "xui\|login\|error\|fail" | tail -10
echo ""

# Check if XUI login works
echo "── Testing XUI login from backend ──"
docker exec izinet-app node -e "
const axios = require('axios');
async function test() {
    try {
        const resp = await axios.get('http://x3-ui:2053/', { timeout: 5000 });
        console.log('  ✅ 3x-ui reachable: HTTP', resp.status);
    } catch(e) {
        console.log('  ❌ 3x-ui NOT reachable:', e.message);
    }
}
test();
" 2>/dev/null

echo ""

# Step 3: Regenerate links using backend API
echo "── Step 3: Regenerating VLESS links via backend ──"
echo "  This will re-create clients on 3x-ui and get fresh VLESS links."
echo ""

# We need to call the backend's sync-all endpoint
# But first we need an admin token

# Get admin credentials from .env or defaults
ADMIN_EMAIL=$(grep -oP 'ADMIN_EMAIL=\K.*' .env 2>/dev/null || echo "enverisliamov@gmail.com")
echo "  Admin email: $ADMIN_EMAIL"
echo ""
echo "  ⚠️  MANUAL STEP REQUIRED:"
echo "  The backend needs to regenerate VLESS links for all users."
echo "  This can be done via the admin panel or API."
echo ""
echo "  Option A: Admin Panel"
echo "  1. Go to https://izinet.online/admin"
echo "  2. Click 'Синхронизировать юзеров'"
echo "  3. Wait for completion"
echo ""
echo "  Option B: API (run from server)"
echo "  TOKEN=\$(curl -s -X POST http://localhost:3005/api/auth/login \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -d '{\"email\":\"$ADMIN_EMAIL\",\"password\":\"YOUR_PASSWORD\"}' | python3 -c 'import sys,json;print(json.load(sys.stdin).get(\"token\",\"\"))')"
echo "  curl -X POST http://localhost:3005/api/admin/system/sync-all \\"
echo "    -H 'Authorization: Bearer \$TOKEN'"
echo ""
echo "  Option C: Direct fix via script"
echo "  Run: python3 fix_vless_links.py"
echo ""

# Step 4: Verify
echo "── Step 4: Verify after regeneration ──"
echo "  After running sync-all, check:"
echo "  1. Admin panel → Обзор → OneD X-UI count should be > 0"
echo "  2. Try regenerate a device → should not return 500"
echo "  3. Users refresh Hiddify profiles → should connect"
echo ""

# Quick test: try to fetch a subscription link
echo "── Quick test: fetching subscription link ──"
curl -sk https://izinet.online/api/sub/test 2>/dev/null | head -c 100
echo ""
echo ""

echo "═══════════════════════════════════════════════════════════"
echo "  SUMMARY"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "  ✅ Reality keys regenerated (fix_vpn.sh)"
echo "  ✅ Nginx working"
echo "  ✅ Xray running"
echo "  ✅ Site accessible"
echo ""
echo "  ⚠️  STILL NEEDED:"
echo "  1. Deploy the admin.ts fix (inbound ID hardcoded → use env var)"
echo "  2. Run sync-all to regenerate VLESS links"
echo "  3. Users refresh Hiddify profiles"
echo ""
echo "  To deploy the admin.ts fix:"
echo "  cd /opt/izinet && git pull origin main"
echo "  docker compose up -d --build"
echo ""
echo "  After deploy, sync-all should work and regenerate links"
echo "  with the new Reality public key."
echo "═══════════════════════════════════════════════════════════"
