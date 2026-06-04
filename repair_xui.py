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
    print("🛠️  IZINET EMERGENCY REPAIR: FIXING XRAY CORE STARTUP")
    print("====================================================")
    
    if os.path.exists(PROJECT_DIR):
        os.chdir(PROJECT_DIR)

    # 1. ПРОВЕРКА БАЗЫ
    if not os.path.exists(DB_PATH):
        print(f"❌ DB not found at {DB_PATH}")
        sys.exit(1)
        
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    try:
        # А) Ищем и отключаем ВСЕ инбаунды, которые требуют несуществующие сертификаты
        print("🔍 Scanning for broken inbounds (invalid SSL paths)...")
        cursor.execute("SELECT id, port, stream_settings, remark FROM inbounds WHERE enable=1;")
        enabled_inbounds = cursor.fetchall()
        
        for iid, port, stream_str, remark in enabled_inbounds:
            try:
                stream = json.loads(stream_str)
                tls_settings = stream.get("tlsSettings", {})
                
                # Проверяем пути к сертификатам
                cert_file = tls_settings.get("certificateFile", "")
                key_file = tls_settings.get("keyFile", "")
                
                # Если путь ведет в /root/cert или файл не существует (в контексте контейнера это сложно проверить, но мы знаем что /root/cert/ip/ вызывает ошибку)
                if "/root/cert" in cert_file or "/root/cert" in key_file:
                    print(f"⚠️  Found broken SSL config on port {port} ({remark}). Disabling it to allow Xray to start.")
                    cursor.execute("UPDATE inbounds SET enable=0 WHERE id=?;", (iid,))
            except:
                continue

        # Б) Гарантируем правильную настройку 443 порта (Reality)
        print("⚙️  Ensuring Reality Fallback on port 443...")
        cursor.execute("SELECT id, settings, stream_settings FROM inbounds WHERE port=443;")
        inbound_443 = cursor.fetchone()
        if inbound_443:
            iid, sett_str, stream_str = inbound_443
            settings = json.loads(sett_str)
            stream = json.loads(stream_str)
            
            # Ставим Fallback на Nginx
            settings["fallbacks"] = [{"dest": "host.docker.internal:3443", "xver": 0}]
            
            # Убеждаемся что на 443 стоит Reality (он не требует файлов сертификатов)
            if stream.get("security") == "reality":
                stream["realitySettings"]["dest"] = "host.docker.internal:3443"
                stream["realitySettings"]["target"] = "host.docker.internal:3443"
                # Удаляем TLS настройки если они там были по ошибке
                if "tlsSettings" in stream:
                    del stream["tlsSettings"]
            
            cursor.execute("UPDATE inbounds SET settings=?, stream_settings=?, enable=1 WHERE id=?;", 
                           (json.dumps(settings), json.dumps(stream), iid))
            
        conn.commit()
        print("💾 Database updated and cleaned.")
    except Exception as e:
        print(f"⚠️ Error during DB repair: {e}")
    finally:
        conn.close()

    # 2. ПЕРЕЗАПУСК ВСЕГО
    print("\n⚡ Restarting Docker containers...")
    # Остановка системного nginx если вдруг он поднялся
    subprocess.run(["sudo", "systemctl", "stop", "nginx"], capture_output=True)
    
    run_cmd(["docker", "compose", "down"], "Stopping containers")
    run_cmd(["docker", "compose", "up", "-d"], "Starting all services")
    
    print("\n⏳ Waiting 5s for Xray core to start...")
    time.sleep(5)
    
    # 3. ПРОВЕРКА ЛОГОВ НА ОШИБКИ
    print("\n🔍 Checking Xray logs for startup errors:")
    success, logs = run_cmd(["docker", "logs", "x3-ui", "--tail", "5"])
    if "failed to start" in logs.lower() or "error" in logs.lower():
        print(f"❌ Xray still failing! Logs:\n{logs}")
    else:
        print("🟢 Xray started successfully!")

    print("\n====================================================")
    print("✅ РЕМОНТ ЗАВЕРШЕН. Теперь проверьте https://izinet.online")
    print("====================================================")

if __name__ == "__main__":
    main()
