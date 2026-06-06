#!/usr/bin/env python3
import os
import sqlite3
import json
import subprocess
import time

DB_PATH = "/opt/izinet/xui-db/x-ui.db"
PROJECT_DIR = "/opt/izinet"

def main():
    print("====================================================")
    print("🛡️  IZINET PROFESSIONAL RESTORATION (STANDARDS-BASED)")
    print("====================================================")
    
    if not os.path.exists(DB_PATH):
        print("❌ Database not found at " + DB_PATH)
        return

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # 1. СБРОС ШАБЛОНА (REVERT TO FACTORY DEFAULT)
    # Убираем кастомные шаблоны, чтобы XUI сам генерировал чистый конфиг
    print("⚙️  Resetting Xray template to default...")
    cursor.execute("UPDATE settings SET value = '' WHERE key = 'xrayTemplateConfig';")

    # 2. НАСТРОЙКА ОСНОВНОГО ПОРТА 443 (REALITY)
    print("⚙️  Configuring Inbound 443 (VLESS + Reality + Fallback)...")
    cursor.execute("SELECT id, settings, stream_settings FROM inbounds WHERE port = 443;")
    inbound = cursor.fetchone()
    
    if inbound:
        iid, sett_str, stream_str = inbound
        settings = json.loads(sett_str)
        stream = json.loads(stream_str)
        
        # А) Снимаем ограничения (limitIp: 0)
        if "clients" in settings:
            for client in settings["clients"]:
                client["limitIp"] = 0
                client["totalGB"] = 0 # No traffic limit by default for stability
        
        # Б) Настраиваем Fallback на Nginx (через имя сервиса Docker)
        # Это стандартный способ связи контейнеров
        settings["fallbacks"] = [
            {"dest": "nginx:3443", "xver": 0},
            {"name": "izinet.online", "dest": "nginx:3443", "xver": 0}
        ]
        
        # В) Параметры Reality (Стабильные и проверенные)
        stream["security"] = "reality"
        if "realitySettings" not in stream: stream["realitySettings"] = {}
        rs = stream["realitySettings"]
        
        rs["dest"] = "www.microsoft.com:443"
        rs["serverNames"] = ["www.microsoft.com", "microsoft.com"]
        rs["privateKey"] = "ABiVSJTP0fEMzgsHghSAsQJp-bYAJAat0jErpzaGtEo"
        rs["shortIds"] = ["79b27cf7799d5b4c"]
        
        if "settings" not in rs: rs["settings"] = {}
        rs["settings"]["publicKey"] = "CXL0o8BEC7wz-TIuA7w-QBbJIadSsb9xL7G6UB410Xw"
        
        cursor.execute("UPDATE inbounds SET settings=?, stream_settings=?, enable=1 WHERE id=?;", 
                       (json.dumps(settings), json.dumps(stream), iid))
        print("✅ Port 443 configured correctly.")

    # 3. ОЧИСТКА ГЛОБАЛЬНЫХ НАСТРОЕК
    print("🧹 Cleaning global settings (Traffic Notifications)...")
    # Мы полностью отключаем проблемные уведомления
    cursor.execute("UPDATE settings SET value = '' WHERE key = 'ExternalTrafficInformURI';")
    cursor.execute("UPDATE settings SET value = 'false' WHERE key = 'TgBotEnable';")

    # 4. ОТКЛЮЧЕНИЕ ВСЕХ КОНФЛИКТУЮЩИХ ПОРТОВ
    print("🛑 Disabling secondary ports (8443, etc.)...")
    cursor.execute("UPDATE inbounds SET enable = 0 WHERE port != 443 AND port != 2053;")

    conn.commit()
    conn.close()

    # 5. ПЕРЕЗАПУСК СИСТЕМЫ С ОЧИСТКОЙ СЕТИ
    print("\n🔄 Performing standard Docker restart...")
    subprocess.run(["docker", "compose", "down"], cwd=PROJECT_DIR)
    subprocess.run(["docker", "compose", "up", "-d"], cwd=PROJECT_DIR)
    
    print("\n⏳ System is stabilizing (10s)...")
    time.sleep(10)
    
    # ФИНАЛЬНАЯ ПРОВЕРКА
    print("\n--- FINAL STATUS CHECK ---")
    subprocess.run(["docker", "ps"], cwd=PROJECT_DIR)
    
    print("\n====================================================")
    print("✅ ВСЁ ВОССТАНОВЛЕНО ПО СТАНДАРТАМ.")
    print("👉 Проверьте сайт: https://izinet.online")
    print("👉 Проверьте VPN: Используйте СТАРЫЙ ключ (он должен ожить).")
    print("====================================================")

if __name__ == "__main__":
    main()
