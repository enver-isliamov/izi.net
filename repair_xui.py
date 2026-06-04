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
    except Exception as e:
        return False, str(e)

def main():
    print("====================================================")
    print("🛠️  IZINET FINAL OPTIMIZATION: STABILITY & DPI BYPASS")
    print("====================================================")
    
    if not os.path.exists(DB_PATH):
        print("❌ Database not found!")
        return

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # 1. Очистка проблемных настроек панели (ExternalTrafficInformURI)
    print("🧹 Cleaning up problematic panel settings (Fixing Log Spam)...")
    # Мы ищем настройки, которые вызывают ошибки 'missing port in address'
    cursor.execute("UPDATE settings SET value = '' WHERE key = 'ExternalTrafficInformURI';")

    # 2. Оптимизация 443 порта (Reality) для обхода блокировок
    print("⚙️  Optimizing Reality SNI and parameters for better stability...")
    cursor.execute("SELECT id, settings, stream_settings FROM inbounds WHERE port = 443;")
    inbound = cursor.fetchone()
    if inbound:
        iid, settings_str, stream_str = inbound
        settings = json.loads(settings_str)
        stream = json.loads(stream_str)
        
        # Используем dl.google.com - он крайне стабилен и редко блокируется
        # Также добавляем параметры для Reality, которые лучше работают в сложных сетях
        if "realitySettings" not in stream:
            stream["realitySettings"] = {}
            
        rs = stream["realitySettings"]
        rs["dest"] = "dl.google.com:443"
        rs["serverNames"] = ["dl.google.com"]
        
        # Гарантируем правильные fallbacks на локальный сайт
        settings["fallbacks"] = [
            {"dest": "host.docker.internal:3443", "xver": 0},
            {"name": "izinet.online", "dest": "host.docker.internal:3443", "xver": 0}
        ]
        
        # Настройка TCP/Vision
        stream["network"] = "tcp"
        stream["security"] = "reality"
        
        cursor.execute("UPDATE inbounds SET settings = ?, stream_settings = ?, enable = 1 WHERE id = ?;", 
                       (json.dumps(settings), json.dumps(stream), iid))
    
    # 3. Отключаем всё лишнее на порту 8443
    cursor.execute("UPDATE inbounds SET enable = 0 WHERE port = 8443;")
    
    conn.commit()
    conn.close()
    print("✅ Database optimized.")

    # 4. Перезапуск системы
    print("🔄 Applying changes (Docker restart)...")
    subprocess.run(["docker", "compose", "restart"], cwd=PROJECT_DIR)
    
    print("⏳ Waiting for stabilization...")
    time.sleep(5)
    
    # 5. Проверка логов
    _, logs = run_cmd(["docker", "logs", "x3-ui", "--tail", "15"])
    print("\n📝 Final Status Logs:")
    print(logs)
    
    if "Xray" in logs and "started" in logs:
        print("\n🟢 SYSTEM IS LIVE AND OPTIMIZED!")
        print("💡 TIP: If PC connection is slow, enable 'Fragment' in Hiddify settings.")
    else:
        print("\n⚠️ System started with warnings. Please check the logs above.")

if __name__ == "__main__":
    main()
