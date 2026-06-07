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

def load_env_safe(path):
    """Загружает .env, игнорируя комментарии и лишние пробелы"""
    env = {}
    if not os.path.exists(path): return env
    with open(path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#'): continue
            if '=' in line:
                # Разделяем только по первому знаку равно
                key, value = line.split('=', 1)
                key = key.strip()
                # Убираем комментарии в конце строки (например, ключ=значение # комментарий)
                value = value.split('#')[0].strip()
                # Очищаем от кавычек
                value = value.strip('"').strip("'")
                env[key] = value
    return env

def main():
    print("====================================================")
    print("🛠️  IZINET MASTER DOCTOR (REALIY KEY & BUILD FIX)")
    print("====================================================")

    # 1. Проверка и очистка переменных
    print("🔍 Анализ файла .env...")
    env = load_env_safe(ENV_PATH)
    
    required = ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "DOMAIN", "VITE_API_URL"]
    missing = [k for k in required if k not in env or not env[k]]
    
    if missing:
        print(f"❌ ОШИБКА: В .env отсутствуют или испорчены ключи: {', '.join(missing)}")
        print("Проверьте, нет ли лишнего текста в строках с этими ключами.")
        return

    DOMAIN = env["DOMAIN"]
    # Очищаем ключи от возможного мусора (русские буквы и т.д.)
    PRIV_KEY = env.get("XUI_REALITY_PRIV_KEY", "ABiVSJTP0fEMzgsHghSAsQJp-bYAJAat0jErpzaGtEo")
    PUB_KEY = env.get("XUI_REALITY_PUB_KEY", "CXL0o8BEC7wz-TIuA7w-QBbJIadSsb9xL7G6UB410Xw")
    
    # Гарантируем, что ключи содержат только допустимые символы Base64
    PUB_KEY = ''.join(c for c in PUB_KEY if c.isalnum() or c in '-_')
    PRIV_KEY = ''.join(c for c in PRIV_KEY if c.isalnum() or c in '-_')

    print(f"✅ Ключи очищены. PUB: {PUB_KEY[:10]}...")

    # 2. Настройка XUI
    if os.path.exists(DB_PATH):
        try:
            print("⚙️  Синхронизация Xray (Reality + Microsoft SNI)...")
            conn = sqlite3.connect(DB_PATH)
            cursor = conn.cursor()
            cursor.execute("SELECT id, settings, stream_settings FROM inbounds WHERE port = 443;")
            inbound = cursor.fetchone()
            if inbound:
                iid, sett_str, stream_str = inbound
                settings = json.loads(sett_str) if sett_str else {}
                stream = json.loads(stream_str) if stream_str else {}
                
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
                print("✅ База XUI успешно обновлена.")
            conn.commit()
            conn.close()
        except Exception as e:
            print(f"⚠️ Ошибка SQLite: {e}")

    # 3. Полная пересборка Docker (С КЛЮЧАМИ)
    print("\n🔄 Глубокая пересборка сайта и бекенда...")
    try:
        subprocess.run(["docker", "compose", "down"], cwd=PROJECT_DIR)
        
        # Удаляем мусор
        for f in ["package-lock.json", "dist", "node_modules"]:
            p = os.path.join(PROJECT_DIR, f)
            if os.path.exists(p):
                if os.path.isdir(p): shutil.rmtree(p)
                else: os.remove(p)

        # Сборка с передачей ВСЕХ параметров
        build_cmd = [
            "docker", "compose", "build", "--no-cache",
            "--build-arg", f"VITE_SUPABASE_URL={env['VITE_SUPABASE_URL']}",
            "--build-arg", f"VITE_SUPABASE_ANON_KEY={env['VITE_SUPABASE_ANON_KEY']}",
            "--build-arg", f"VITE_API_URL={env['VITE_API_URL']}"
        ]
        print(f"⚡ Команда: {' '.join(build_cmd)}")
        subprocess.run(build_cmd, cwd=PROJECT_DIR)
        
        subprocess.run(["docker", "compose", "up", "-d"], cwd=PROJECT_DIR)
        
        print("\n⏳ Проверка запуска (20 сек)...")
        time.sleep(20)
        subprocess.run(["docker", "logs", "--tail", "20", "izinet-app"], cwd=PROJECT_DIR)
        
    except Exception as e:
        print(f"❌ Ошибка: {e}")

    print("\n====================================================")
    print(f"🚀 ГОТОВО! Теперь авторизация и VPN должны работать.")
    print(f"Проверьте сайт: {env['VITE_API_URL']}")
    print("====================================================")

if __name__ == "__main__":
    main()
