#!/usr/bin/env python3
"""
IZINET — Прямая запись routing rules в xrayTemplateConfig через SQLite.
Обходит ненадёжный HTTP API updateSettings().

Запуск: python3 patch_xray_routing.py
Доступ к БД: /etc/x-ui/x-ui.db (shared volume xui-db)
"""

import json
import os
import sys
import subprocess

DB_PATH = os.environ.get('XUI_DB_PATH', '/etc/x-ui/x-ui.db')

# Try alternate path if default doesn't exist (running from host)
if not os.path.exists(DB_PATH):
    alt = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', 'xui-db', 'x-ui.db')
    if os.path.exists(alt):
        DB_PATH = os.path.abspath(alt)

ROUTING_RULES = [
    {
        "type": "field",
        "inboundTag": ["api"],
        "outboundTag": "api",
        "izinet_managed": True
    },
    {
        "type": "field",
        "outboundTag": "direct",
        "domain": [
            "geosite:category-ru",
            "geosite:sberbank",
            "geosite:tinkoff",
            "domain:vk.com",
            "domain:yandex.ru",
            "domain:yandex.ua",
            "domain:mail.ru",
            "domain:ok.ru",
            "domain:ru"
        ],
        "izinet_managed": True
    },
    {
        "type": "field",
        "outboundTag": "blocked",
        "domain": [
            "geosite:category-ads-all"
        ],
        "izinet_managed": True
    },
    {
        "type": "field",
        "outboundTag": "direct",
        "ip": [
            "geoip:ru",
            "geoip:private"
        ],
        "izinet_managed": True
    }
]

API_CONFIG = {
    "tag": "api",
    "services": ["HandlerService", "LoggerService", "StatsService"]
}

STATS_CONFIG = {}

POLICY_CONFIG = {
    "levels": {
        "0": {
            "statsUserUplink": True,
            "statsUserDownlink": True
        }
    },
    "system": {
        "statsInboundUplink": True,
        "statsInboundDownlink": True,
        "statsOutboundUplink": True,
        "statsOutboundDownlink": True
    }
}

DNS_CONFIG = {
    "servers": [
        "localhost",
        "https://dns.adguard-dns.com/dns-query",
        "https://dns.yandex.ru/dns-query",
        "94.140.14.14",
        "77.88.8.8",
        "9.9.9.9"
    ]
}

OUTBOUNDS_CONFIG = [
    {"protocol": "freedom", "tag": "direct"},
    {"protocol": "blackhole", "tag": "blocked"}
]

API_INBOUND = {
    "listen": "127.0.0.1",
    "port": 62789,
    "protocol": "dokodemo-door",
    "settings": {"address": "127.0.0.1"},
    "tag": "api"
}


def read_template():
    """Читает xrayTemplateConfig из SQLite."""
    try:
        import sqlite3
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.execute("SELECT value FROM settings WHERE key = 'xrayTemplateConfig'")
        row = cursor.fetchone()
        conn.close()
        if row and row[0]:
            return json.loads(row[0])
    except Exception as e:
        print(f"⚠️ Не удалось прочитать SQLite: {e}")
    return {}


def write_template(config):
    """Записывает xrayTemplateConfig в SQLite."""
    try:
        import sqlite3
        conn = sqlite3.connect(DB_PATH)
        config_json = json.dumps(config, ensure_ascii=False)
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('xrayTemplateConfig', ?)",
            (config_json,)
        )
        conn.commit()
        conn.close()
        print(f"✅ xrayTemplateConfig записан в SQLite ({len(config_json)} chars)")
        return True
    except Exception as e:
        print(f"❌ Ошибка записи SQLite: {e}")
        return False


def restart_xray_via_api():
    """Перезапускает xray через API панели."""
    try:
        import urllib.request
        from http.cookiejar import MozillaCookiejar

        cj = MozillaCookiejar('/tmp/xui_cookies')
        opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))

        # Login
        login_url = "http://localhost:2053/login"
        login_data = "username=oja&password=sireyra".encode()
        req = urllib.request.Request(login_url, data=login_data, headers={"Content-Type": "application/x-www-form-urlencoded"})
        opener.open(req)

        # Get CSRF token
        csrf_req = urllib.request.Request("http://localhost:2053/csrf-token")
        csrf_resp = json.loads(opener.open(csrf_req).read())
        csrf_token = csrf_resp.get("obj", "")

        # Restart panel
        restart_url = "http://localhost:2053/panel/setting/restartPanel"
        restart_req = urllib.request.Request(restart_url, data=b"{}", headers={"X-CSRF-Token": csrf_token, "Content-Type": "application/json"})
        opener.open(restart_req)
        print("✅ Xray перезапущен через API")
        return True
    except Exception as e:
        print(f"⚠️ Не удалось перезапустить Xray через API: {e}")
        return False


def main():
    print("=" * 50)
    print("  IZINET — Патчинг xrayTemplateConfig routing")
    print("=" * 50)

    if not os.path.exists(DB_PATH):
        print(f"❌ БД не найдена: {DB_PATH}")
        sys.exit(1)

    # Читаем текущий шаблон
    template = read_template()
    print(f"📋 Текущий шаблон: {len(json.dumps(template))} chars")

    # Проверяем что routing уже есть
    current_rules = template.get("routing", {}).get("rules", [])
    managed_rules = [r for r in current_rules if r.get("izinet_managed")]

    if len(managed_rules) >= 3:
        print("✅ Routing rules уже настроены (izinet_managed >= 3)")
        print(f"   Текущие правила: {len(current_rules)} (управляемых: {len(managed_rules)})")
        return

    # Обновляем шаблон
    template["api"] = API_CONFIG
    template["stats"] = STATS_CONFIG
    template["policy"] = POLICY_CONFIG
    template["dns"] = DNS_CONFIG
    template["outbounds"] = OUTBOUNDS_CONFIG

    # Ensure api inbound exists in template
    inbounds = template.get("inbounds", [])
    api_exists = any(ib.get("tag") == "api" for ib in inbounds)
    if not api_exists:
        inbounds.append(API_INBOUND)
    template["inbounds"] = inbounds

    # Set routing rules
    template["routing"] = {
        "domainStrategy": "AsIs",
        "rules": ROUTING_RULES
    }

    # Записываем
    if write_template(template):
        print(f"✅ Routing rules обновлены: {len(ROUTING_RULES)} правил")
        print("   - api (управление панелью)")
        print("   - ru direct (рунет)")
        print("   - ads block (реклама)")
        print("   - ru+private ip direct")

        # Перезапускаем Xray
        restart_xray_via_api()
    else:
        print("❌ Не удалось записать шаблон")
        sys.exit(1)


if __name__ == "__main__":
    main()
