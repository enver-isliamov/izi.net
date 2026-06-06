#!/usr/bin/env python3
import os
import sqlite3
import json
import subprocess
import time
import shutil

# Архитектура: Xray (Docker) -> Nginx (Host) -> App (Docker)
PROJECT_DIR = "/opt/izinet"
DB_PATH = os.path.join(PROJECT_DIR, "xui-db/x-ui.db")
ENV_PATH = os.path.join(PROJECT_DIR, ".env")

def load_env_clean(path):
    """Загружает .env, игнорируя дубликаты и мусор"""
    env_vars = {}
    if not os.path.exists(path): return env_vars
    with open(path, 'r') as f:
        for line in f:
            line = line.strip()
            if '=' in line and not line.startswith('#'):
                k, v = line.split('=', 1)
                k = k.strip()
                v = v.strip().strip('"').strip("'")
                # Игнорируем плейсхолдеры
                if "<NEW_" in v: continue
                # В случае дубликатов — берем ПОСЛЕДНЕЕ значение (как делает Docker)
                env_vars[k] = v
    return env_vars

def save_env_clean(path, env):
    """Сохраняет чистый .env без дубликатов"""
    with open(path, 'w') as f:
        for k, v in env.items():
            f.write(f"{k}={v}\n")

def main():
    print("====================================================")
    print("🛠️  IZINET MASTER DOCTOR (ENVIRONMENT SANITIZER)")
    print("====================================================")

    # 1. Чистим .env
    print("🧹 Чистка файла .env от дубликатов...")
    env = load_env_clean(ENV_PATH)
    
    # Если ключей нет, ставим дефолтные (но лучше сгенерировать новые в панели)
    if "XUI_REALITY_PRIV_KEY" not in env:
        env["XUI_REALITY_PRIV_KEY"] = "ABiVSJTP0fEMzgsHghSAsQJp-bYAJAat0jErpzaGtEo"
    if "XUI_REALITY_PUB_KEY" not in env:
        env["XUI_REALITY_PUB_KEY"] = "CXL0o8BEC7wz-TIuA7w-QBbJIadSsb9xL7G6UB410Xw"
    
    save_env_clean(ENV_PATH, env)
    PRIV_KEY = env["XUI_REALITY_PRIV_KEY"]
    PUB_KEY = env["XUI_REALITY_PUB_KEY"]
    DOMAIN = env.get("DOMAIN", "izinet.online")
    print(f"✅ Файл .env очищен. Используем PUB KEY: {PUB_KEY[:10]}...")

    # 2. Настройка XUI
    if os.path.exists(DB_PATH):
        try:
            conn = sqlite3.connect(DB_PATH)
            cursor = conn.cursor()
            cursor.execute("SELECT id, settings, stream_settings FROM inbounds WHERE port = 443;")
            inbound = cursor.fetchone()
            if inbound:
                iid, sett_str, stream_str = inbound
                settings = json.loads(sett_str) if sett_str else {}
                stream = json.loads(stream_str) if stream_str else {}
                
                # Принудительный Fallback на Nginx
                settings["fallbacks"] = [{"dest": "host.docker.internal:3443", "xver": 0}]
                
                # Принудительная маскировка Reality под Microsoft
                stream["security"] = "reality"
                rs = stream.get("realitySettings", {})
                rs["dest"] = "www.microsoft.com:443"
                rs["serverNames"] = ["www.microsoft.com", "microsoft.com"]
                rs["privateKey"] = PRIV_KEY
                rs["publicKey"] = PUB_KEY
                stream["realitySettings"] = rs
                
                cursor.execute("UPDATE inbounds SET settings=?, stream_settings=?, enable=1 WHERE id=?;", 
                               (json.dumps(settings), json.dumps(stream), iid))
                print("✅ Настройки Xray синхронизированы с .env.")
            conn.commit()
            conn.close()
        except Exception as e:
            print(f"⚠️ Ошибка базы: {e}")

    # 3. Перезапуск
    print("\n🔄 Перезапуск Docker для применения чистых настроек...")
    try:
        subprocess.run(["docker", "compose", "up", "-d", "--build"], cwd=PROJECT_DIR)
        print("⏳ Ожидание запуска (10 сек)...")
        time.sleep(10)
        
        print("\n📝 ПРОВЕРКА ЛОГОВ БЕКЕНДА:")
        subprocess.run(["docker", "logs", "--tail", "10", "izinet-app"], cwd=PROJECT_DIR)
    except Exception as e:
        print(f"❌ Ошибка Docker: {e}")

    print("\n====================================================")
    print("🏆 ПОЧТИ ГОТОВО! Теперь сделайте следующее:")
    print(f"1. Зайдите на сайт https://{DOMAIN}")
    print("2. В Личном Кабинете ОБНОВИТЕ КЛЮЧ устройства.")
    print("3. Скопируйте НОВУЮ ссылку в Hiddify.")
    print("====================================================")

if __name__ == "__main__":
    main()
