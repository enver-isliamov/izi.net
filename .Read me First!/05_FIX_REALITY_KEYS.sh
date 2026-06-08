#!/bin/bash
# 🔐 СКРИПТ ДЛЯ СИНХРОНИЗАЦИИ REALITY КЛЮЧЕЙ

set -e

cd /opt/izinet || exit 1

echo "════════════════════════════════════════════════════════════════"
echo "🔐 СИНХРОНИЗАЦИЯ REALITY КЛЮЧЕЙ (x3-ui DB ↔ .env)"
echo "════════════════════════════════════════════════════════════════"
echo ""

# === ПРОВЕРКА .env ===
if [ ! -f .env ]; then
    echo "❌ .env не найден!"
    echo "Запусти сначала: bash 02_FIX_ENV.sh"
    exit 1
fi

ENV_PRIV=$(grep "XUI_REALITY_PRIV_KEY=" .env | cut -d= -f2)
ENV_PUB=$(grep "XUI_REALITY_PUB_KEY=" .env | cut -d= -f2)

echo "Из .env:"
echo "  Private Key: ${ENV_PRIV:0:30}..."
echo "  Public Key:  ${ENV_PUB:0:30}..."
echo ""

# === ПРОВЕРКА x3-ui БД ===
echo "Проверяю x3-ui базу..."

if ! docker ps | grep -q "x3-ui"; then
    echo "❌ x3-ui контейнер не найден!"
    echo "Запусти: docker compose up -d"
    exit 1
fi

# === ОБНОВЛЕНИЕ БАЗЫ ===
echo ""
echo "🔄 Обновляю Reality ключи в SQLite базе x3-ui..."

docker exec x3-ui python3 << PYEOF
import sqlite3
import json
import os
import sys

DB_PATH = "/etc/x-ui/x-ui.db"
PRIV_KEY = os.environ.get("XUI_REALITY_PRIV_KEY", "${ENV_PRIV}")
PUB_KEY = os.environ.get("XUI_REALITY_PUB_KEY", "${ENV_PUB}")

try:
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Получаем все inbounds с портом 443
    cursor.execute("SELECT id, stream_settings FROM inbounds WHERE port=443 OR port=8443")
    rows = cursor.fetchall()
    
    if not rows:
        print("❌ Inbounds с портом 443/8443 не найдены!")
        sys.exit(1)
    
    updated = 0
    for iid, ss_raw in rows:
        try:
            ss = json.loads(ss_raw or "{}")
            
            # Инициализируем realitySettings если не существует
            if "realitySettings" not in ss:
                ss["realitySettings"] = {}
            
            rs = ss["realitySettings"]
            
            # Обновляем ключи
            rs["privateKey"] = PRIV_KEY
            rs["publicKey"] = PUB_KEY
            
            # Также обновляем в settings если существует
            if "settings" not in rs:
                rs["settings"] = {}
            rs["settings"]["publicKey"] = PUB_KEY
            
            # Сохраняем обратно
            updated_ss = json.dumps(ss)
            cursor.execute("UPDATE inbounds SET stream_settings=? WHERE id=?", (updated_ss, iid))
            print(f"✅ Inbound {iid}: обновлены Reality ключи")
            updated += 1
        except Exception as e:
            print(f"⚠️  Ошибка при обновлении inbound {iid}: {e}")
    
    conn.commit()
    conn.close()
    
    if updated > 0:
        print(f"\n✅ Всего обновлено: {updated} inbounds")
    else:
        print("\n❌ Ничего не обновлено!")
        
except Exception as e:
    print(f"❌ Ошибка базы: {e}")
    sys.exit(1)

PYEOF

echo ""
echo "🔄 Перезагружаю x3-ui для применения изменений..."
docker compose restart x3-ui

echo ""
echo "⏳ Жду 10 секунд..."
sleep 10

echo ""
echo "📊 Проверяю статус x3-ui:"
docker ps | grep x3-ui

echo ""
echo "════════════════════════════════════════════════════════════════"
echo "✅ REALITY КЛЮЧИ СИНХРОНИЗИРОВАНЫ"
echo "════════════════════════════════════════════════════════════════"

