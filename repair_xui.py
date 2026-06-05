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
    print("🛠️  IZINET COMPATIBILITY RECOVERY & UI FIX")
    print("====================================================")
    
    if not os.path.exists(DB_PATH):
        print("❌ Database not found!")
        return

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # 1. ВОССТАНОВЛЕНИЕ ОРИГИНАЛЬНОГО КЛЮЧА REALITY (для совместимости со старыми ссылками)
    # Эти ключи соответствуют тем, что прописаны в базе подписок сайта
    ORIGINAL_PRIV_KEY = "ABiVSJTP0fEMzgsHghSAsQJp-bYAJAat0jErpzaGtEo"
    ORIGINAL_PUB_KEY = "CXL0o8BEC7wz-TIuA7w-QBbJIadSsb9xL7G6UB410Xw"
    
    print("⚙️  Restoring original Reality keys for link compatibility...")
    cursor.execute("SELECT id, settings, stream_settings FROM inbounds WHERE port = 443;")
    inbound = cursor.fetchone()
    if inbound:
        iid, sett_str, stream_str = inbound
        settings = json.loads(sett_str)
        stream = json.loads(stream_str)
        
        # Настройка Reality
        stream["security"] = "reality"
        if "realitySettings" not in stream: stream["realitySettings"] = {}
        rs = stream["realitySettings"]
        
        rs["privateKey"] = ORIGINAL_PRIV_KEY
        rs["dest"] = "www.microsoft.com:443"
        rs["serverNames"] = ["www.microsoft.com", "microsoft.com"]
        
        # В некоторых версиях XUI ключи лежат в settings внутри realitySettings
        if "settings" not in rs: rs["settings"] = {}
        rs["settings"]["publicKey"] = ORIGINAL_PUB_KEY
        rs["publicKey"] = ORIGINAL_PUB_KEY # Дублируем для надежности
        
        # Настройка Fallback (чтобы сайт открывался через 443 порт)
        settings["fallbacks"] = [
            {"dest": "host.docker.internal:3443", "xver": 0},
            {"name": "izinet.online", "dest": "host.docker.internal:3443", "xver": 0}
        ]
        
        cursor.execute("UPDATE inbounds SET settings = ?, stream_settings = ?, enable = 1 WHERE id = ?;", 
                       (json.dumps(settings), json.dumps(stream), iid))
        print("✅ Original keys and fallback restored on port 443.")

    # 2. ОТКЛЮЧЕНИЕ ПРОБЛЕМНЫХ ПОРТОВ (чтобы Xray не падал)
    print("🧹 Disabling broken port 8443...")
    cursor.execute("UPDATE inbounds SET enable = 0 WHERE port = 8443;")

    # 3. ОЧИСТКА СПАМА В ЛОГАХ (чтобы API сайта работало быстрее)
    print("🧹 Cleaning panel settings table...")
    try:
        cursor.execute("UPDATE settings SET value = '' WHERE key = 'ExternalTrafficInformURI';")
    except: pass

    conn.commit()
    conn.close()

    # 4. ПЕРЕЗАПУСК ВСЕЙ СИСТЕМЫ
    print("\n🔄 Restarting all services for synchronization...")
    # Гарантируем, что системный nginx выключен
    subprocess.run(["sudo", "systemctl", "stop", "nginx"], capture_output=True)
    
    subprocess.run(["docker", "compose", "down"], cwd=PROJECT_DIR)
    subprocess.run(["docker", "compose", "up", "-d"], cwd=PROJECT_DIR)
    
    print("\n⏳ Waiting 5s for Xray to sync with the Backend...")
    time.sleep(5)
    
    print("\n====================================================")
    print("✅ ВСЕ ССЫЛКИ ВОССТАНОВЛЕНЫ. СКЕЛЕТОНЫ ДОЛЖНЫ ИСЧЕЗНУТЬ.")
    print("====================================================")

if __name__ == "__main__":
    main()
