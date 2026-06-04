#!/usr/bin/env python3
import os
import sqlite3
import json
import subprocess
import time

DB_PATH = "/opt/izinet/xui-db/x-ui.db"
PROJECT_DIR = "/opt/izinet"

def run_cmd(cmd_list, desc=""):
    if desc:
        print(f"\n⚡ {desc}...")
    try:
        res = subprocess.run(cmd_list, capture_output=True, text=True, timeout=30)
        return True, res.stdout
    except Exception as e:
        return False, str(e)

def main():
    print("====================================================")
    print("🛠️  IZINET EMERGENCY: DISABLING BROKEN PORT 8443")
    print("====================================================")
    
    if not os.path.exists(DB_PATH):
        print("❌ Database not found!")
        return

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # 1. Жестко отключаем все инбаунды на порту 8443
    print("🛑 Disabling all inbounds on port 8443 to stop Xray crashes...")
    cursor.execute("UPDATE inbounds SET enable = 0 WHERE port = 8443;")
    
    # 2. Проверяем 443 порт (Reality)
    print("⚙️  Checking Reality configuration on port 443...")
    cursor.execute("SELECT id, settings, stream_settings FROM inbounds WHERE port = 443;")
    inbound = cursor.fetchone()
    if inbound:
        iid, settings_str, stream_str = inbound
        settings = json.loads(settings_str)
        stream = json.loads(stream_str)
        
        # Гарантируем Reality
        stream["security"] = "reality"
        if "realitySettings" not in stream:
            stream["realitySettings"] = {}
        
        # Ставим корректный fallback
        settings["fallbacks"] = [{"dest": "host.docker.internal:3443", "xver": 0}]
        stream["realitySettings"]["dest"] = "host.docker.internal:3443"
        stream["realitySettings"]["target"] = "host.docker.internal:3443"
        
        # Удаляем TLS настройки если они остались от старых попыток
        if "tlsSettings" in stream:
            del stream["tlsSettings"]
            
        cursor.execute("UPDATE inbounds SET settings = ?, stream_settings = ?, enable = 1 WHERE id = ?;", 
                       (json.dumps(settings), json.dumps(stream), iid))
    
    conn.commit()
    conn.close()
    print("✅ Database cleaned.")

    # 3. Перезапуск
    print("🔄 Restarting containers...")
    subprocess.run(["docker", "compose", "down"], cwd=PROJECT_DIR)
    subprocess.run(["docker", "compose", "up", "-d"], cwd=PROJECT_DIR)
    
    print("⏳ Waiting for Xray startup...")
    time.sleep(5)
    
    # 4. Проверка логов
    _, logs = run_cmd(["docker", "logs", "x3-ui", "--tail", "10"])
    print("\n📝 Current Xray Logs:")
    print(logs)
    
    if "Failed to start" in logs:
        print("\n❌ Xray STILL failing. Please check if there are other broken ports in the panel.")
    else:
        print("\n🟢 Xray should be working now! Check your site and VPN.")

if __name__ == "__main__":
    main()
