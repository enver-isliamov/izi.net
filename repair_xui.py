#!/usr/bin/env python3
import os
import sqlite3
import json
import subprocess
import time

# Пути к файлам
DB_PATH = "/opt/izinet/xui-db/x-ui.db"
PROJECT_DIR = "/opt/izinet"
ENV_PATH = os.path.join(PROJECT_DIR, ".env")

def load_env_manual(path):
    env_vars = {}
    if not os.path.exists(path): return env_vars
    try:
        with open(path, 'r') as f:
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
    print("🛠️  IZINET MASTER DOCTOR (DIAGNOSTIC VERSION)")
    print("====================================================")
    
    # 1. Проверка .env
    print("🔍 Проверка файла .env...")
    env = load_env_manual(ENV_PATH)
    required_keys = ["DOMAIN", "VITE_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "XUI_REALITY_PRIV_KEY", "XUI_REALITY_PUB_KEY"]
    found_keys = [k for k in required_keys if k in env]
    print(f"✅ Найдено ключей в .env: {len(found_keys)} из {len(required_keys)}")
    if len(found_keys) < len(required_keys):
        missing = set(required_keys) - set(found_keys)
        print(f"⚠️ Отсутствуют важные ключи: {', '.join(missing)}")

    DOMAIN = env.get("DOMAIN", "izinet.online")
    PRIV_KEY = env.get("XUI_REALITY_PRIV_KEY", "ABiVSJTP0fEMzgsHghSAsQJp-bYAJAat0jErpzaGtEo")
    PUB_KEY = env.get("XUI_REALITY_PUB_KEY", "CXL0o8BEC7wz-TIuA7w-QBbJIadSsb9xL7G6UB410Xw")

    # 2. Настройка Базы XUI
    if os.path.exists(DB_PATH):
        print("⚙️  Обновление настроек Xray в базе данных...")
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        cursor.execute("UPDATE settings SET value = '' WHERE key = 'xrayTemplateConfig';")
        cursor.execute("SELECT id, settings, stream_settings FROM inbounds WHERE port = 443;")
        inbound = cursor.fetchone()
        
        if inbound:
            iid, sett_str, stream_str = inbound
            settings = json.loads(sett_str)
            stream = json.loads(stream_str)
            
            # ВАЖНО: Используем имя контейнера 'nginx' для Fallback внутри Docker
            FALLBACK_DEST = "nginx:3443"
            settings["fallbacks"] = [{"name": DOMAIN, "dest": FALLBACK_DEST, "xver": 0}, {"dest": FALLBACK_DEST, "xver": 0}]
            
            # Маскировка под Microsoft
            stream["security"] = "reality"
            if "realitySettings" not in stream: stream["realitySettings"] = {}
            rs = stream["realitySettings"]
            rs["dest"] = "www.microsoft.com:443"
            rs["serverNames"] = ["www.microsoft.com", "microsoft.com"]
            rs["privateKey"] = PRIV_KEY
            rs["publicKey"] = PUB_KEY
            
            cursor.execute("UPDATE inbounds SET settings=?, stream_settings=?, enable=1 WHERE id=?;", 
                           (json.dumps(settings), json.dumps(stream), iid))
            print("✅ Настройки порта 443 обновлены.")
        
        conn.commit()
        conn.close()
    else:
        print("⚠️ База данных XUI не найдена, пропускаю настройку Xray.")

    # 3. Очистка отравленных файлов и перезапуск
    print("\n🧹 Очистка временных файлов и сборка Docker...")
    # Удаляем package-lock.json, если он попал из Windows
    lock_file = os.path.join(PROJECT_DIR, "package-lock.json")
    if os.path.exists(lock_file):
        print("🗑️ Удаление Windows package-lock.json для чистой сборки...")
        os.remove(lock_file)

    try:
        subprocess.run(["docker", "compose", "down"], cwd=PROJECT_DIR)
        # Собираем БЕЗ использования кеша для критических слоев, чтобы убрать следы Windows
        subprocess.run(["docker", "compose", "up", "-d", "--build"], cwd=PROJECT_DIR)
        
        print("\n⏳ Ожидание запуска бекенда (15 сек)...")
        time.sleep(15)
        
        print("\n📝 ФИНАЛЬНЫЕ ЛОГИ БЕКЕНДА (izinet-app):")
        subprocess.run(["docker", "logs", "--tail", "50", "izinet-app"], cwd=PROJECT_DIR)
        
        print("\n📝 СТАТУС NGINX:")
        subprocess.run(["docker", "ps", "--filter", "name=nginx-proxy"], cwd=PROJECT_DIR)
        
    except Exception as e:
        print(f"❌ Ошибка Docker: {e}")
    
    print("\n====================================================")
    print(f"🚀 Если в логах выше написано 'Сервер запущен', проверьте: https://{DOMAIN}")
    print("====================================================")

if __name__ == "__main__":
    main()
