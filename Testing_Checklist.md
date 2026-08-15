# izinet Testing Checklist

Дата актуализации: 2026-06-28

## ⚠️ КРИТИЧЕСКОЕ ПРЕДУПРЕЖДЕНИЕ

**НИКОГДА не монтировать volume на `/app/bin/`** — там лежит Xray binary. Volume mount перезаписывает директорию → VPN не работает (`fork/exec bin/xray-linux-amd64: no such file or directory`).

## VPN (Reality VLESS) — КРИТИЧЕСКИЙ

- [x] `realitySettings.publicKey` читается правильно (НЕ settings.publicKey)
- [x] `target = host.docker.internal:3443` (НЕ www.microsoft.com)
- [x] `fingerprint = chrome` (НЕ randomized)
- [x] `serverNames = ['www.microsoft.com', 'microsoft.com']`
- [x] VLESS ссылка содержит правильный pbk (совпадает с Xray config)
- [x] Hiddify подключается без таймаута
- [x] Сайт работает через HTTPS (Let's Encrypt сертификат)
- [x] Fallback: браузер → Nginx (порт 3443) работает

### Как проверить VPN:
```bash
# На сервере:
curl -s http://localhost:3005/api/sub/SUB_ID | base64 -d
# Должна быть vless:// ссылка с pbk=5c63w00dONo3ks5GAOMf5WMsnV1cD2vvLCUpE3Os6xo

# С клиента:
ping vpn.izinet.online        # Должен пинговаться
nslookup vpn.izinet.online    # Должен резолвиться в 194.50.94.28
```

## Backend smoke

- [x] `GET http://YOUR_VPS_IP:3005/api/locations` возвращает активные серверы
- [x] `POST /api/pay/create` без `Authorization` возвращает `401`
- [x] `POST /api/subscription/buy` без `Authorization` возвращает `401`
- [x] `GET /api/health` работает

## Payment flow

- [x] Backend использует `POST https://api.enot.io/invoice/create`
- [x] После webhook баланс обновляется на dashboard
- [x] Row в `payments`: `pending -> completed`
- [x] Row в `transactions`: `type = deposit`

## Wallet and subscription

- [x] Пополнение баланса работает
- [x] Покупка подписки с баланса работает
- [x] VPN config отображается и копируется
- [x] Баланс списан корректно

## Device management

- [x] Добавление устройства работает
- [x] Удаление устройства работает
- [x] `subscriptions.v2ray_config` остаётся JSON
- [x] Клиент удален из 3x-ui

## Build

- [x] `npm install`
- [x] `npm run lint` (tsc --noEmit)
- [x] `npm run build`

## Deploy

- [x] `bash update.sh` на сервере работает
- [x] `docker compose up -d --build` пересобирает контейнер
- [x] `fix_reality_inbound.py` исправляет serverNames, dest, fingerprint
- [x] `patch_xray_routing.py` добавляет routing rules в SQLite

## Диагностика

- [x] `bash diagnose_vpn.sh` — полная диагностика VPN
- [x] `bash diagnose.sh` — общая диагностика сервера
- [x] `bash diagnose_panel.sh` — диагностика панели 3x-ui
