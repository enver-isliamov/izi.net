#!/usr/bin/env python3
import os
import sys
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
        if res.returncode == 0:
            print(f"✅ Success: {' '.join(cmd_list)}")
            return True, res.stdout
        else:
            print(f"❌ Failed: {' '.join(cmd_list)} (Exit code: {res.returncode})")
            return False, res.stderr
    except Exception as e:
        print(f"❌ Error: {e}")
        return False, str(e)

def main():
    print("====================================================")
    print("🛠️  IZINET DOCKER-ONLY REPAIR SCRIPT")
    print("====================================================")
    
    if os.path.exists(PROJECT_DIR):
        os.chdir(PROJECT_DIR)

    # 1. СТОП СИСТЕМНОМУ NGINX (он мешает докеру)
    run_cmd(["sudo", "systemctl", "stop", "nginx"], "Stopping system Nginx to avoid port conflicts")
    run_cmd(["sudo", "systemctl", "disable", "nginx"], "Disabling system Nginx auto-start")

    # 2. НАСТРОЙКА БАЗЫ ДАННЫХ X-UI
    if not os.path.exists(DB_PATH):
        print(f"❌ DB not found at {DB_PATH}")
        sys.exit(1)
        
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Исправляем Fallback на host.docker.internal
    try:
        cursor.execute("SELECT id, settings, stream_settings FROM inbounds WHERE port=443;")
        inbound = cursor.fetchone()
        if inbound:
            iid, sett_str, stream_str = inbound
            settings = json.loads(sett_str)
            stream = json.loads(stream_str)
            
            # Настройка Fallbacks
            settings["fallbacks"] = [
                {"dest": "host.docker.internal:3443", "xver": 0},
                {"name": "izinet.online", "dest": "host.docker.internal:3443", "xver": 0}
            ]
            
            # Настройка Reality Dest
            if "realitySettings" in stream:
                stream["realitySettings"]["dest"] = "host.docker.internal:3443"
                stream["realitySettings"]["target"] = "host.docker.internal:3443"
            
            cursor.execute("UPDATE inbounds SET settings=?, stream_settings=? WHERE id=?;", 
                           (json.dumps(settings), json.dumps(stream), iid))
            conn.commit()
            print("✅ Xray Fallback configured to host.docker.internal:3443")
    except Exception as e:
        print(f"⚠️ DB Update Error: {e}")
    finally:
        conn.close()

    # 3. ПЕРЕЗАПУСК DOCKER (Force Nginx container)
    print("\n⚡ Restarting Docker Stack...")
    run_cmd(["docker", "compose", "down"], "Stopping containers")
    # Принудительно запускаем все 3 сервиса
    run_cmd(["docker", "compose", "up", "-d"], "Starting all services (App, XUI, Nginx)")
    
    print("\n⏳ Waiting for startup (10s)...")
    time.sleep(10)

    # 4. ФИНАЛЬНАЯ ПРОВЕРКА
    print("\n--- HEALTH CHECK ---")
    run_cmd(["docker", "ps"], "Current containers")
    
    # Проверка связи изнутри XUI в Nginx
    print("\n🔗 Testing internal link Xray -> Nginx:")
    res_bool, res_out = run_cmd(["docker", "exec", "x3-ui", "curl", "-Ik", "https://host.docker.internal:3443"], "Internal Fallback Test")
    if "200" in res_out:
        print("🟢 SUCCESS: Xray can reach Nginx!")
    else:
        print(f"🔴 ERROR: Link broken. Response: {res_out[:50]}")

    print("\n====================================================")
    print("✅ РЕМОНТ ЗАВЕРШЕН. Попробуйте открыть https://izinet.online")
    print("====================================================")

if __name__ == "__main__":
    main()
