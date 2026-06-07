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
    """Загружает .env, игнорируя комментарии и очищая ключи от мусора"""
    env = {}
    if not os.path.exists(path): return env
    with open(path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#'): continue
            if '=' in line:
                key, value = line.split('=', 1)
                key = key.strip()
                # Убираем комментарии в конце строки и лишние пробелы
                value = value.split('#')[0].strip().strip('"').strip("'")
                # Для ключей Reality оставляем только валидные символы
                if "REALITY" in key:
                    value = ''.join(c for c in value if c.isalnum() or c in '+/=-_')
                env[key] = value
    return env

def main():
    print("====================================================")
    print("🛠️  IZINET ULTIMATE MASTER DOCTOR (FINAL FIX)")
    print("====================================================")

    # 1. Анализ окружения
    env = load_env_safe(ENV_PATH)
    DOMAIN = env.get("DOMAIN", "izinet.online")
    PRIV_KEY = env.get("XUI_REALITY_PRIV_KEY", "ABiVSJTP0fEMzgsHghSAsQJp-bYAJAat0jErpzaGtEo")
    PUB_KEY = env.get("XUI_REALITY_PUB_KEY", "CXL0o8BEC7wz-TIuA7w-QBbJIadSsb9xL7G6UB410Xw")

    # 2. Настройка базы данных Xray (Критично для работы сайта!)
    if os.path.exists(DB_PATH):
        try:
            print("⚙️  Настройка Xray (Sniffing + Fallback + Reality)...")
            conn = sqlite3.connect(DB_PATH)
            cursor = conn.cursor()
            
            # Чистим шаблон
            cursor.execute("UPDATE settings SET value = '{}' WHERE key = 'xrayTemplateConfig';")
            
            cursor.execute("SELECT id, settings, stream_settings FROM inbounds WHERE port = 443;")
            inbound = cursor.fetchone()
            if inbound:
                iid, sett_str, stream_str = inbound
                settings = json.loads(sett_str) if sett_str else {}
                stream = json.loads(stream_str) if stream_str else {}
                
                # Включаем Sniffing (ОБЯЗАТЕЛЬНО для работы сайта через порт 443)
                sniffing = {"enabled": True, "destOverride": ["http", "tls"], "routeOnly": False}
                
                # Настройка Fallback на системный Nginx
                settings["fallbacks"] = [{"dest": "host.docker.internal:3443", "xver": 0}]
                
                # Настройка Reality с маскировкой под Microsoft
                stream["security"] = "reality"
                rs = stream.get("realitySettings", {})
                rs["dest"] = "www.microsoft.com:443"
                rs["serverNames"] = ["www.microsoft.com", "microsoft.com"]
                rs["privateKey"] = PRIV_KEY
                rs["publicKey"] = PUB_KEY
                stream["realitySettings"] = rs
                
                # Обновляем всё сразу
                cursor.execute("UPDATE inbounds SET settings=?, stream_settings=?, sniffing=?, enable=1 WHERE id=?;", 
                               (json.dumps(settings), json.dumps(stream), json.dumps(sniffing), iid))
                print("✅ База XUI настроена: Sniffing ВКЛЮЧЕН, Fallback на 3443.")
            
            conn.commit()
            conn.close()
        except Exception as e:
            print(f"⚠️ Ошибка при настройке базы: {e}")

    # 3. Полная очистка и пересборка Docker
    print("\n🔄 Полная пересборка системы...")
    try:
        subprocess.run(["docker", "compose", "down"], cwd=PROJECT_DIR)
        
        # Удаляем временные файлы Windows
        for item in ["package-lock.json", "dist", "node_modules", ".vite"]:
            p = os.path.join(PROJECT_DIR, item)
            if os.path.exists(p):
                if os.path.isdir(p): shutil.rmtree(p)
                else: os.remove(p)

        # Сборка с передачей всех ключей (чтобы сайт видел базу)
        build_cmd = [
            "docker", "compose", "build", "--no-cache",
            "--build-arg", f"VITE_SUPABASE_URL={env.get('VITE_SUPABASE_URL','')}",
            "--build-arg", f"VITE_SUPABASE_ANON_KEY={env.get('VITE_SUPABASE_ANON_KEY','')}",
            "--build-arg", f"VITE_API_URL=https://{DOMAIN}"
        ]
        print(f"⚡ Запуск сборки...")
        subprocess.run(build_cmd, cwd=PROJECT_DIR)
        
        subprocess.run(["docker", "compose", "up", "-d"], cwd=PROJECT_DIR)
        
        print("\n⏳ Ожидание старта (20 сек)...")
        time.sleep(20)
        
        # Итоговая проверка
        print("\n📝 ЛОГИ БЕКЕНДА (izinet-app):")
        subprocess.run(["docker", "logs", "--tail", "30", "izinet-app"], cwd=PROJECT_DIR)
        
    except Exception as e:
        print(f"❌ Сбой Docker: {e}")

    print("\n====================================================")
    print(f"🚀 ВСЁ ГОТОВО! Проверьте сайт: https://{DOMAIN}")
    print("Если авторизация не работает — очистите кеш (Ctrl+F5).")
    print("====================================================")

if __name__ == "__main__":
    main()
