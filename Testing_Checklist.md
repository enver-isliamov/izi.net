# izinet Testing Checklist

Дата актуализации: 2026-05-06

## Backend smoke 

- [x] `GET http://YOUR_VPS_IP:3005/api/locations` возвращает активные серверы.
- [x] `POST /api/pay/create` без `Authorization` возвращает `401`.
- [ ] После деплоя текущего `server.ts`: `POST /api/subscription/buy` без `Authorization` возвращает `401`.
- [ ] После деплоя текущего `server.ts`: `POST /api/subscription/sync-traffic` без `Authorization` возвращает `401`.
- [ ] `GET /api/health` показывает `supabase: true`.

## Payment flow

- [x] Кнопка пополнения больше не должна вести на старый `https://enot.io/checkout?...`.
- [x] Backend использует `POST https://api.enot.io/invoice/create`.
- [x] Пользователь подтвердил, что ENOT-оплата проходит.
- [ ] Проверить с реальной сессией: после webhook баланс обновляется на dashboard.
- [ ] Проверить row в `payments`: `pending -> completed`.
- [ ] Проверить row в `transactions`: создается `type = deposit`.

## Wallet and subscription purchase

- [ ] Пополнить баланс тестовым платежом.
- [ ] Убедиться, что `/dashboard` показывает новый баланс.
- [ ] Открыть `/subscription`, пройти wizard до шага оплаты.
- [ ] Убедиться, что wizard видит баланс.
- [ ] Купить подписку с баланса.
- [ ] Убедиться, что баланс списан.
- [ ] Убедиться, что `subscriptions` создана/продлена.
- [ ] Убедиться, что VPN config отображается и копируется.

## Device management

- [ ] Добавить дополнительное устройство.
- [ ] Удалить дополнительное устройство.
- [ ] Убедиться, что UI обновился.
- [ ] Убедиться, что `subscriptions.v2ray_config` остался JSON.
- [ ] Убедиться, что клиент удален из 3x-ui.
- [ ] Убедиться, что primary device удалить нельзя.

## Security

- [x] `/api/pay/create` требует JWT.
- [ ] После деплоя: `/api/subscription/buy` требует JWT.
- [ ] После деплоя: `/api/subscription/sync-traffic` требует JWT.
- [ ] Проверить, что пользователь не может купить подписку за другого `userId`.
- [ ] Проверить RLS на `balances`, `subscriptions`, `payments`, `transactions`.

## Build

- [ ] `npm install`
- [ ] `npm run lint`
- [ ] `npm run build`

Текущее ограничение: в рабочем окружении Codex нет `npm`, `node_modules` и `git` в PATH, поэтому build/typecheck здесь не запускались.
