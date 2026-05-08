---
name: izinet
description: Use for any work in the izinet VPN subscription service: payments, wallet balance, subscriptions, 3x-ui provisioning, Supabase schema/RLS, Telegram bot, Vercel/VPS deployment, or project documentation.
---

# izinet Project Skill

## Stack

- Frontend: React + Vite + Tailwind.
- Backend: Express monolith in `server.ts`.
- Database/Auth: Supabase.
- VPN provisioning: 3x-ui.
- Payments: Enot.io new invoice API.
- Deploy: Vercel frontend proxies `/api/*` to VPS backend `194.50.94.28:3005`.

## Payment Contract

Use the current ENOT flow only:

1. `POST /api/pay/create`
2. Insert `payments` row with `status = pending`.
3. `POST https://api.enot.io/invoice/create` with `x-api-key`.
4. ENOT webhook hits `/api/pay/webhook/enot`.
5. Verify `x-api-sha256-signature` with HMAC SHA-256.
6. On `status = success`:
   - update `balances.amount`;
   - set `payments.status = completed`;
   - insert `transactions` row with `type = deposit`.

Never use old `https://enot.io/checkout?...` links.

## Database Rules

- `payments` stores invoice/payment lifecycle.
- `transactions` stores successful balance operations.
- `balances.user_id` is unique and should be upserted with `updated_at`.
- `subscriptions.v2ray_config` should be JSON for new device-aware flows.
- Avoid direct client writes for sensitive subscription/device operations; use authenticated API endpoints.

## Subscription Rules

- `POST /api/subscription/buy` must require JWT.
- Check balance server-side before provisioning.
- Create/update 3x-ui client before final subscription update.
- Deduct balance after successful subscription provisioning.
- Do not regenerate VLESS links with fallback `security=none`.
- Device deletion must remove the 3x-ui client and preserve JSON `v2ray_config`.

## Verification Checklist

After payment/subscription changes:

1. Check `/api/pay/create` rejects unauthenticated requests.
2. Check ENOT invoice URL is returned from the API response, not old checkout.
3. Check webhook signature logic.
4. Check balance update.
5. Check subscription purchase from balance.
6. Check VPS backend was redeployed, not only Vercel frontend.

## Documentation Rules

- `fix.md` contains only open bugs.
- Move fixed items out of `fix.md`.
- Keep `PAYMENT_SETUP.md`, `Testing_Checklist.md`, and `README.md` aligned with current code.
