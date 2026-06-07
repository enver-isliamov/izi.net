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
    env = {}
    if not os.path.exists(path): return env
    with open(path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#'): continue
            if '=' in line:
                key, value = line.split('=', 1)
                key = key.strip()
                value = value.split('#')[0].strip().strip('"').strip("'")
                if "REALITY" in key:
                    value = ''.join(c for c in value if c.isalnum() or c in '+/=-_')
                env[key] = value
    return env

def main():
    print("====================================================")
    print("🛠️  IZINET MASTER DOCTOR (ADMIN & VPN FIX)")
    print("====================================================")

    # 1. Анализ окружения
    env = load_env_safe(ENV_PATH)
    DOMAIN = env.get("DOMAIN", "izinet.online")
    PRIV_KEY = env.get("XUI_REALITY_PRIV_KEY", "ABiVSJTP0fEMzgsHghSAsQJp-bYAJAat0jErpzaGtEo")
    PUB_KEY = env.get("XUI_REALITY_PUB_KEY", "CXL0o8BEC7wz-TIuA7w-QBbJIadSsb9xL7G6UB410Xw")

    # 2. Настройка Xray (Глубокая чистка + Sniffing)
    if os.path.exists(DB_PATH):
        try:
            print("⚙️  Синхронизация Xray...")
            conn = sqlite3.connect(DB_PATH)
            cursor = conn.cursor()
            cursor.execute("UPDATE settings SET value = '{}' WHERE key = 'xrayTemplateConfig';")
            
            cursor.execute("SELECT id, settings, stream_settings FROM inbounds WHERE port = 443;")
            inbound = cursor.fetchone()
            if inbound:
                iid, sett_str, stream_str = inbound
                settings = json.loads(sett_str) if sett_str else {}
                stream = json.loads(stream_str) if stream_str else {}
                
                # Sniffing - ГЛАЗ СЕРВЕРА
                sniffing = {"enabled": True, "destOverride": ["http", "tls"], "routeOnly": False}
                settings["fallbacks"] = [{"dest": "host.docker.internal:3443", "xver": 0}]
                
                stream["security"] = "reality"
                rs = stream.get("realitySettings", {})
                rs["dest"] = "www.microsoft.com:443"
                rs["serverNames"] = ["www.microsoft.com", "microsoft.com"]
                rs["privateKey"] = PRIV_KEY
                rs["publicKey"] = PUB_KEY
                stream["realitySettings"] = rs
                
                cursor.execute("UPDATE inbounds SET settings=?, stream_settings=?, sniffing=?, enable=1 WHERE id=?;", 
                               (json.dumps(settings), json.dumps(stream), json.dumps(sniffing), iid))
                print(f"✅ VPN настроен (PUB KEY: {PUB_KEY[:10]}...).")
            conn.commit()
            conn.close()
        except Exception as e:
            print(f"⚠️ Ошибка базы: {e}")

    # 3. Полная очистка и пересборка Docker (API FIX)
    print("\n🔄 Пересборка системы...")
    try:
        subprocess.run(["docker", "compose", "down"], cwd=PROJECT_DIR)
        for item in ["package-lock.json", "dist", "node_modules", ".vite"]:
            p = os.path.join(PROJECT_DIR, item)
            if os.path.exists(p):
                if os.path.isdir(p): shutil.rmtree(p)
                else: os.remove(p)

        build_cmd = [
            "docker", "compose", "build", "--no-cache",
            "--build-arg", f"VITE_SUPABASE_URL={env.get('VITE_SUPABASE_URL','')}",
            "--build-arg", f"VITE_SUPABASE_ANON_KEY={env.get('VITE_SUPABASE_ANON_KEY','')}",
            "--build-arg", f"VITE_API_URL=https://{DOMAIN}"
        ]
        subprocess.run(build_cmd, cwd=PROJECT_DIR)
        subprocess.run(["docker", "compose", "up", "-d"], cwd=PROJECT_DIR)
        
        print("\n⏳ Ожидание и логи (20 сек)...")
        time.sleep(20)
        subprocess.run(["docker", "logs", "--tail", "50", "izinet-app"], cwd=PROJECT_DIR)
        
    except Exception as e:
        print(f"❌ Ошибка Docker: {e}")

    print("\n====================================================")
    print(f"🚀 ВСЁ ГОТОВО! Теперь админка и VPN должны ожить.")
    print(f"Проверьте сайт: https://{DOMAIN}")
    print("====================================================")

if __name__ == "__main__":
    main()
