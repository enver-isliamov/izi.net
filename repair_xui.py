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

def load_env(path):
    env = {}
    if os.path.exists(path):
        with open(path, 'r') as f:
            for line in f:
                if '=' in line and not line.startswith('#'):
                    k, v = line.strip().split('=', 1)
                    env[k.strip()] = v.strip('"').strip("'")
    return env

def main():
    print("====================================================")
    print("🛠️  IZINET MASTER DOCTOR (AUTH & REALITY FIX)")
    print("====================================================")

    # 1. Проверка переменных окружения
    print("🔍 Проверка файла .env...")
    env = load_env(ENV_PATH)
    
    # Критичные ключи для авторизации на сайте
    required = ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "DOMAIN"]
    missing = [k for k in required if k not in env or not env[k] or "<NEW_" in env[k]]
    
    if missing:
        print(f"❌ ОШИБКА: В .env отсутствуют важные ключи: {', '.join(missing)}")
        print("Без них сайт и авторизация работать НЕ БУДУТ.")
        return

    DOMAIN = env["DOMAIN"]
    PRIV_KEY = env.get("XUI_REALITY_PRIV_KEY", "ABiVSJTP0fEMzgsHghSAsQJp-bYAJAat0jErpzaGtEo")
    PUB_KEY = env.get("XUI_REALITY_PUB_KEY", "CXL0o8BEC7wz-TIuA7w-QBbJIadSsb9xL7G6UB410Xw")

    # 2. Настройка XUI
    if os.path.exists(DB_PATH):
        try:
            print("⚙️  Синхронизация Xray (Reality + Microsoft SNI)...")
            conn = sqlite3.connect(DB_PATH)
            cursor = conn.cursor()
            
            # Находим 443 порт
            cursor.execute("SELECT id, settings, stream_settings FROM inbounds WHERE port = 443;")
            inbound = cursor.fetchone()
            if inbound:
                iid, sett_str, stream_str = inbound
                settings = json.loads(sett_str) if sett_str else {}
                stream = json.loads(stream_str) if stream_str else {}
                
                # Маскировка под Microsoft (самый стабильный вариант для Hiddify)
                settings["fallbacks"] = [{"dest": "host.docker.internal:3443", "xver": 0}]
                stream["security"] = "reality"
                rs = stream.get("realitySettings", {})
                rs["dest"] = "www.microsoft.com:443"
                rs["serverNames"] = ["www.microsoft.com", "microsoft.com"]
                rs["privateKey"] = PRIV_KEY
                rs["publicKey"] = PUB_KEY
                stream["realitySettings"] = rs
                
                cursor.execute("UPDATE inbounds SET settings=?, stream_settings=?, enable=1 WHERE id=?;", 
                               (json.dumps(settings), json.dumps(stream), iid))
                print("✅ База XUI настроена.")
            conn.commit()
            conn.close()
        except Exception as e:
            print(f"⚠️ Ошибка базы: {e}")

    # 3. Перезапуск с принудительной передачей переменных для ФРОНТЕНДА
    print("\n🔄 Пересборка Docker (с передачей ключей Supabase)...")
    try:
        # Останавливаем всё старое
        subprocess.run(["docker", "compose", "down"], cwd=PROJECT_DIR)
        
        # Очистка лок-файлов
        for f in ["package-lock.json", "dist"]:
            p = os.path.join(PROJECT_DIR, f)
            if os.path.exists(p):
                if os.path.isdir(p): shutil.rmtree(p)
                else: os.remove(p)

        # Сборка: ПЕРЕДАЕМ АРГУМЕНТЫ ДЛЯ САЙТА (Vite)
        build_cmd = [
            "docker", "compose", "build", "--no-cache",
            "--build-arg", f"VITE_SUPABASE_URL={env['VITE_SUPABASE_URL']}",
            "--build-arg", f"VITE_SUPABASE_ANON_KEY={env['VITE_SUPABASE_ANON_KEY']}"
        ]
        subprocess.run(build_cmd, cwd=PROJECT_DIR)
        
        # Запуск
        subprocess.run(["docker", "compose", "up", "-d"], cwd=PROJECT_DIR)
        
        print("\n⏳ Ожидание запуска (15 сек)...")
        time.sleep(15)
        
        # Проверка логов
        print("\n📝 ФИНАЛЬНЫЕ ЛОГИ ПРИЛОЖЕНИЯ:")
        subprocess.run(["docker", "logs", "--tail", "20", "izinet-app"], cwd=PROJECT_DIR)
        
    except Exception as e:
        print(f"❌ Ошибка Docker: {e}")

    print("\n====================================================")
    print(f"🏆 РЕЗУЛЬТАТ: Если сайт открывается, но не логинит —")
    print(f"проверьте VITE_SUPABASE_ANON_KEY в файле .env!")
    print("====================================================")

if __name__ == "__main__":
    main()
