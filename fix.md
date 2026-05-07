# fix.md - открытые баги izinet

Дата актуализации: 2026-05-06

В этом файле остаются только открытые или требующие проверки проблемы. Записи об исправленных багах удалены.

## BUG-01: VPS backend не синхронизирован с локальными security-правками

Статус: открыт до деплоя на `194.50.94.28:3005`.

Проверка live backend показала:

```text
GET  http://194.50.94.28:3005/api/locations -> 200 OK
POST http://194.50.94.28:3005/api/pay/create без Authorization -> 401 OK
POST http://194.50.94.28:3005/api/subscription/sync-traffic без Authorization -> 200, {"success":true,"subscription":null}
POST http://194.50.94.28:3005/api/subscription/buy без Authorization -> 500
```

В локальном коде исправлено:
- `/api/subscription/sync-traffic` требует `Authorization`.
- `/api/subscription/buy` требует `Authorization`.
- списание баланса при покупке обновляет `balances.updated_at`.

Что сделать:
1. Задеплоить текущий `server.ts` на VPS.
2. Перезапустить backend на порту `3005`.
3. Повторить проверки выше. Ожидаемо:

```text
POST /api/subscription/sync-traffic без Authorization -> 401
POST /api/subscription/buy без Authorization -> 401
```

## BUG-02: E2E-проверка оплаты и покупки подписки требует authenticated сессию

Статус: открыт до проверки с реальным пользователем или тестовым auth token.

Что уже подтверждено:
- пользователь подтвердил, что ENOT-оплата проходит;
- `/api/pay/create` без токена на live backend возвращает `401`;
- код создает ENOT invoice через `https://api.enot.io/invoice/create`;
- успешный webhook пополняет `balances`, закрывает `payments` и пишет `transactions type='deposit'`;
- покупка подписки читает `balances.amount`, проверяет достаточность средств и списывает баланс.

Что еще нужно проверить с authenticated сессией:
1. Пользователь пополняет кошелек на `dev-izinet.vercel.app/wallet`.
2. После успешного webhook на dashboard отображается новый баланс.
3. На `/subscription` баланс доступен в wizard.
4. Покупка подписки с баланса создает/продлевает подписку.
5. После покупки баланс уменьшается, подписка и VPN-ключ отображаются.

Ограничение текущей проверки:
- `dev-izinet.vercel.app` закрыт Vercel Deployment Protection.
- Без пользовательской сессии или bypass cookie нельзя выполнить полный browser E2E.

## BUG-03: Удаление дополнительного устройства нужно проверить после деплоя

Статус: локально исправлено, требуется deploy + проверка.

Проблема:
- старый UI удалял устройство прямым `supabase.update`;
- `v2ray_config` мог перезаписаться в legacy string format;
- клиент в 3x-ui не удалялся.

Локальное исправление:
- добавлен `POST /api/subscription/device/delete`;
- endpoint проверяет JWT, запрещает удаление primary device, удаляет клиента из 3x-ui и сохраняет `v2ray_config` как JSON;
- UI вызывает backend endpoint вместо прямого изменения Supabase.

Что проверить после деплоя:
1. Добавить дополнительное устройство.
2. Удалить его из UI.
3. Убедиться, что оно исчезло в UI.
4. Убедиться, что в 3x-ui клиент удален.
5. Убедиться, что основной ключ остался рабочим.

## BUG-04: Проверки TypeScript/build не запускались в текущем окружении

Статус: открыт до запуска в окружении с Node.js/npm.

Причина:
- в рабочей машине `npm` отсутствует в PATH;
- `node_modules` отсутствует;
- `git` отсутствует в PATH.

Что сделать:

```bash
npm install
npm run lint
npm run build
```

После успешного деплоя дополнительно:

```bash
curl http://194.50.94.28:3005/api/health
curl http://194.50.94.28:3005/api/locations
```
