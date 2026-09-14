#!/bin/bash
# IZINET — Reality Key Regeneration + Full Fix Script
# Run on server: bash fix_vpn.sh

set -e
cd /opt/izinet || { echo "❌ /opt/izinet not found"; exit 1; }

echo "═══════════════════════════════════════════════════════════"
echo "  IZINET VPN FIX — Reality Keys + Diagnostics"
echo "═══════════════════════════════════════════════════════════"
echo ""

# ─── Step 1: Generate new unique Reality keys ───
echo "── Step 1: Generating new unique x25519 Reality keys ──"

docker exec x3-ui python3 -c "
import secrets, json, sqlite3, base64

def b64url(raw):
    return base64.urlsafe_b64encode(raw).decode().rstrip('=')

def x25519_public_key(private_key):
    p = 2**255 - 19; a24 = 121665
    scalar = bytearray(private_key)
    scalar[0] &= 248; scalar[31] &= 127; scalar[31] |= 64
    k = int.from_bytes(scalar, 'little'); u = 9; x1 = u; x2, z2 = 1, 0; x3, z3 = u, 1; swap = 0
    for t in reversed(range(255)):
        kt = (k >> t) & 1; swap ^= kt
        if swap: x2, x3 = x3, x2; z2, z3 = z3, z2
        swap = kt; a = (x2 + z2) % p; aa = (a * a) % p; b = (x2 - z2) % p; bb = (b * b) % p
        e = (aa - bb) % p; c = (x3 + z3) % p; d = (x3 - z3) % p; da = (d * a) % p; cb = (c * b) % p
        x3 = ((da + cb) ** 2) % p; z3 = (x1 * ((da - cb) ** 2)) % p; x2 = (aa * bb) % p; z2 = (e * (aa + a24 * e)) % p
    if swap: x2, x3 = x3, x2; z2, z3 = z3, z2
    public = (x2 * pow(z2, p - 2, p)) % p
    return public.to_bytes(32, 'little')

private = bytearray(secrets.token_bytes(32))
private[0] &= 248; private[31] &= 127; private[31] |= 64
private = bytes(private)
priv_key = b64url(private)
pub_key = b64url(x25519_public_key(private))

print(f'  New Public Key:  {pub_key}')
print(f'  New Private Key: {priv_key[:20]}...')

conn = sqlite3.connect('/etc/x-ui/x-ui.db')
c = conn.cursor()

# Update all Reality inbounds on port 443
c.execute('SELECT id, remark, stream_settings FROM inbounds WHERE port=443')
updated = 0
for iid, remark, ss_raw in c.fetchall():
    ss = json.loads(ss_raw or '{}')
    rs = ss.get('realitySettings', {})
    rs['privateKey'] = priv_key
    rs['publicKey'] = pub_key
    rs['serverNames'] = ['www.microsoft.com', 'microsoft.com']
    if 'settings' in rs:
        rs['settings']['publicKey'] = pub_key
        rs['settings']['fingerprint'] = 'chrome'
        rs['settings']['serverName'] = 'www.microsoft.com'
    ss['realitySettings'] = rs
    c.execute('UPDATE inbounds SET stream_settings=? WHERE id=?', (json.dumps(ss), iid))
    print(f'  Updated inbound {iid} ({remark})')
    updated += 1

# Also update any other Reality inbounds (2443, 22053, etc.)
c.execute('SELECT id, port, remark, stream_settings FROM inbounds WHERE port != 443')
for iid, port, remark, ss_raw in c.fetchall():
    ss = json.loads(ss_raw or '{}')
    if ss.get('security') == 'reality':
        rs = ss.get('realitySettings', {})
        rs['privateKey'] = priv_key
        rs['publicKey'] = pub_key
        if 'settings' in rs:
            rs['settings']['publicKey'] = pub_key
        ss['realitySettings'] = rs
        c.execute('UPDATE inbounds SET stream_settings=? WHERE id=?', (json.dumps(ss), iid))
        print(f'  Updated inbound {iid} ({remark}, port {port})')
        updated += 1

conn.commit()
conn.close()
print(f'  Total updated: {updated} inbounds')
"

echo ""

# ─── Step 2: Fix Nginx if broken ───
echo "── Step 2: Checking Nginx ──"

if [ -f /opt/izinet/nginx-host.conf ]; then
    cp /opt/izinet/nginx-host.conf /etc/nginx/sites-available/izinet
    ln -sf /etc/nginx/sites-available/izinet /etc/nginx/sites-enabled/izinet
fi

if nginx -t 2>/dev/null; then
    systemctl reload nginx
    echo "  ✅ Nginx OK and reloaded"
else
    echo "  ❌ Nginx config test failed!"
    nginx -t
fi

echo ""

# ─── Step 3: Disable broken inbound-8443 if exists ───
echo "── Step 3: Checking for broken inbounds ──"

docker exec x3-ui python3 -c "
import sqlite3
conn = sqlite3.connect('/etc/x-ui/x-ui.db')
c = conn.cursor()
c.execute('SELECT id, port, remark, enable FROM inbounds WHERE enable=1')
for row in c.fetchall():
    iid, port, remark, enable = row
    # Check if inbound has TLS cert reference that might not exist
    if port == 8443:
        print(f'  Disabling inbound {iid}: {remark} (port {port}) — cert may be missing')
        c.execute('UPDATE inbounds SET enable=0 WHERE id=?', (iid,))
conn.commit()
conn.close()
"

echo ""

# ─── Step 4: Restart Xray ───
echo "── Step 4: Restarting x3-ui ──"

docker compose restart x3-ui
echo "  Waiting 15 seconds for Xray to start..."
sleep 15

# Check Xray status
if docker logs x3-ui 2>&1 | grep -q "Xray.*started"; then
    echo "  ✅ Xray started successfully"
else
    echo "  ⚠️  Xray may not have started. Checking logs..."
    docker logs x3-ui 2>&1 | tail -10
fi

echo ""

# ─── Step 5: Verify Reality config ───
echo "── Step 5: Verifying Reality configuration ──"

docker exec x3-ui python3 -c "
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
    pub = inner.get('publicKey', '') or rs.get('publicKey', '')
    fp = inner.get('fingerprint', '')
    sni = rs.get('serverNames', [])
    priv = rs.get('privateKey', '')
    
    print(f'  Security: {ss.get(\"security\")}')
    print(f'  Public Key:  {pub[:30]}...')
    print(f'  Private Key: {priv[:20]}...')
    print(f'  Fingerprint: {fp}')
    print(f'  Server Names: {sni}')
    
    if fp == 'chrome':
        print('  ✅ Fingerprint: chrome')
    else:
        print(f'  ❌ Fingerprint should be chrome, got: {fp}')
    
    if len(pub) > 10 and pub != 'CXL0o8BEC7wz-TluA7w-QBbJIadSsb9xL7G6UB410Xw':
        print('  ✅ Public key is unique (not hardcoded)')
    else:
        print('  ❌ Public key is still hardcoded!')
else:
    print('  ❌ No inbound on port 443!')
"

echo ""

# ─── Step 6: Test site ───
echo "── Step 6: Testing site access ──"

SITE_RESPONSE=$(curl -sk -o /dev/null -w "%{http_code}" https://izinet.online/ 2>/dev/null)
if [ "$SITE_RESPONSE" = "200" ] || [ "$SITE_RESPONSE" = "304" ]; then
    echo "  ✅ Site https://izinet.online → HTTP $SITE_RESPONSE"
else
    echo "  ❌ Site returned HTTP $SITE_RESPONSE"
fi

# Test fallback
docker exec x3-ui wget -qO- --spider --timeout=5 https://host.docker.internal:3443/ 2>/dev/null && \
    echo "  ✅ Fallback (Docker → host:3443) OK" || \
    echo "  ❌ Fallback BROKEN"

echo ""

# ─── Step 7: Run full diagnostics ───
echo "── Step 7: Running diagnose.sh ──"

if [ -f diagnose.sh ]; then
    bash diagnose.sh 2>&1 | head -80
else
    echo "  diagnose.sh not found"
fi

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  DONE! Now you need to:"
echo "  1. Go to admin panel → Обзор/Серверы → Синхронизировать юзеров"
echo "  2. This will regenerate VLESS links with new Reality keys"
echo "  3. Users must refresh their Hiddify profiles"
echo "═══════════════════════════════════════════════════════════"
