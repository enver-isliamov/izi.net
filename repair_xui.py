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
            print(f"✅ Success")
            return True, res.stdout
        else:
            print(f"❌ Failed (Code: {res.returncode})")
            return False, res.stderr
    except Exception as e:
        print(f"❌ Error: {e}")
        return False, str(e)

def main():
    print("====================================================")
    print("🛠️  IZINET FINAL REPAIR SCRIPT (DOCKER-CENTRIC)")
    print("====================================================")
    
    if os.path.exists(PROJECT_DIR):
        os.chdir(PROJECT_DIR)

    # 1. СТОП СИСТЕМНОМУ NGINX
    run_cmd(["sudo", "systemctl", "stop", "nginx"], "Stopping system Nginx")
    run_cmd(["sudo", "systemctl", "disable", "nginx"], "Disabling system Nginx")

    # 2. НАСТРОЙКА БАЗЫ ДАННЫХ X-UI
    if os.path.exists(DB_PATH):
        print(f"📦 Configuring Xray Database...")
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        try:
            cursor.execute("SELECT id, settings, stream_settings FROM inbounds WHERE port=443;")
            inbound = cursor.fetchone()
            if inbound:
                iid, sett_str, stream_str = inbound
                settings = json.loads(sett_str)
                stream = json.loads(stream_str)
                
                settings["fallbacks"] = [{"dest": "host.docker.internal:3443", "xver": 0}]
                
                if "realitySettings" in stream:
                    stream["realitySettings"]["dest"] = "host.docker.internal:3443"
                    stream["realitySettings"]["target"] = "host.docker.internal:3443"
                
                cursor.execute("UPDATE inbounds SET settings=?, stream_settings=? WHERE id=?;", 
                               (json.dumps(settings), json.dumps(stream), iid))
                conn.commit()
                print("✅ Xray Fallback set to host.docker.internal:3443")
        except Exception as e:
            print(f"⚠️ DB Error: {e}")
        finally:
            conn.close()

    # 3. ПЕРЕЗАПУСК DOCKER
    print("\n⚡ Restarting Docker Stack...")
    run_cmd(["docker", "compose", "down"], "Stopping containers")
    run_cmd(["docker", "compose", "up", "-d"], "Starting all services")
    
    print("\n⏳ Startup complete. Checking containers...")
    time.sleep(5)
    run_cmd(["docker", "ps"])

    print("\n====================================================")
    print("✅ ВСЁ ГОТОВО! Проверьте https://izinet.online")
    print("====================================================")

if __name__ == "__main__":
    main()
