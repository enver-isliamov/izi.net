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
    print("🛠️  IZINET EMERGENCY ROLLBACK & STABILIZATION")
    print("====================================================")
    
    if not os.path.exists(DB_PATH):
        print("❌ Database not found!")
        return

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # 1. ОТКАТ ПАРАМЕТРОВ REALITY (Убираем всё экспериментальное)
    print("⚙️  Reverting Reality to 100% working state...")
    cursor.execute("SELECT id, settings, stream_settings FROM inbounds WHERE port = 443;")
    inbound = cursor.fetchone()
    if inbound:
        iid, sett_str, stream_str = inbound
        settings = json.loads(sett_str)
        stream = json.loads(stream_str)
        
        # Только базовые, рабочие настройки
        stream["security"] = "reality"
        if "realitySettings" not in stream: stream["realitySettings"] = {}
        rs = stream["realitySettings"]
        
        # Возвращаем проверенные ключи и домен
        rs["privateKey"] = "ABiVSJTP0fEMzgsHghSAsQJp-bYAJAat0jErpzaGtEo"
        rs["dest"] = "www.microsoft.com:443"
        rs["serverNames"] = ["www.microsoft.com", "microsoft.com"]
        rs["shortIds"] = ["79b27cf7799d5b4c"]
        
        if "settings" not in rs: rs["settings"] = {}
        rs["settings"]["publicKey"] = "CXL0o8BEC7wz-TIuA7w-QBbJIadSsb9xL7G6UB410Xw"
        rs["publicKey"] = "CXL0o8BEC7wz-TIuA7w-QBbJIadSsb9xL7G6UB410Xw"
        
        # Гарантируем Fallback (чтобы сайт открывался)
        settings["fallbacks"] = [{"dest": "host.docker.internal:3443", "xver": 0}]
        
        cursor.execute("UPDATE inbounds SET settings=?, stream_settings=?, enable=1 WHERE id=?;", 
                       (json.dumps(settings), json.dumps(stream), iid))
        print("✅ Reality (Microsoft) and Fallback restored.")

    # 2. ИСПРАВЛЕНИЕ МАРШРУТОВ (Сайт мимо ВПН)
    print("🧹 Cleaning routing rules and log spam...")
    try:
        # Ставим корректный фиктивный адрес для тишины в логах
        cursor.execute("UPDATE settings SET value = 'http://127.0.0.1:2053/ignore' WHERE key = 'ExternalTrafficInformURI';")
    except: pass

    # 3. ОТКЛЮЧАЕМ ВСЕ КРОМЕ НУЖНОГО
    cursor.execute("UPDATE inbounds SET enable = 0 WHERE port != 443 AND port != 2053;")

    conn.commit()
    conn.close()

    # 4. ПЕРЕЗАПУСК БЕЗ ПЕРЕСБОРКИ (Для скорости и надежности)
    print("\n🔄 Restarting containers...")
    subprocess.run(["docker", "compose", "down"], cwd=PROJECT_DIR)
    subprocess.run(["docker", "compose", "up", "-d"], cwd=PROJECT_DIR)
    
    print("\n⏳ Startup complete. PLEASE USE THE NEW LINK FROM THE PANEL!")
    print("====================================================")

if __name__ == "__main__":
    main()
