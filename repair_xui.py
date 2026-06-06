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
                    parts = line.strip().split('=', 1)
                    if len(parts) == 2:
                        k, v = parts
                        env[k] = v.strip('"').strip("'")
    return env

def save_env(path, env):
    with open(path, 'w') as f:
        for k, v in env.items():
            f.write(f"{k}={v}\n")

def main():
    print("====================================================")
    print("🛠️  IZINET ULTIMATE REPAIR (WEBSOCKET & XRAY FIX)")
    print("====================================================")

    # 1. Очистка .env от дубликатов и мусора
    print("🧹 Очистка файла .env...")
    env = load_env(ENV_PATH)
    # Убираем плейсхолдеры если они попали в файл
    if env.get("XUI_REALITY_PUB_KEY") == "<NEW_PUBLIC_KEY>":
        del env["XUI_REALITY_PUB_KEY"]
    if env.get("XUI_REALITY_PRIV_KEY") == "<NEW_PRIVATE_KEY>":
        del env["XUI_REALITY_PRIV_KEY"]
    
    PRIV_KEY = env.get("XUI_REALITY_PRIV_KEY", "ABiVSJTP0fEMzgsHghSAsQJp-bYAJAat0jErpzaGtEo")
    PUB_KEY = env.get("XUI_REALITY_PUB_KEY", "CXL0o8BEC7wz-TIuA7w-QBbJIadSsb9xL7G6UB410Xw")
    
    env["XUI_REALITY_PRIV_KEY"] = PRIV_KEY
    env["XUI_REALITY_PUB_KEY"] = PUB_KEY
    save_env(ENV_PATH, env)

    # 2. Восстановление базы данных Xray
    if os.path.exists(DB_PATH):
        try:
            print("⚙️  Восстановление структуры базы XUI...")
            conn = sqlite3.connect(DB_PATH)
            cursor = conn.cursor()
            
            # Фикс: Не ставим пустую строку в шаблон, ставим валидный пустой JSON или оставляем как есть
            cursor.execute("UPDATE settings SET value = '{}' WHERE key = 'xrayTemplateConfig' AND (value = '' OR value IS NULL);")
            
            cursor.execute("SELECT id, settings, stream_settings FROM inbounds WHERE port = 443;")
            inbound = cursor.fetchone()
            if inbound:
                iid, sett_str, stream_str = inbound
                
                # Проверка на валидность JSON перед парсингом
                try: settings = json.loads(sett_str) if sett_str else {}
                except: settings = {}
                
                try: stream = json.loads(stream_str) if stream_str else {}
                except: stream = {}
                
                # Корректный Fallback
                settings["fallbacks"] = [{"dest": "host.docker.internal:3443", "xver": 0}]
                
                # Настройка Reality
                stream["security"] = "reality"
                rs = stream.get("realitySettings", {})
                rs["dest"] = "www.microsoft.com:443"
                rs["serverNames"] = ["www.microsoft.com", "microsoft.com"]
                rs["privateKey"] = PRIV_KEY
                rs["publicKey"] = PUB_KEY
                stream["realitySettings"] = rs
                
                # Убеждаемся что JSON не будет "unexpected end of input"
                cursor.execute("UPDATE inbounds SET settings=?, stream_settings=?, enable=1 WHERE id=?;", 
                               (json.dumps(settings), json.dumps(stream), iid))
                print("✅ База XUI восстановлена (443 Reality).")
            
            conn.commit()
            conn.close()
        except Exception as e:
            print(f"⚠️ Ошибка при ремонте базы: {e}")

    # 3. Полный перезапуск с очисткой
    print("\n🔄 Перезапуск Docker с глубокой очисткой...")
    try:
        subprocess.run(["docker", "compose", "down"], cwd=PROJECT_DIR)
        
        # Удаляем старые слои и лок-файлы
        for f in ["package-lock.json", "dist", "node_modules"]:
            p = os.path.join(PROJECT_DIR, f)
            if os.path.exists(p):
                if os.path.isdir(p): shutil.rmtree(p)
                else: os.remove(p)

        # Сборка с установкой библиотеки 'ws'
        subprocess.run(["docker", "compose", "build", "--no-cache"], cwd=PROJECT_DIR)
        subprocess.run(["docker", "compose", "up", "-d"], cwd=PROJECT_DIR)
        
        print("\n⏳ Ожидание старта (20 сек)...")
        time.sleep(20)
        
        print("\n📝 ЛОГИ ПРИЛОЖЕНИЯ (izinet-app):")
        subprocess.run(["docker", "logs", "izinet-app"], cwd=PROJECT_DIR)
        
        print("\n📝 ЛОГИ VPN (x3-ui):")
        subprocess.run(["docker", "logs", "--tail", "20", "x3-ui"], cwd=PROJECT_DIR)
        
    except Exception as e:
        print(f"❌ Ошибка Docker: {e}")

    print("\n====================================================")
    print("🏆 ЕСЛИ ВЫ ВИДИТЕ ОШИБКИ ВЫШЕ — СКОПИРУЙТЕ ИХ МНЕ!")
    print("====================================================")

if __name__ == "__main__":
    main()
