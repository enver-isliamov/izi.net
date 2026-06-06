#!/usr/bin/env python3
import os
import sqlite3
import json
import subprocess
import time

# Архитектура: Xray (Docker:443) -> Nginx (Host:3443) -> App (Docker:3005)

DB_PATH = "/opt/izinet/xui-db/x-ui.db"
PROJECT_DIR = "/opt/izinet"
NGINX_CONF = "/etc/nginx/sites-available/izinet"

def load_env_manual(path):
    env_vars = {}
    if os.path.exists(path):
        with open(path, 'r') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, value = line.split('=', 1)
                    env_vars[key.strip()] = value.strip().strip('"').strip("'")
    return env_vars

def main():
    print("====================================================")
    print("🛠️  IZINET MASTER DOCTOR (HOST-NGINX EDITION)")
    print("====================================================")

    env = load_env_manual(os.path.join(PROJECT_DIR, ".env"))
    DOMAIN = env.get("DOMAIN", "izinet.online")
    # Используем ключи из .env для 100% синхронизации
    PRIV_KEY = env.get("XUI_REALITY_PRIV_KEY", "ABiVSJTP0fEMzgsHghSAsQJp-bYAJAat0jErpzaGtEo")
    PUB_KEY = env.get("XUI_REALITY_PUB_KEY", "CXL0o8BEC7wz-TIuA7w-QBbJIadSsb9xL7G6UB410Xw")

    # 1. Настройка Xray (Docker)
    if os.path.exists(DB_PATH):
        print("⚙️  Настройка Xray (Reality + Fallback)...")
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        cursor.execute("UPDATE settings SET value = '' WHERE key = 'xrayTemplateConfig';")
        cursor.execute("SELECT id, settings, stream_settings FROM inbounds WHERE port = 443;")
        inbound = cursor.fetchone()
        
        if inbound:
            iid, sett_str, stream_str = inbound
            settings = json.loads(sett_str)
            stream = json.loads(stream_str)
            
            # Направляем обычный трафик на системный Nginx
            settings["fallbacks"] = [{"dest": "host.docker.internal:3443", "xver": 0}]
            
            # Маскировка под Microsoft (самый стабильный вариант)
            stream["security"] = "reality"
            rs = stream.get("realitySettings", {})
            rs["dest"] = "www.microsoft.com:443"
            rs["serverNames"] = ["www.microsoft.com", "microsoft.com"]
            rs["privateKey"] = PRIV_KEY
            rs["publicKey"] = PUB_KEY
            stream["realitySettings"] = rs
            
            # Включаем сниффинг для распознавания доменов
            sniffing = {"enabled": True, "destOverride": ["http", "tls"], "routeOnly": False}
            
            cursor.execute("UPDATE inbounds SET settings=?, stream_settings=?, sniffing=?, enable=1 WHERE id=?;", 
                           (json.dumps(settings), json.dumps(stream), json.dumps(sniffing), iid))
            print("✅ Xray настроен на передачу трафика в Nginx (порт 3443).")
        conn.commit()
        conn.close()

    # 2. Перезапуск Docker
    print("\n🔄 Перезапуск Docker (App + VPN)...")
    try:
        subprocess.run(["docker", "compose", "down"], cwd=PROJECT_DIR)
        # Очистка лок-файлов для чистой сборки
        for f in ["package-lock.json", "dist"]:
            p = os.path.join(PROJECT_DIR, f)
            if os.path.exists(p):
                if os.path.isdir(p): import shutil; shutil.rmtree(p)
                else: os.remove(p)
        
        subprocess.run(["docker", "compose", "up", "-d", "--build"], cwd=PROJECT_DIR)
    except Exception as e:
        print(f"❌ Ошибка Docker: {e}")

    # 3. Настройка Nginx на хосте
    if os.path.exists(NGINX_CONF):
        print(f"\n⚙️  Проверка системного Nginx ({NGINX_CONF})...")
        try:
            with open(NGINX_CONF, "r") as f: content = f.read()
            if "listen 3443" not in content:
                print("⚠️  ВНИМАНИЕ: Ваш системный Nginx не слушает порт 3443!")
                print("   Пожалуйста, добавьте 'listen 3443 ssl;' в ваш конфиг Nginx.")
            subprocess.run(["systemctl", "restart", "nginx"], capture_output=True)
            print("✅ Системный Nginx перезапущен.")
        except: pass

    print("\n⏳ Ожидание запуска бекенда (15 сек)...")
    time.sleep(15)
    subprocess.run(["docker", "logs", "--tail", "20", "izinet-app"], cwd=PROJECT_DIR)
    
    print("\n====================================================")
    print("🚀 Система настроена. Если сайт НЕ открывается:")
    print("1. Проверьте, что системный Nginx слушает порт 3443.")
    print("2. Убедитесь, что SSL сертификаты в /etc/letsencrypt/ живы.")
    print("====================================================")

if __name__ == "__main__":
    main()
