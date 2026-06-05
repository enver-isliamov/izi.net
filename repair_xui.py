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
    print("🛠️  IZINET ULTIMATE STABILITY REPAIR")
    print("====================================================")
    
    if not os.path.exists(DB_PATH):
        print("❌ Database not found!")
        return

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # 1. СТРОГОЕ ВОССТАНОВЛЕНИЕ REALITY (Microsoft SNI + Fixed Keys)
    # Эти ключи должны на 100% совпадать с тем, что в Hiddify
    ORIGINAL_PRIV_KEY = "ABiVSJTP0fEMzgsHghSAsQJp-bYAJAat0jErpzaGtEo"
    ORIGINAL_PUB_KEY = "CXL0o8BEC7wz-TIuA7w-QBbJIadSsb9xL7G6UB410Xw"
    
    print("⚙️  Enforcing Reality stability configuration...")
    cursor.execute("SELECT id, settings, stream_settings FROM inbounds WHERE port = 443;")
    inbound = cursor.fetchone()
    if inbound:
        iid, sett_str, stream_str = inbound
        settings = json.loads(sett_str)
        stream = json.loads(stream_str)
        
        # Фиксируем параметры Reality
        stream["security"] = "reality"
        if "realitySettings" not in stream: stream["realitySettings"] = {}
        rs = stream["realitySettings"]
        
        rs["privateKey"] = ORIGINAL_PRIV_KEY
        rs["dest"] = "www.microsoft.com:443"
        rs["serverNames"] = ["www.microsoft.com", "microsoft.com"]
        rs["shortIds"] = ["79b27cf7799d5b4c"] # Фиксируем SID чтобы ссылки не "бились"
        
        if "settings" not in rs: rs["settings"] = {}
        rs["settings"]["publicKey"] = ORIGINAL_PUB_KEY
        rs["publicKey"] = ORIGINAL_PUB_KEY
        
        # Fallback на локальный Nginx (сайт)
        settings["fallbacks"] = [{"dest": "host.docker.internal:3443", "xver": 0}]
        
        cursor.execute("UPDATE inbounds SET settings = ?, stream_settings = ?, enable = 1 WHERE id = ?;", 
                       (json.dumps(settings), json.dumps(stream), iid))
        print("✅ Port 443: Reality (Microsoft) + Fallback fixed.")

    # 2. ПОЛНОЕ УСТРАНЕНИЕ СПАМА В ЛОГАХ
    print("🧹 Fixing panel settings (Cleaning Log Spam)...")
    try:
        # Мы ставим локальный адрес приложения, чтобы XUI не ругался на отсутствие порта
        cursor.execute("UPDATE settings SET value = 'http://127.0.0.1:3005/api/ignore' WHERE key = 'ExternalTrafficInformURI';")
        cursor.execute("UPDATE settings SET value = 'false' WHERE key = 'TgBotEnable';")
    except: pass

    # 3. ОТКЛЮЧЕНИЕ ВСЕХ ЛИШНИХ ПОРТОВ
    print("🛑 Disabling all non-standard inbounds...")
    cursor.execute("UPDATE inbounds SET enable = 0 WHERE port != 443 AND port != 2053 AND port != 2096;")

    conn.commit()
    conn.close()

    # 4. ПЕРЕЗАПУСК ВСЕХ КОНТЕЙНЕРОВ
    print("\n🔄 Hard restarting all containers to apply optimizations...")
    subprocess.run(["docker", "compose", "down"], cwd=PROJECT_DIR)
    subprocess.run(["docker", "compose", "up", "-d"], cwd=PROJECT_DIR)
    
    print("\n⏳ Waiting for system to settle (10s)...")
    time.sleep(10)
    
    print("\n--- FINAL SYSTEM STATUS ---")
    subprocess.run(["docker", "ps"], cwd=PROJECT_DIR)
    
    print("\n====================================================")
    print("🚀 ВСЁ ИСПРАВЛЕНО! САЙТ И ВПН ДОЛЖНЫ ЛЕТАТЬ.")
    print("💡 СОВЕТ: Удалите мертвые серверы в админке (вкладка Серверы)!")
    print("====================================================")

if __name__ == "__main__":
    main()
