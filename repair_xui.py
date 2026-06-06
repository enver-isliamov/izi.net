#!/usr/bin/env python3
import os
import sqlite3
import json
import subprocess
import time

# Данная версия ориентирована на Production архитектуру: 
# Xray (Docker) -> Nginx (Host) -> App (Docker)

DB_PATH = "/opt/izinet/xui-db/x-ui.db"
PROJECT_DIR = "/opt/izinet"
NGINX_CONF = "/etc/nginx/sites-available/izinet"

def main():
    print("====================================================")
    print("🛠️  IZINET ULTIMATE REPAIR (HOST-NGINX ALIGNMENT)")
    print("====================================================")

    # 1. Настройка Xray (Docker)
    if os.path.exists(DB_PATH):
        print("⚙️  Настройка Xray Fallback на системный Nginx (порт 3443)...")
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        cursor.execute("SELECT id, settings, stream_settings FROM inbounds WHERE port = 443;")
        inbound = cursor.fetchone()
        
        if inbound:
            iid, sett_str, stream_str = inbound
            settings = json.loads(sett_str)
            stream = json.loads(stream_str)
            
            # Направляем трафик на хост-машину, где слушает основной Nginx
            settings["fallbacks"] = [{"dest": "host.docker.internal:3443", "xver": 0}]
            
            # Стабильная маскировка под Microsoft
            stream["security"] = "reality"
            rs = stream.get("realitySettings", {})
            rs["dest"] = "www.microsoft.com:443"
            rs["serverNames"] = ["www.microsoft.com", "microsoft.com"]
            # Используем стандартные ключи проекта
            rs["privateKey"] = "ABiVSJTP0fEMzgsHghSAsQJp-bYAJAat0jErpzaGtEo"
            rs["publicKey"] = "CXL0o8BEC7wz-TIuA7w-QBbJIadSsb9xL7G6UB410Xw"
            stream["realitySettings"] = rs
            
            cursor.execute("UPDATE inbounds SET settings=?, stream_settings=?, enable=1 WHERE id=?;", 
                           (json.dumps(settings), json.dumps(stream), iid))
            print("✅ База данных XUI успешно настроена.")
        conn.commit()
        conn.close()

    # 2. Настройка Nginx (Host)
    if os.path.exists(NGINX_CONF):
        print(f"⚙️  Проверка конфигурации Nginx: {NGINX_CONF}...")
        try:
            with open(NGINX_CONF, "r") as f:
                content = f.read()
            
            # Убеждаемся, что Nginx слушает порт 3443 для Xray
            if "listen 3443" not in content:
                print("⚠️  Nginx не настроен на порт 3443. Пожалуйста, проверьте конфиг вручную!")
            
            subprocess.run(["systemctl", "restart", "nginx"], capture_output=True)
            print("✅ Системный Nginx перезапущен.")
        except Exception as e:
            print(f"⚠️ Ошибка при настройке Nginx: {e}")

    # 3. Перезапуск Docker
    print("\n🔄 Перезапуск Docker контейнеров...")
    try:
        # Очистка лок-файлов
        lock_file = os.path.join(PROJECT_DIR, "package-lock.json")
        if os.path.exists(lock_file): os.remove(lock_file)

        subprocess.run(["docker", "compose", "down"], cwd=PROJECT_DIR)
        subprocess.run(["docker", "compose", "up", "-d", "--build"], cwd=PROJECT_DIR)
        
        print("\n⏳ Ожидание запуска (15 сек)...")
        time.sleep(15)
        
        print("\n📝 ЛОГИ БЕКЕНДА:")
        subprocess.run(["docker", "logs", "--tail", "30", "izinet-app"], cwd=PROJECT_DIR)
        
    except Exception as e:
        print(f"❌ Ошибка Docker: {e}")

    print("\n====================================================")
    print("🏆 РЕКОМЕНДАЦИЯ: Если сайт не открывается, убедитесь, что")
    print("   в Cloudflare выключено 'Оранжевое облако' (Proxy)!")
    print("====================================================")

if __name__ == "__main__":
    main()
