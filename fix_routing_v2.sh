#!/bin/bash
DB="/opt/izinet/xui-db/x-ui.db"

echo "=== Исправление routing rules (через БД) ==="

# 1. Останавливаем x3-ui
docker stop x3-ui 2>/dev/null || true
sleep 2

# 2. Записываем routing rules в xrayTemplateConfig
python3 -c "
import sqlite3, json

DB = '$DB'
ROUTING = {
    'domainStrategy': 'IPIfNonMatch',
    'rules': [
        {'type': 'field', 'inboundTag': ['api'], 'outboundTag': 'api'},
        {'type': 'field', 'outboundTag': 'blocked', 'domain': ['geosite:category-ads-all']},
        {'type': 'field', 'outboundTag': 'direct', 'domain': ['geosite:ru-available-only-inside']},
        {'type': 'field', 'outboundTag': 'direct', 'ip': ['geoip:ru', 'geoip:private']}
    ]
}
DNS = ['https://dns.adguard-dns.com/dns-query', 'https://dns.yandex.ru/dns-query', '9.9.9.9', '77.88.8.8']
OUTBOUNDS = [
    {'protocol': 'freedom', 'tag': 'direct'},
    {'protocol': 'blackhole', 'tag': 'blocked'}
]

config = {'routing': ROUTING, 'dns': {'servers': DNS}, 'outbounds': OUTBOUNDS}
value = json.dumps(config, ensure_ascii=False, separators=(',', ':'))

conn = sqlite3.connect(DB)
c = conn.cursor()
c.execute(\"INSERT OR REPLACE INTO settings (key, value) VALUES ('xrayTemplateConfig', ?)\", (value,))
conn.commit()
conn.close()
print('✅ xrayTemplateConfig обновлён в БД')
"

# 3. Запускаем x3-ui
docker start x3-ui
sleep 15

# 4. Проверяем
echo ""
echo "=== ПРОВЕРКА ==="
docker exec x3-ui cat /app/bin/config.json | python3 -c "
import sys, json
c = json.load(sys.stdin)
rules = c.get('routing', {}).get('rules', [])
print(f'Правил: {len(rules)}')
for r in rules:
    tag = r.get('outboundTag', '?')
    src = r.get('domain', r.get('ip', r.get('inboundTag', '?')))
    print(f'  → {tag} ({src})')
"
