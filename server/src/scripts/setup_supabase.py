#!/usr/bin/env python3
"""
IZINET — Auto-setup Supabase tables + vpn_servers entry for fresh install.
Reads config from .env, creates tables via Supabase REST API.
"""

import json
import os
import sys
import urllib.request
import urllib.error

def load_env(path='.env'):
    env = {}
    if os.path.exists(path):
        with open(path) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    k, v = line.split('=', 1)
                    env[k.strip()] = v.strip()
    return env

def supabase_request(url, api_key, method='GET', data=None):
    headers = {
        'apikey': api_key,
        'Authorization': f'Bearer {api_key}',
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
    }
    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        resp = urllib.request.urlopen(req)
        return resp.status, resp.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()

def table_exists(base_url, api_key, table_name):
    url = f'{base_url}/rest/v1/{table_name}?select=count&limit=0'
    status, _ = supabase_request(url, api_key)
    return status == 200

def create_table_sql(base_url, api_key, sql):
    url = f'{base_url}/rest/v1/rpc/exec_sql'
    status, body = supabase_request(url, api_key, method='POST', data={'query': sql})
    if status == 200:
        return True
    # Try alternative: direct SQL via pg_meta
    url2 = f'{base_url}/rest/v1/'
    return False

def insert_row(base_url, api_key, table, data):
    url = f'{base_url}/rest/v1/{table}'
    status, body = supabase_request(url, api_key, method='POST', data=data)
    return status in (200, 201)

def main():
    print("=" * 50)
    print("  IZINET — Supabase Auto-Setup")
    print("=" * 50)

    env = load_env()
    base_url = env.get('VITE_SUPABASE_URL', '').rstrip('/')
    api_key = env.get('SUPABASE_SERVICE_ROLE_KEY', '')

    if not base_url or not api_key:
        print("❌ VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not found in .env")
        sys.exit(1)

    print(f"📋 Supabase: {base_url}")

    # Check which tables exist
    tables = ['users', 'settings', 'vpn_servers', 'balances', 'subscriptions', 'transactions', 'payments', 'profiles', 'vpn_routing_rules']
    existing = []
    missing = []
    for t in tables:
        if table_exists(base_url, api_key, t):
            existing.append(t)
        else:
            missing.append(t)

    print(f"✅ Existing tables: {', '.join(existing) if existing else 'none'}")
    if missing:
        print(f"⚠️  Missing tables: {', '.join(missing)}")
        print("   Tables must be created via Supabase SQL Editor.")
        print(f"   Copy SQL from: Supabase.md")
        print(f"   URL: {base_url.replace('/rest/v1', '')}/sql/new")

    # Check vpn_servers has at least one entry
    url = f'{base_url}/rest/v1/vpn_servers?select=count&limit=0'
    status, _ = supabase_request(url, api_key)
    if status == 200:
        # Check if any servers exist
        url2 = f'{base_url}/rest/v1/vpn_servers?select=id&limit=1'
        status2, body2 = supabase_request(url2, api_key)
        if status2 == 200:
            data = json.loads(body2)
            if data:
                print(f"✅ vpn_servers has entries")
            else:
                print("⚠️  vpn_servers is empty — creating default OneD entry")
                server_ip = os.popen("curl -s ifconfig.me 2>/dev/null || echo '194.50.94.28'").read().strip()
                insert_row(base_url, api_key, 'vpn_servers', {
                    'name': 'OneD',
                    'ip': f'http://x3-ui:2053',
                    'domain': f'https://vpn.{env.get(\"DOMAIN\", \"izinet.online\")}',
                    'public_host': f'vpn.{env.get(\"DOMAIN\", \"izinet.online\")}',
                    'username': env.get('XUI_USERNAME', 'admin'),
                    'password': env.get('XUI_PASSWORD', 'admin'),
                    'is_active': True,
                    'inbound_id': 0,
                    'vpn_port': 443,
                    'health_status': 'unknown'
                })
                print("✅ Created default OneD server entry")

    # Check settings table
    url = f'{base_url}/rest/v1/settings?select=key&limit=10'
    status, body = supabase_request(url, api_key)
    if status == 200:
        settings = json.loads(body)
        keys = [s['key'] for s in settings]
        needed = {'MONTHLY_PRICE': '100', 'DEVICE_LIMIT': '2', 'PUBLIC_URL': f'https://{env.get("DOMAIN", "izinet.online")}'}
        for k, v in needed.items():
            if k not in keys:
                insert_row(base_url, api_key, 'settings', {'key': k, 'value': v})
                print(f"✅ Created setting: {k}={v}")

    print("")
    print("=" * 50)
    print("  Setup complete!")
    print("=" * 50)

    if missing:
        print(f"\n⚠️  MANUAL STEP REQUIRED:")
        print(f"   1. Open: {base_url.replace('/rest/v1', '')}/sql/new")
        print(f"   2. Paste contents of Supabase.md")
        print(f"   3. Click 'Run'")
        print(f"   4. Then run this script again")


if __name__ == "__main__":
    main()
