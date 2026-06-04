#!/usr/bin/env python3
import os
import sqlite3
import json
import subprocess
import time

DB_PATH = "/opt/izinet/xui-db/x-ui.db"
PROJECT_DIR = "/opt/izinet"

def run_cmd(cmd_list):
    try:
        res = subprocess.run(cmd_list, capture_output=True, text=True, timeout=30)
        return True, res.stdout
    except:
        return False, ""

def main():
    print("====================================================")
    print("🛠️  IZINET FINAL STABILITY CLEANUP")
    print("====================================================")
    
    if not os.path.exists(DB_PATH):
        print("❌ Database not found!")
        return

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # 1. Тотальная очистка настроек, вызывающих ошибки
    print("🧹 Deep cleaning settings table...")
    try:
        # Проверяем наличие таблицы settings
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='settings';")
        if cursor.fetchone():
            # Очищаем всё, что может спамить в логи
            cursor.execute("UPDATE settings SET value = '' WHERE key = 'ExternalTrafficInformURI';")
            cursor.execute("UPDATE settings SET value = 'false' WHERE key = 'TgBotEnable';")
            print("✅ Problematic settings cleared.")
        else:
            print("⚠️ Table 'settings' not found, skipping deep clean.")
    except Exception as e:
        print(f"⚠️ Error cleaning settings: {e}")

    # 2. Проверка и фиксация 443 порта
    print("⚙️  Ensuring Reality SNI is set to dl.google.com...")
    try:
        cursor.execute("SELECT id, settings, stream_settings FROM inbounds WHERE port = 443;")
        inbound = cursor.fetchone()
        if inbound:
            iid, sett_str, stream_str = inbound
            settings = json.loads(sett_str)
            stream = json.loads(stream_str)
            
            # Ставим максимально стабильный SNI
            if "realitySettings" not in stream: stream["realitySettings"] = {}
            stream["realitySettings"]["dest"] = "dl.google.com:443"
            stream["realitySettings"]["serverNames"] = ["dl.google.com"]
            stream["security"] = "reality"
            
            # Fallback на локальный Nginx
            settings["fallbacks"] = [{"dest": "host.docker.internal:3443", "xver": 0}]
            
            cursor.execute("UPDATE inbounds SET settings = ?, stream_settings = ?, enable = 1 WHERE id = ?;", 
                           (json.dumps(settings), json.dumps(stream), iid))
            print("✅ Reality configuration finalized.")
    except Exception as e:
        print(f"⚠️ Error updating inbounds: {e}")
    
    conn.commit()
    conn.close()

    # 3. Полный перезапуск контейнеров (с удалением старых состояний)
    print("🔄 Performing Hard Restart of all containers...")
    subprocess.run(["docker", "compose", "down"], cwd=PROJECT_DIR)
    subprocess.run(["docker", "compose", "up", "-d"], cwd=PROJECT_DIR)
    
    print("⏳ Waiting 10s for Xray to stabilize...")
    time.sleep(10)
    
    # 4. Финальная проверка логов
    _, logs = run_cmd(["docker", "logs", "x3-ui", "--tail", "20"])
    print("\n📝 Final Xray Logs snapshot:")
    print(logs)
    
    if "started" in logs and "ExternalTrafficInformURI" not in logs:
        print("\n🟢 EVERYTHING LOOKS PERFECT! Logs are clean.")
    else:
        print("\n🟡 System is running, but check logs for remaining noise.")

    print("\n====================================================")
    print("🚀 ВСЕ ИСПРАВЛЕНИЯ ПРИМЕНЕНЫ!")
    print("====================================================")

if __name__ == "__main__":
    main()
