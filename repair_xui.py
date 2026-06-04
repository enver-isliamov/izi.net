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
    print("🛠️  IZINET EMERGENCY RECOVERY: FIXING TIMEOUTS")
    print("====================================================")
    
    if not os.path.exists(DB_PATH):
        print("❌ Database not found!")
        return

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # 1. ОТКЛЮЧАЕМ ВСЕ ИНБАУНДЫ КРОМЕ 443
    print("🧹 Disabling all inbounds except port 443...")
    cursor.execute("UPDATE inbounds SET enable = 0 WHERE port != 443;")

    # 2. ОЧИСТКА НАСТРОЕК (ExternalTrafficInformURI)
    print("🧹 Cleaning settings to stop log spam...")
    # Ставим корректный пустой URL или null
    cursor.execute("UPDATE settings SET value = '' WHERE key = 'ExternalTrafficInformURI';")
    
    # 3. НАСТРОЙКА REALITY НА 443 (Возврат на Microsoft)
    print("⚙️  Reverting SNI to www.microsoft.com (more stable for Crimea)...")
    cursor.execute("SELECT id, settings, stream_settings FROM inbounds WHERE port = 443;")
    inbound = cursor.fetchone()
    if inbound:
        iid, sett_str, stream_str = inbound
        settings = json.loads(sett_str)
        stream = json.loads(stream_str)
        
        # Reality Settings
        if "realitySettings" not in stream: stream["realitySettings"] = {}
        rs = stream["realitySettings"]
        rs["dest"] = "www.microsoft.com:443"
        rs["serverNames"] = ["www.microsoft.com", "microsoft.com"]
        stream["security"] = "reality"
        
        # Fallback
        settings["fallbacks"] = [{"dest": "host.docker.internal:3443", "xver": 0}]
        
        cursor.execute("UPDATE inbounds SET settings = ?, stream_settings = ?, enable = 1 WHERE id = ?;", 
                       (json.dumps(settings), json.dumps(stream), iid))
        print("✅ Port 443 re-configured.")

    conn.commit()
    
    # 4. ДАМП ДАННЫХ ДЛЯ ДИАГНОСТИКИ
    print("\n--- Diagnostic Dump ---")
    cursor.execute("SELECT id, port, protocol, enable, remark FROM inbounds;")
    for row in cursor.fetchall():
        print(f"Inbound: ID={row[0]}, Port={row[1]}, Proto={row[2]}, Enabled={row[3]}, Remark={row[4]}")
    
    conn.close()

    # 5. ПЕРЕЗАПУСК
    print("\n🔄 Restarting system...")
    subprocess.run(["docker", "compose", "down"], cwd=PROJECT_DIR)
    subprocess.run(["docker", "compose", "up", "-d"], cwd=PROJECT_DIR)
    
    print("\n⏳ Waiting for startup...")
    time.sleep(5)
    
    res = subprocess.run(["docker", "logs", "x3-ui", "--tail", "10"], capture_output=True, text=True)
    print("\n📝 Logs snapshot:")
    print(res.stdout)

    print("\n====================================================")
    print("✅ RECOVERY COMPLETE. PLEASE GENERATE A NEW LINK!")
    print("====================================================")

if __name__ == "__main__":
    main()
