#!/bin/bash
# IZINET — Deep diagnostic for 3x-ui panel state
# Run on server: bash diagnose_panel.sh

set -e
cd /opt/izinet || exit 1

echo "═══════════════════════════════════════════════════════════"
echo "  IZINET — 3x-ui Panel Deep Diagnostic"
echo "═══════════════════════════════════════════════════════════"
echo ""

# 1. Check all inbounds
echo "── 1. All Inbounds in 3x-ui ──"
docker exec x3-ui python3 -c "
import sqlite3, json
conn = sqlite3.connect('/etc/x-ui/x-ui.db')
c = conn.cursor()
c.execute('SELECT id, port, protocol, remark, enable FROM inbounds ORDER BY id')
for row in c.fetchall():
    iid, port, proto, remark, enable = row
    status = '✅' if enable else '❌'
    print(f'  {status} ID={iid} Port={port} Proto={proto} Remark={remark}')
conn.close()
"
echo ""

# 2. Check Reality inbound details
echo "── 2. Reality Inbound (port 443) Details ──"
docker exec x3-ui python3 -c "
import sqlite3, json
conn = sqlite3.connect('/etc/x-ui/x-ui.db')
c = conn.cursor()
c.execute('SELECT id, settings, stream_settings FROM inbounds WHERE port=443')
row = c.fetchone()
if row:
    iid, sett_raw, stream_raw = row
    sett = json.loads(sett_raw or '{}')
    stream = json.loads(stream_raw or '{}')
    clients = sett.get('clients', [])
    print(f'  Inbound ID: {iid}')
    print(f'  Clients count: {len(clients)}')
    print(f'  Security: {stream.get(\"security\")}')
    rs = stream.get('realitySettings', {})
    inner = rs.get('settings', rs)
    print(f'  Public Key: {(inner.get(\"publicKey\",\"\") or rs.get(\"publicKey\",\"\"))[:30]}...')
    print(f'  Fingerprint: {inner.get(\"fingerprint\",\"\")}')
    print(f'  Server Names: {rs.get(\"serverNames\")}')
    print()
    print('  First 5 clients:')
    for cl in clients[:5]:
        print(f'    email={cl.get(\"email\",\"\")} uuid={cl.get(\"id\",\"\")[:12]}... flow={cl.get(\"flow\",\"\")}')
    if len(clients) > 5:
        print(f'    ... and {len(clients)-5} more')
else:
    print('  ❌ No inbound on port 443!')
conn.close()
"
echo ""

# 3. Check ALL clients across all inbounds
echo "── 3. All Clients (all inbounds) ──"
docker exec x3-ui python3 -c "
import sqlite3, json
conn = sqlite3.connect('/etc/x-ui/x-ui.db')
c = conn.cursor()
c.execute('SELECT id, port, remark, settings FROM inbounds')
total = 0
for row in c.fetchall():
    iid, port, remark, sett_raw = row
    sett = json.loads(sett_raw or '{}')
    clients = sett.get('clients', [])
    total += len(clients)
    if clients:
        print(f'  Inbound {iid} ({remark}, port {port}): {len(clients)} clients')
print(f'  Total clients: {total}')
conn.close()
"
echo ""

# 4. Test backend → 3x-ui connectivity
echo "── 4. Backend → 3x-ui Connectivity ──"
docker exec izinet-app node -e "
const axios = require('axios');
async function test() {
    try {
        const resp = await axios.get('http://x3-ui:2053/', { timeout: 5000 });
        console.log('  ✅ 3x-ui reachable: HTTP ' + resp.status);
    } catch(e) {
        console.log('  ❌ 3x-ui NOT reachable: ' + e.message);
    }
    try {
        const resp = await axios.get('http://x3-ui:2053/panel/api/inbounds/list', { timeout: 5000 });
        console.log('  ✅ Inbounds API: ' + (resp.data?.success ? 'OK' : 'FAIL'));
    } catch(e) {
        console.log('  ❌ Inbounds API failed: ' + e.message);
    }
}
test();
" 2>/dev/null
echo ""

# 5. Test Supabase connectivity from browser perspective
echo "── 5. Supabase Connectivity ──"
curl -s -o /dev/null -w "HTTP %{http_code}" https://rtynukkoueqpvemlshdx.supabase.co/rest/v1/ 2>/dev/null
echo ""
echo ""

# 6. Check backend logs for XUI errors
echo "── 6. Recent XUI Errors in Backend Logs ──"
docker logs izinet-app 2>&1 | grep -i "xui\|addClient\|error\|fail\|record" | tail -15
echo ""

echo "═══════════════════════════════════════════════════════════"
echo "  Copy this output and send it to me"
echo "═══════════════════════════════════════════════════════════"
