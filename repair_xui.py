#!/usr/bin/env python3
import os
import sqlite3
import json
import subprocess
import time

DB_PATH = "/opt/izinet/xui-db/x-ui.db"
PROJECT_DIR = "/opt/izinet"

def main():
    print("====================================================")
    print("🛠️  IZINET MASTER DOCTOR (DOCKER VERSION)")
    print("====================================================")
    
    if not os.path.exists(DB_PATH):
        print("❌ Database not found at " + DB_PATH)
        return

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # 1. СБРОС ШАБЛОНА
    print("⚙️  Resetting Xray template...")
    cursor.execute("UPDATE settings SET value = '' WHERE key = 'xrayTemplateConfig';")

    # 2. НАСТРОЙКА ПОРТА 443 (REALITY)
    print("⚙️  Configuring Port 443 (Reality + Fallbacks)...")
    cursor.execute("SELECT id, settings, stream_settings FROM inbounds WHERE port = 443;")
    inbound = cursor.fetchone()
    
    if inbound:
        iid, sett_str, stream_str = inbound
        settings = json.loads(sett_str) if sett_str else {}
        stream = json.loads(stream_str) if stream_str else {}
        
        # А) Снимаем все ограничения
        if "clients" in settings:
            for client in settings["clients"]:
                client["limitIp"] = 0
                client["totalGB"] = 0
        
        # Б) Правильные Fallbacks (по стандартам ветки work)
        settings["fallbacks"] = [
            {"name": "izinet.online", "dest": "host.docker.internal:3443", "xver": 0},
            {"name": "www.izinet.online", "dest": "host.docker.internal:3443", "xver": 0},
            {"dest": "host.docker.internal:3443", "xver": 0}
        ]
        
        # В) Параметры Reality (Original Keys)
        stream["security"] = "reality"
        if "realitySettings" not in stream: stream["realitySettings"] = {}
        rs = stream["realitySettings"]
        rs["dest"] = "www.microsoft.com:443"
        rs["serverNames"] = ["www.microsoft.com", "microsoft.com"]
        rs["privateKey"] = "ABiVSJTP0fEMzgsHghSAsQJp-bYAJAat0jErpzaGtEo"
        rs["shortIds"] = ["79b27cf7799d5b4c", "0248", "36b963e7713fa1", "34d587", "ff"]
        
        if "settings" not in rs: rs["settings"] = {}
        rs["settings"]["publicKey"] = "CXL0o8BEC7wz-TIuA7w-QBbJIadSsb9xL7G6UB410Xw"
        rs["publicKey"] = "CXL0o8BEC7wz-TIuA7w-QBbJIadSsb9xL7G6UB410Xw"
        
        # Г) ВКЛЮЧАЕМ SNIFFING (Критично для Fallbacks!)
        sniffing = {"enabled": True, "destOverride": ["http", "tls"], "routeOnly": False}
        
        cursor.execute("UPDATE inbounds SET settings=?, stream_settings=?, sniffing=?, enable=1 WHERE id=?;", 
                       (json.dumps(settings), json.dumps(stream), json.dumps(sniffing), iid))
        print("✅ Port 443 configured with SNI Sniffing and multi-fallbacks.")

    # 3. ОЧИСТКА ГЛОБАЛЬНЫХ НАСТРОЕК
    print("🧹 Cleaning global settings...")
    cursor.execute("UPDATE settings SET value = 'http://127.0.0.1:2053/ignore' WHERE key = 'ExternalTrafficInformURI';")
    cursor.execute("UPDATE settings SET value = 'false' WHERE key = 'TgBotEnable';")

    # 4. ОТКЛЮЧЕНИЕ ВСЕГО ЛИШНЕГО
    cursor.execute("UPDATE inbounds SET enable = 0 WHERE port NOT IN (443, 2053, 2096);")

    conn.commit()
    conn.close()

    # 5. ПЕРЕЗАПУСК (HARD RESTART)
    print("\n🔄 Hard restarting system...")
    subprocess.run(["docker", "compose", "down"], cwd=PROJECT_DIR)
    # Используем --build чтобы применить изменения в коде
    subprocess.run(["docker", "compose", "up", "-d", "--build"], cwd=PROJECT_DIR)
    
    print("\n⏳ System is ready. Check https://izinet.online")
    print("====================================================")

if __name__ == "__main__":
    main()
