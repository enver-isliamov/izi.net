# izinet Testing Checklist

Дата актуализации: 2026-05-22

## Backend smoke 

- [x] `GET http://YOUR_VPS_IP:3005/api/locations` возвращает активные серверы.
- [x] `POST /api/pay/create` без `Authorization` возвращает `401`.
- [x] После деплоя текущего `server.ts`: `POST /api/subscription/buy` без `Authorization` возвращает `401`.
- [x] После деплоя текущего `server.ts`: `POST /api/subscription/sync-traffic` без `Authorization` возвращает `401`.
- [x] `GET /api/health` показывает `supabase: true`.

## Payment flow

- [x] Кнопка пополнения больше не должна вести на старый `https://enot.io/checkout?...`.
- [x] Backend использует `POST https://api.enot.io/invoice/create`.
- [x] Пользователь подтвердил, что ENOT-оплата проходит.
- [x] Проверить с реальной сессией: после webhook баланс обновляется на dashboard.
- [x] Проверить row в `payments`: `pending -> completed`.
- [x] Проверить row в `transactions`: создается `type = deposit`.

## Wallet and subscription purchase

- [x] Пополнить баланс тестовым платежом.
- [x] Убедиться, что `/dashboard` показывает новый баланс.
- [x] Открыть `/subscription`, пройти wizard до шага оплаты.
- [x] Убедиться, что wizard видит баланс.
- [x] Купить подписку с баланса.
- [x] Убедиться, что баланс списан.
- [x] Убедиться, что `subscriptions` создана/продлена.
- [x] Убедиться, что VPN config отображается и копируется.

## Device management

- [x] Добавить дополнительное устройство.
- [x] Удалить дополнительное устройство.
- [x] Убедиться, что UI обновился.
- [x] Убедиться, что `subscriptions.v2ray_config` остался JSON.
- [x] Убедиться, что клиент удален из 3x-ui.
- [x] Убедиться, что primary device удалить нельзя.

## Security

- [x] `/api/pay/create` требует JWT.
- [x] После деплоя: `/api/subscription/buy` требует JWT.
- [x] После деплоя: `/api/subscription/sync-traffic` требует JWT.
- [x] Проверить, что пользователь не может купить подписку за другого `userId`.
- [x] Проверить RLS на `balances`, `subscriptions`, `payments`, `transactions`.

## Build

- [x] `npm install`
- [x] `npm run lint`
- [x] `npm run build`

Успешно протестировано и готово к продакшену! Все тесты стабильно зеленые.
