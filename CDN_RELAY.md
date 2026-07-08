# Настройка CDN Relay через Cloudflare

## Проблема

Провайдер блокирует прямые подключения к VPN-серверу (194.50.94.28:443).
DPI распознаёт трафик и рвёт соединение до начала шифрования.

## Решение

Cloudflare проксирует трафик через свои IP-адреса.
Провайдер видит "обычный HTTPS на Cloudflare" и пропускает.

```
Без CDN:                         С CDN:
┌─────────┐   ┌──────────┐      ┌─────────┐   ┌────────────┐   ┌──────────┐
│ Клиент  │──▶│ 194.50...│      │ Клиент  │──▶│ Cloudflare │──▶│ 194.50...│
│         │   │ БЛОК!!!  │      │         │   │ IP         │   │          │
└─────────┘   └──────────┘      └─────────┘   └────────────┘   └──────────┘
```

## Шаг 1: Купить домен (если нет)

Нужен домен для настройки Cloudflare.
- reg.ru, namecheap, google domains — дёшево
- Или используй существующий izinet.online

## Шаг 2: Добавить домен в Cloudflare

1. Зарегистрируйся на [dash.cloudflare.com](https://dash.cloudflare.com)
2. Добавь домен → выбери бесплатный план
3. Cloudflare даст NS-серверы (ns1.cloudflare.com, ns2.cloudflare.com)
4. Зайди на площадку где купил домен → измени NS-серверы на Cloudflare

## Шаг 3: Настроить DNS

В Cloudflare Dashboard → DNS → Records:

| Type | Name | Content | Proxy |
|------|------|---------|-------|
| A | vpn | 194.50.94.28 | ☁️ Включён (оранжевое облако) |

**Важно:** Proxy ДОЛЖЕН быть включён (оранжевое облако).

## Шаг 4: Настроить SSL/TLS

В Cloudflare → SSL/TLS → Overview:
- Режим: **Full (Strict)**

## Шаг 5: Обновить Reality target

В панели 3x-ui → inbound 443 (vpn-main) → Stream:

| Поле | Было | Стало |
|------|------|-------|
| Target | host.docker.internal:3443 | vpn.izinet.online:443 |
| SNI | www.cloudflare.com | vpn.izinet.online |

**Или через SQLite:**
```bash
docker stop x3-ui
python3 -c "
import sqlite3, json
conn = sqlite3.connect('/opt/izinet/xui-db/x-ui.db')
c = conn.cursor()
c.execute('SELECT stream_settings FROM inbounds WHERE id=39')
row = c.fetchone()
ss = json.loads(row[0])
rs = ss.get('realitySettings', {})
rs['target'] = 'vpn.izinet.online:443'
rs['serverNames'] = ['vpn.izinet.online']
ss['realitySettings'] = rs
c.execute('UPDATE inbounds SET stream_settings=? WHERE id=39', (json.dumps(ss),))
conn.commit()
conn.close()
print('✅ Reality target обновлён')
"
docker start x3-ui
```

## Шаг 6: Обновить VLESS ссылки

В панели → inbound 443 → Протокол → обнови клиента.

Или перегенерируй подписку в админке сайта.

## Шаг 7: Проверить

```bash
# DNS резолвится через Cloudflare?
nslookup vpn.izinet.online
# Должен показать Cloudflare IP (104.x.x.x или 172.x.x.x)

# Порт открыт?
curl -v --connect-timeout 5 https://vpn.izinet.online:443
# Должен пройти TLS handshake
```

## Как это работает

```
1. Клиент запрашивает DNS для vpn.izinet.online
2. Cloudflare возвращает свой IP (104.x.x.x)
3. Клиент подключается к Cloudflare:443
4. Cloudflare проксирует трафик на 194.50.94.28:443
5. Reality handshake проходит через Cloudflare
6. VPN-трафик идёт через Cloudflare CDN
7. Провайдер видит "обычный HTTPS на Cloudflare"
```

## Альтернатива: Cloudflare Workers

Если прямой прокси не работает (Cloudflare блокирует не-HTTP трафик на бесплатном плане):

1. Создай Worker в Cloudflare Dashboard → Workers
2. Worker будет проксировать WebSocket соединения
3. Клиент подключается через WebSocket к Worker'у
4. Worker转发ает на VPN-сервер

Но это сложнее и требует настройки XHTTP+WebSocket на сервере.
