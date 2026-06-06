#!/usr/bin/env python3
import os
import sqlite3
import json
import subprocess
import time

# Пути к файлам на сервере
DB_PATH = "/opt/izinet/xui-db/x-ui.db"
PROJECT_DIR = "/opt/izinet"
ENV_PATH = os.path.join(PROJECT_DIR, ".env")

def load_env_manual(path):
    """Загрузка переменных из .env без сторонних библиотек"""
    env_vars = {}
    if not os.path.exists(path):
        return env_vars
    try:
        with open(path, 'r') as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith('#'):
                    continue
                if '=' in line:
                    key, value = line.split('=', 1)
                    env_vars[key.strip()] = value.strip().strip('"').strip("'")
    except Exception as e:
        print(f"⚠️ Ошибка чтения .env: {e}")
    return env_vars

# Загружаем переменные
env = load_env_manual(ENV_PATH)
DOMAIN = env.get("DOMAIN", "izinet.online")
PRIV_KEY = env.get("XUI_REALITY_PRIV_KEY", "ABiVSJTP0fEMzgsHghSAsQJp-bYAJAat0jErpzaGtEo")
PUB_KEY = env.get("XUI_REALITY_PUB_KEY", "CXL0o8BEC7wz-TIuA7w-QBbJIadSsb9xL7G6UB410Xw")

def main():
    print("====================================================")
    print("🛠️  IZINET MASTER DOCTOR (FINAL VERSION)")
    print("====================================================")
    
    if not os.path.exists(DB_PATH):
        print(f"❌ База данных не найдена: {DB_PATH}")
        return

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # 1. Сброс шаблона
    cursor.execute("UPDATE settings SET value = '' WHERE key = 'xrayTemplateConfig';")

    # 2. Настройка Reality + Fallback
    cursor.execute("SELECT id, settings, stream_settings FROM inbounds WHERE port = 443;")
    inbound = cursor.fetchone()
    
    if inbound:
        iid, sett_str, stream_str = inbound
        settings = json.loads(sett_str) if sett_str else {}
        stream = json.loads(stream_str) if stream_str else {}
        
        # Снимаем ограничения
        if "clients" in settings:
            for client in settings["clients"]:
                client["limitIp"] = 0
                client["totalGB"] = 0
        
        # Настройка Fallback на Nginx через Docker-хост
        settings["fallbacks"] = [
            {"name": DOMAIN, "dest": "host.docker.internal:3443", "xver": 0},
            {"name": f"www.{DOMAIN}", "dest": "host.docker.internal:3443", "xver": 0},
            {"dest": "host.docker.internal:3443", "xver": 0}
        ]
        
        # Настройка Reality (Маскировка под Microsoft)
        stream["security"] = "reality"
        if "realitySettings" not in stream: stream["realitySettings"] = {}
        rs = stream["realitySettings"]
        rs["dest"] = "www.microsoft.com:443"
        rs["serverNames"] = ["www.microsoft.com", "microsoft.com"]
        rs["privateKey"] = PRIV_KEY
        
        if "settings" not in rs: rs["settings"] = {}
        rs["settings"]["publicKey"] = PUB_KEY
        rs["publicKey"] = PUB_KEY
        rs["shortIds"] = ["79b27cf7799d5b4c", "0248", "36b963e7713fa1", "34d587", "ff"]
        
        # Включаем сниффинг
        sniffing = {"enabled": True, "destOverride": ["http", "tls"], "routeOnly": False}
        
        cursor.execute("UPDATE inbounds SET settings=?, stream_settings=?, sniffing=?, enable=1 WHERE id=?;", 
                       (json.dumps(settings), json.dumps(stream), json.dumps(sniffing), iid))
        print("✅ Параметры Reality и Fallback обновлены.")

    # 3. Глобальные фиксы
    cursor.execute("UPDATE settings SET value = 'http://127.0.0.1:2053/ignore' WHERE key = 'ExternalTrafficInformURI';")
    cursor.execute("UPDATE inbounds SET enable = 0 WHERE port NOT IN (443, 2053);")

    conn.commit()
    conn.close()

    # 4. Перезапуск
    print("\n🔄 Перезапуск Docker...")
    try:
        subprocess.run(["docker", "compose", "down"], cwd=PROJECT_DIR)
        subprocess.run(["docker", "compose", "up", "-d", "--build"], cwd=PROJECT_DIR)
        
        print("⏳ Ожидание старта (10 сек)...")
        time.sleep(10)
        
        print("\n📝 ЛОГИ ПРИЛОЖЕНИЯ:")
        subprocess.run(["docker", "logs", "--tail", "50", "izinet-app"], cwd=PROJECT_DIR)
    except Exception as e:
        print(f"❌ Ошибка Docker: {e}")
    
    print("====================================================")

if __name__ == "__main__":
    main()
