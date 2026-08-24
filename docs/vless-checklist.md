# VLESS / подписки — чек-лист проверок (чтобы не ломалось)

> Файл добавлен по итогам инцидента 2026-08: «ссылки/QR не импортируются, VLESS не подключается».
> Три корневые причины: `vpn_servers.inbound_id=0`, отсутствие endpoint `addClient` в 3x-ui (404), истёкший TLS-сертификат домена.
> **Правило:** перед релизом и после любого изменения панели/ключей — пройти чек-лист ниже.

## Формат VLESS Reality ссылки

```
vless://<UUID>@<host>:443?type=tcp&security=reality&sni=www.cloudflare.com&pbk=<PUBLIC_KEY>&fp=chrome&sid=<SHORT_ID>&spx=%2F&flow=xtls-rprx-vision#izinet.online_<email>
```

Поля, которые не должны расходиться между ссылкой и панелью:

| Поле | Источник в панели |
|------|-------------------|
| `UUID` | `settings.clients[].id` inbound'а |
| `pbk` | `streamSettings.realitySettings.publicKey` (inbound 443) |
| `sid` | `streamSettings.realitySettings.shortIds[0]` |
| `sni` | `realitySettings.serverNames` (домен, не IP) |
| `flow=xtls-rprx-vision` | только для reality + tcp |

## Обязательные проверки перед релизом

1. `vpn_servers.inbound_id` активного сервера — реальный id reality inbound (обычно 39), **не 0**.
2. Панель: число клиентов в inbound 39/43/47 = количеству устройств активных подписок.
3. `/api/sub/<active-id>` → HTTP 200, в base64 присутствуют `vless://` и `hysteria2://`.
4. TLS-сертификат `izinet.online` / `vpn.izinet.online` **не истёк**:
   ```bash
   openssl s_client -connect vpn.izinet.online:443 -servername izinet.online </dev/null 2>/dev/null | openssl x509 -noout -dates
   ```
5. Пробный импорт подписочной ссылки и QR в Hiddify — без ошибки сертификата.

## Правило провижининга (addClient у этой версии 3x-ui НЕТ)

- Клиенты добавляются **только** полным обновлением inbound:
  `POST /panel/api/inbounds/update/:id` со всем объектом inbound; `settings` и `streamSettings` — **объекты** (не JSON-строки).
- Поле клиента `tgId` — **int64** (`0`), не строка.
- `POST /panel/api/inbounds/addClient` в этой версии панели **отсутствует (404)** — в коде используется fallback `addClientViaFullUpdate`.
- После изменения ключей/инбаундов перегенерировать ссылки: `POST /api/admin/system/regenerate-all-links`.

## Что НЕ является причиной «VLESS не подключается» (ложные следы из инцидента)

- Ключи/UUID/sid совпадали — не причина.
- `minClientVer` 1.0.0 → 0 — не причина для активных подписок.
- Перезагрузка сервера (смена ядра) — не причина.
- Настоящие причины: `inbound_id=0`, отсутствующий `addClient`, истёкший TLS-сертификат.

## Быстрый сценарий починки (по шагам)

```bash
# 1) проверить данные сервера
# inbound_id должен указывать на reality inbound (39), не 0

# 2) перевыпустить TLS-сертификат
certbot renew && systemctl reload nginx

# 3) перегенерировать ссылки (admin API)
curl -k -X POST https://izinet.online/api/admin/system/regenerate-all-links

# 4) проверить клиентов в панели (http://IP:2053) — counts в 39/43/47 должны совпадать с устройствами

# 5) проверить выдачу подписки
curl -s https://izinet.online/api/sub/SUBSCRIPTION_ID | base64 -d
```