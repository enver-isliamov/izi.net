#!/usr/bin/env python3
import os
import sqlite3
import json
import subprocess
import time
from dotenv import load_dotenv

# Пути к файлам внутри Docker-окружения
DB_PATH = "/opt/izinet/xui-db/x-ui.db"
PROJECT_DIR = "/opt/izinet"
ENV_PATH = os.path.join(PROJECT_DIR, ".env")

# Загружаем переменные окружения
if os.path.exists(ENV_PATH):
    load_dotenv(ENV_PATH)
else:
    load_dotenv()

DOMAIN = os.getenv("DOMAIN", "izinet.online")
# Используем ключи из .env или дефолтные, если их нет
PRIV_KEY = os.getenv("XUI_REALITY_PRIV_KEY", "ABiVSJTP0fEMzgsHghSAsQJp-bYAJAat0jErpzaGtEo")
PUB_KEY = os.getenv("XUI_REALITY_PUB_KEY", "CXL0o8BEC7wz-TIuA7w-QBbJIadSsb9xL7G6UB410Xw")

def main():
    print("====================================================")
    print("🛠️  IZINET MASTER DOCTOR (УЛУЧШЕННАЯ ВЕРСИЯ)")
    print("====================================================")
    
    if not os.path.exists(DB_PATH):
        print(f"❌ База данных не найдена по пути: {DB_PATH}")
        return

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # 1. СБРОС ШАБЛОНА XRAY
    print("⚙️  Сброс шаблона Xray...")
    cursor.execute("UPDATE settings SET value = '' WHERE key = 'xrayTemplateConfig';")

    # 2. НАСТРОЙКА ПОРТА 443 (REALITY + FALLBACKS)
    print(f"⚙️  Настройка порта 443 (Reality + Fallbacks) для домена {DOMAIN}...")
    cursor.execute("SELECT id, settings, stream_settings FROM inbounds WHERE port = 443;")
    inbound = cursor.fetchone()
    
    if inbound:
        iid, sett_str, stream_str = inbound
        settings = json.loads(sett_str) if sett_str else {}
        stream = json.loads(stream_str) if stream_str else {}
        
        # А) Снимаем ограничения по IP и трафику для этого инбаунда
        if "clients" in settings:
            for client in settings["clients"]:
                client["limitIp"] = 0
                client["totalGB"] = 0
        
        # Б) Настройка Fallbacks на контейнер Nginx (порт 3443)
        # В Docker-сети обращение по имени сервиса 'nginx' надежнее, чем host.docker.internal
        FALLBACK_DEST = "nginx:3443"
        settings["fallbacks"] = [
            {"name": DOMAIN, "dest": FALLBACK_DEST, "xver": 0},
            {"name": f"www.{DOMAIN}", "dest": FALLBACK_DEST, "xver": 0},
            {"dest": FALLBACK_DEST, "xver": 0}
        ]
        
        # В) Параметры Reality
        stream["security"] = "reality"
        if "realitySettings" not in stream: stream["realitySettings"] = {}
        rs = stream["realitySettings"]
        
        # Маскируемся под наш же Nginx, чтобы все легитимные HTTPS запросы уходили на сайт
        rs["dest"] = FALLBACK_DEST
        rs["serverNames"] = [DOMAIN, f"www.{DOMAIN}"]
        rs["privateKey"] = PRIV_KEY
        
        if "settings" not in rs: rs["settings"] = {}
        rs["settings"]["publicKey"] = PUB_KEY
        rs["publicKey"] = PUB_KEY
        rs["shortIds"] = ["79b27cf7799d5b4c", "0248", "36b963e7713fa1", "34d587", "ff"]
        
        # Г) ВКЛЮЧАЕМ SNIFFING (Критично для работы Fallbacks!)
        sniffing = {"enabled": True, "destOverride": ["http", "tls"], "routeOnly": False}
        
        cursor.execute("UPDATE inbounds SET settings=?, stream_settings=?, sniffing=?, enable=1 WHERE id=?;", 
                       (json.dumps(settings), json.dumps(stream), json.dumps(sniffing), iid))
        print("✅ Порт 443 настроен: Reality + Fallbacks на nginx:3443.")

    # 3. ГЛОБАЛЬНЫЕ НАСТРОЙКИ
    print("🧹 Очистка глобальных настроек...")
    cursor.execute("UPDATE settings SET value = 'http://127.0.0.1:2053/ignore' WHERE key = 'ExternalTrafficInformURI';")
    cursor.execute("UPDATE settings SET value = 'false' WHERE key = 'TgBotEnable';")

    # 4. ОТКЛЮЧЕНИЕ НЕИСПОЛЬЗУЕМЫХ ПОРТОВ
    # Оставляем только 443 (VPN+Web) и 2053 (Панель)
    cursor.execute("UPDATE inbounds SET enable = 0 WHERE port NOT IN (443, 2053);")

    conn.commit()
    conn.close()

    # 5. ПЕРЕЗАПУСК СИСТЕМЫ
    print("\n🔄 Перезапуск Docker контейнеров...")
    try:
        subprocess.run(["docker", "compose", "down"], cwd=PROJECT_DIR)
        subprocess.run(["docker", "compose", "up", "-d", "--build"], cwd=PROJECT_DIR)
        print(f"\n⏳ Система готова. Проверьте: https://{DOMAIN}")
    except Exception as e:
        print(f"❌ Ошибка при перезапуске Docker: {e}")
    
    print("====================================================")

if __name__ == "__main__":
    main()
