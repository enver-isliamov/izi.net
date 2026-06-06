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
    if not os.path.exists(path): return env_vars
    try:
        with open(path, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith('#'): continue
                if '=' in line:
                    key, value = line.split('=', 1)
                    env_vars[key.strip()] = value.strip().strip('"').strip("'")
    except Exception as e:
        print(f"⚠️ Ошибка чтения .env: {e}")
    return env_vars

def main():
    print("====================================================")
    print("🛠️  IZINET MASTER DOCTOR (PRODUCTION-GRADE)")
    print("====================================================")
    
    # 1. Проверка окружения
    env = load_env_manual(ENV_PATH)
    DOMAIN = env.get("DOMAIN", "izinet.online")
    PRIV_KEY = env.get("XUI_REALITY_PRIV_KEY", "ABiVSJTP0fEMzgsHghSAsQJp-bYAJAat0jErpzaGtEo")
    PUB_KEY = env.get("XUI_REALITY_PUB_KEY", "CXL0o8BEC7wz-TIuA7w-QBbJIadSsb9xL7G6UB410Xw")

    # 2. Настройка Firewall (UFW) - как в Production
    if os.path.exists("/usr/sbin/ufw"):
        print("🛡️ Настройка Firewall (UFW)...")
        for port in ["80", "443", "3443", "2053", "3005"]:
            subprocess.run(["ufw", "allow", f"{port}/tcp"], capture_output=True)
        subprocess.run(["ufw", "reload"], capture_output=True)
        print("✅ Порты открыты: 80, 443, 3443, 2053, 3005")

    # 3. Настройка Базы XUI
    if os.path.exists(DB_PATH):
        print("⚙️  Синхронизация Xray и Nginx...")
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        cursor.execute("UPDATE settings SET value = '' WHERE key = 'xrayTemplateConfig';")
        cursor.execute("SELECT id, settings, stream_settings FROM inbounds WHERE port = 443;")
        inbound = cursor.fetchone()
        
        if inbound:
            iid, sett_str, stream_str = inbound
            settings = json.loads(sett_str)
            stream = json.loads(stream_str)
            
            # Настройка Fallback (используем имя контейнера для Docker-сети)
            FALLBACK_DEST = "nginx:3443"
            settings["fallbacks"] = [
                {"name": DOMAIN, "dest": FALLBACK_DEST, "xver": 0},
                {"dest": FALLBACK_DEST, "xver": 0}
            ]
            
            # Маскировка Reality под Microsoft (Золотой стандарт стабильности)
            stream["security"] = "reality"
            rs = stream.get("realitySettings", {})
            rs["dest"] = "www.microsoft.com:443"
            rs["serverNames"] = ["www.microsoft.com", "microsoft.com"]
            rs["privateKey"] = PRIV_KEY
            rs["publicKey"] = PUB_KEY
            stream["realitySettings"] = rs
            
            cursor.execute("UPDATE inbounds SET settings=?, stream_settings=?, enable=1 WHERE id=?;", 
                           (json.dumps(settings), json.dumps(stream), iid))
            print("✅ Xray настроен на маскировку Microsoft и Fallback на Nginx.")
        
        conn.commit()
        conn.close()

    # 4. Очистка и Перезапуск
    print("\n🧹 Очистка и запуск Docker...")
    # Удаляем лок-файлы, которые могут мешать сборке
    for f in ["package-lock.json", "dist"]:
        path = os.path.join(PROJECT_DIR, f)
        if os.path.exists(path):
            if os.path.isdir(path):
                import shutil
                shutil.rmtree(path)
            else:
                os.remove(path)

    try:
        subprocess.run(["docker", "compose", "down"], cwd=PROJECT_DIR)
        subprocess.run(["docker", "compose", "up", "-d", "--build"], cwd=PROJECT_DIR)
        
        print("\n⏳ Ожидание полной инициализации (20 сек)...")
        time.sleep(20)
        
        print("\n📝 ФИНАЛЬНЫЕ ЛОГИ БЕКЕНДА:")
        subprocess.run(["docker", "logs", "--tail", "50", "izinet-app"], cwd=PROJECT_DIR)
    except Exception as e:
        print(f"❌ Ошибка: {e}")
    
    print("\n====================================================")
    print(f"🚀 Система готова. Проверьте сайт: https://{DOMAIN}")
    print("====================================================")

if __name__ == "__main__":
    main()
