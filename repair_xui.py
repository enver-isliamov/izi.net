#!/usr/bin/env python3
import os
import sqlite3
import json
import subprocess
import time

DB_PATH = "/opt/izinet/xui-db/x-ui.db"
PROJECT_DIR = "/opt/izinet"

# Стандартный рабочий шаблон Xray (чтобы интернет не пропадал)
STANDARD_TEMPLATE = {
    "routing": {
        "domainStrategy": "AsIs",
        "rules": [
            {"type": "field", "outboundTag": "block", "domain": ["geosite:category-ads-all"]},
            {"type": "field", "outboundTag": "direct", "domain": ["domain:izinet.online", "geosite:ru"]},
            {"type": "field", "outboundTag": "direct", "ip": ["geoip:ru", "geoip:private"]}
        ]
    },
    "outbounds": [
        {"protocol": "freedom", "tag": "direct"},
        {"protocol": "blackhole", "tag": "block"}
    ]
}

def main():
    print("====================================================")
    print("🛠️  IZINET EMERGENCY RESTORATION (STABLE VERSION)")
    print("====================================================")
    
    if not os.path.exists(DB_PATH):
        print("❌ Database not found!")
        return

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # 1. ВОССТАНОВЛЕНИЕ ШАБЛОНА XRAY (Мозги системы)
    print("⚙️  Restoring Xray JSON template (Fixing Internet)...")
    template_json = json.dumps(STANDARD_TEMPLATE, indent=2)
    cursor.execute("UPDATE settings SET value = ? WHERE key = 'xrayTemplateConfig';", (template_json,))

    # 2. ФИКСАЦИЯ ПОРТА 443 (Reality)
    print("⚙️  Configuring Port 443 (Reality + Fallback)...")
    cursor.execute("SELECT id, settings, stream_settings FROM inbounds WHERE port = 443;")
    inbound = cursor.fetchone()
    if inbound:
        iid, sett_str, stream_str = inbound
        settings = json.loads(sett_str)
        stream = json.loads(stream_str)
        
        # Снимаем ограничения (limitIp: 0)
        if "clients" in settings:
            for client in settings["clients"]:
                client["limitIp"] = 0
        
        # Правильный Fallback на сайт
        settings["fallbacks"] = [{"dest": "host.docker.internal:3443", "xver": 0}]
        
        # Стабильный SNI (Microsoft)
        stream["security"] = "reality"
        if "realitySettings" not in stream: stream["realitySettings"] = {}
        rs = stream["realitySettings"]
        rs["dest"] = "www.microsoft.com:443"
        rs["serverNames"] = ["www.microsoft.com", "microsoft.com"]
        rs["shortIds"] = ["79b27cf7799d5b4c"]
        rs["privateKey"] = "ABiVSJTP0fEMzgsHghSAsQJp-bYAJAat0jErpzaGtEo"
        
        if "settings" not in rs: rs["settings"] = {}
        rs["settings"]["publicKey"] = "CXL0o8BEC7wz-TIuA7w-QBbJIadSsb9xL7G6UB410Xw"
        
        cursor.execute("UPDATE inbounds SET settings=?, stream_settings=?, enable=1 WHERE id=?;", 
                       (json.dumps(settings), json.dumps(stream), iid))

    # 3. ЧИСТКА ЛОГОВ И ОТКЛЮЧЕНИЕ ЛИШНЕГО
    print("🧹 Cleaning logs and disabling broken ports...")
    cursor.execute("UPDATE settings SET value = 'http://127.0.0.1:2053/ignore' WHERE key = 'ExternalTrafficInformURI';")
    cursor.execute("UPDATE inbounds SET enable = 0 WHERE port != 443 AND port != 2053;")

    conn.commit()
    conn.close()

    # 4. ПЕРЕЗАПУСК
    print("\n🔄 Restarting system (Clean Boot)...")
    subprocess.run(["docker", "compose", "down"], cwd=PROJECT_DIR)
    subprocess.run(["docker", "compose", "up", "-d"], cwd=PROJECT_DIR)
    
    print("\n⏳ Startup complete. Website and VPN should be working now.")
    print("====================================================")

if __name__ == "__main__":
    main()
