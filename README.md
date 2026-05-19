# izinet

React + Vite личный кабинет для VPN-подписок с backend на Express, Supabase, 3x-ui, Telegram bot и Enot.io.

## ⚡️ Быстрый старт (One-line Installation)

Если у вас чистый VPS (Ubuntu/Debian), вы можете развернуть весь стэк (izinet + 3x-ui панель) одной командой:

```bash
curl -sSL https://raw.githubusercontent.com/enverphoto/izinet/main/install.sh | bash
```
*Скрипт установит Docker, клонирует репозиторий и попросит ввести ключи Supabase.*

## Текущая архитектура

- Frontend: React 19, Vite, Tailwind, shadcn/base-ui style components.
- Backend: `server.ts` Express monolith.
- Auth/database: Supabase.
- VPN provisioning: 3x-ui API, multi-server table `vpn_servers`.
- Payments: Enot.io new invoice API.
- Deploy: Vercel frontend with `/api/*` proxy to backend `http://YOUR_VPS_IP:3005/api/*`.

## Основные пользовательские потоки

### Пополнение кошелька

1. `/wallet` вызывает `POST /api/pay/create`.
2. Backend создает row в `payments` со статусом `pending`.
3. Backend вызывает `POST https://api.enot.io/invoice/create` с `x-api-key`.
4. Пользователь оплачивает invoice URL от ENOT.
5. ENOT отправляет webhook на `/api/pay/webhook/enot`.
6. Backend проверяет `x-api-sha256-signature`.
7. При `status = success` backend:
   - пополняет `balances`;
   - переводит `payments.status` в `completed`;
   - пишет `transactions` с `type = deposit`.

### Покупка подписки с баланса

1. `/subscription` открывает `SubscriptionWizard`.
2. Wizard читает `balances.amount`.
3. `POST /api/subscription/buy` проверяет JWT и достаточность средств.
4. Backend создает или продлевает клиента в 3x-ui.
5. Backend обновляет `subscriptions.v2ray_config` в JSON-формате.
6. Backend списывает баланс.

## Важные env/settings

Supabase:

```env
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

Enot.io:

```env
ENOT_MERCHANT_ID=shop_id_or_uuid
ENOT_SECRET_KEY=api_key_for_x-api-key
ENOT_SECRET_KEY2=webhook_hmac_key
```

Backend/public:

```env
PUBLIC_URL=https://dev-izinet.vercel.app
PORT=3005
```

3x-ui fallback is optional when `vpn_servers` contains active server credentials:

```env
XUI_HOST=
XUI_USERNAME=
XUI_PASSWORD=
XUI_INBOUND_ID=4
```

## Development

```bash
npm install
npm run dev
```

Checks:

```bash
npm run lint
npm run build
```

## Operational notes

- Vercel does not run the API directly. It proxies `/api/*` to the VPS backend from `vercel.json`.
- After backend code changes, deploy and restart the process on `YOUR_VPS_IP:3005`.
- `fix.md` contains only currently open issues.
- `PAYMENT_SETUP.md` contains the current payment/database setup.
