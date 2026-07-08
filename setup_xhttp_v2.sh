#!/bin/bash
# IZINET — Автоматическая настройка Reality+XHTTP
# Читает формат из существующего inbound и создаёт XHTTP в том же стиле

DB="/opt/izinet/xui-db/x-ui.db"

echo "=== IZINET: Auto-setup Reality+XHTTP ==="

# 1. Останавливаем x3-ui
echo "[1/4] Остановка x3-ui..."
docker stop x3-ui 2>/dev/null || true
sleep 2

# 2. Удаляем старый inbound-44 и создаём новый с правильным форматом
echo "[2/4] Создание Reality+XHTTP inbound..."
python3 << 'PYEOF'
import sqlite3, json, sys

DB = "/opt/izinet/xui-db/x-ui.db"
XHTTP_PORT = 2087

conn = sqlite3.connect(DB)
c = conn.cursor()

# Удаляем старый inbound-44
c.execute("SELECT id FROM inbounds WHERE id=44")
if c.fetchone():
    c.execute("DELETE FROM inbounds WHERE id=44")
    print("  Удалён старый inbound-44")

# Читаем Reality ключи из inbound 39 (vpn-main)
c.execute("SELECT stream_settings FROM inbounds WHERE id=39")
row = c.fetchone()
if not row:
    print("  ОШИБКА: Inbound 39 не найден!")
    conn.close()
    sys.exit(1)

ss39 = json.loads(row[0] or '{}')
rs39 = ss39.get('realitySettings', {})

# Извлекаем ключи (3x-ui хранит их в realitySettings.settings)
settings_inner = rs39.get('settings', {})
priv = settings_inner.get('privateKey', '') or rs39.get('privateKey', '')
pub = settings_inner.get('publicKey', '') or rs39.get('publicKey', '')
sids = settings_inner.get('shortIds', []) or rs39.get('shortIds', [])

if not priv or not pub:
    print("  ОШИБКА: Reality ключи не найдены в inbound 39!")
    conn.close()
    sys.exit(1)

print(f"  Ключи прочитаны: pub={pub[:25]}...")

# Формируем stream_settings ТОЧНО как x3-ui (сравнено с inbound 39)
stream_settings = {
    "network": "xhttp",
    "security": "reality",
    "realitySettings": {
        "show": False,
        "xver": 0,
        "target": "www.cloudflare.com:443",
        "dest": "www.cloudflare.com:443",
        "serverNames": ["www.cloudflare.com"],
        "privateKey": priv,
        "publicKey": pub,
        "shortIds": sids,
        "minClientVer": "",
        "maxClientVer": "",
        "maxTimediff": 0,
        "settings": {
            "publicKey": pub,
            "fingerprint": "chrome",
            "serverName": "www.cloudflare.com",
            "spiderX": "/"
        }
    },
    "xhttpSettings": {
        "path": "/xhttp",
        "mode": "auto",
        "host": "www.cloudflare.com"
    }
}

# Формируем settings (clients) — ТОЧНО как x3-ui
settings = {
    "clients": [],
    "decryption": "none",
    "encryption": "none",
    "fallbacks": [
        {"name": "izinet.online", "alpn": "", "path": "", "dest": "host.docker.internal:3443", "xver": 0},
        {"dest": "host.docker.internal:3443", "xver": 0}
    ]
}

sniffing = {"enabled": True, "destOverride": ["http", "tls"], "routeOnly": False}

# Максимальный ID + 1
c.execute("SELECT COALESCE(MAX(id), 0) FROM inbounds")
max_id = c.fetchone()[0]
new_id = max_id + 1

# Вставляем
c.execute("""
    INSERT INTO inbounds (user_id, up, down, total, remark, enable, expiry_time,
                          listen, port, protocol, settings, stream_settings, tag, sniffing)
    VALUES (0, 0, 0, 0, ?, 1, 0, '', ?, 'vless', ?, ?, ?, ?)
""", (
    'izinet-reality-xhttp',
    XHTTP_PORT,
    json.dumps(settings, ensure_ascii=False, separators=(',', ':')),
    json.dumps(stream_settings, ensure_ascii=False, separators=(',', ':')),
    f'inbound-{new_id}',
    json.dumps(sniffing, ensure_ascii=False, separators=(',', ':'))
))

conn.commit()

# Проверяем
c.execute("SELECT id, port, remark, enable FROM inbounds WHERE port=?", (XHTTP_PORT,))
r = c.fetchone()
if r:
    print(f"  ✅ Создан inbound ID={r[0]} port={r[1]} remark={r[2]} enable={r[3]}")
else:
    print("  ❌ ОШИБКА: Inbound не создан!")

conn.close()
PYEOF

# 3. Запуск x3-ui
echo "[3/4] Запуск x3-ui..."
docker start x3-ui
sleep 15

# 4. Проверка
echo "[4/4] Проверка..."
docker logs x3-ui --tail 10 2>&1 | grep -i "error\|xhttp\|started\|inbound-44" || true

echo ""
echo "=== ГОТОВО ==="
echo "Открой панель http://194.50.94.28:2053 и проверь inbound на порту 2087"
