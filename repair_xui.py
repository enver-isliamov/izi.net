#!/usr/bin/env python3
"""
DEPRECATED — This script is replaced by xui_bootstrap.py.

xui_bootstrap.py handles everything repair_xui.py did, plus:
- Generates unique x25519 Reality keys (pure Python, no hardcoded keys)
- Creates Reality inbound from scratch if missing
- Normalizes fallback rules, sniffing, DNS settings
- Does NOT require .env Reality keys (keys live only in SQLite)

Usage: python3 xui_bootstrap.py --wait-db 10
"""
import os
import sys
import subprocess

PROJECT_DIR = "/opt/izinet"

def main():
    print("=" * 60)
    print("⚠️  DEPRECATED: repair_xui.py is replaced by xui_bootstrap.py")
    print("=" * 60)
    print()
    print("This script used hardcoded Reality keys which is INSECURE.")
    print("xui_bootstrap.py generates unique x25519 keys per server.")
    print()

    bootstrap_path = os.path.join(PROJECT_DIR, "xui_bootstrap.py")
    if not os.path.exists(bootstrap_path):
        bootstrap_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "xui_bootstrap.py")

    if os.path.exists(bootstrap_path):
        print(f"Running xui_bootstrap.py instead...")
        print()
        result = subprocess.run([sys.executable, bootstrap_path, "--wait-db", "10"])
        sys.exit(result.returncode)
    else:
        print("❌ xui_bootstrap.py not found!")
        print("Place it in the same directory as this script or in /opt/izinet/")
        sys.exit(1)

if __name__ == "__main__":
    main()
