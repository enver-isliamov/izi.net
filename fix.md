# fix.md — Аудит багов izinet

> Дата: 2026-05-06  
> Приоритеты: 🔴 Критический | 🟠 Высокий | 🟡 Средний

---

## 🔴 BUG-01: Платёжная система — таблицы `payments` и `transactions` использовались не по схеме

**Файл:** `server.ts` → `POST /api/pay/create`, `handleEnotWebhook()`, `processSuccessfulPaymentForCurrentSchema()`

**Проблема:**
Фактическая схема БД:
- `payments` — pending/completed/failed/refunded инвойсы и платежные ссылки.
- `transactions` — журнал успешных операций баланса (`type = deposit`, `withdrawal`, `referral_bonus`).

Старый код пытался писать pending-платежи в `transactions` и использовать поля, которых в текущей БД нет:
```js
provider
provider_order_id
completed_at
```

**Итог:** создание платежа могло падать на insert/update, а webhook не мог найти платеж по `provider_order_id`.

**Исправление:**
```js
// /api/pay/create
await supabase.from('payments').insert({
  id: paymentId,
  user_id: userId,
  amount,
  currency: 'RUB',
  payment_method: 'enot',
  status: 'pending',
  expires_at
});

// webhook success
await supabase.from('payments').update({
  status: 'completed',
  completed_at: new Date().toISOString()
}).eq('id', orderId);

await supabase.from('transactions').insert({
  user_id: userId,
  amount,
  currency: 'RUB',
  type: 'deposit',
  status: 'completed',
  description: `Balance top-up via enot. Payment ID: ${orderId}`
});
```

---

## 🔴 BUG-02: VPN-конфиг перезаписывается сломанной ссылкой при продлении

**Файл:** `server.ts` → `POST /api/subscription/buy` — ветка "RENEW"

**Проблема:**
```js
// При продлении заменяет рабочую Reality-ссылку на "заглушку":
targetDevice.config = xuiInstance.generateVlessLink(
  targetDevice.uuid, targetDevice.email, domain
);
```
`generateVlessLink()` генерирует `vless://...?security=none` — **без параметров Reality/TLS**.  
Hiddify видит `security=none` и отказывается подключаться.

**Исправление:** При продлении НЕ обновлять `config` — ссылка уже действующая. Обновлять только `expiresAt`:
```js
// Убрать строку с generateVlessLink при продлении
// targetDevice.config остаётся неизменным
```
Если нужно обновить ссылку — использовать `getInboundLink()` (правильный метод с Reality params).

---

## 🔴 BUG-03: Balance upsert — поле `updated_at` должно соответствовать реальной схеме

**Файл:** `server.ts` → `processSuccessfulPaymentForCurrentSchema()`

**Проблема:**
Ранее считалось, что `updated_at` отсутствует в `balances`, но фактическая схема БД содержит это поле:
```js
CREATE TABLE public.balances (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE,
  amount numeric DEFAULT 0.00,
  currency character varying DEFAULT 'RUB',
  updated_at timestamp with time zone DEFAULT now()
);
```

**Итог:** документация/аудит были неактуальны относительно production-схемы.

**Исправление:**
```js
await supabase.from('balances').upsert({
  user_id: userId,
  amount: currentAmount + amount,
  currency: 'RUB',
  updated_at: new Date().toISOString()
}, { onConflict: 'user_id' });
```

---

## 🔴 BUG-04: Telegram бот — регекс для ответа на тикет не совпадает

**Файл:** `server.ts` → `bot.on('text')` и `setupRealtimeListener()`

**Проблема — два разных формата:**

Realtime listener отправляет:
```
ID: ${newTicket.id}
```

Bot handler проверяет:
```js
const match = replyToMsg.text.match(/ID Тикета:\s*([a-f0-9\-]+)/i);
```
`"ID:"` ≠ `"ID Тикета:"` → **regex никогда не совпадает** → ответы администратора не сохраняются в БД.

**Исправление — унифицировать формат:**
```js
// В Realtime listener:
const msg = `...ID Тикета: ${newTicket.id}\n...`;

// В bot.on('text') regex уже правильный — менять не нужно
```

---

## 🟠 BUG-05: XUI сессия истекает быстрее чем 30 минут

**Файл:** `server.ts` → `XUIService`

**Проблема:**
```js
private readonly SESSION_TTL = 30 * 60 * 1000; // 30 минут в коде
```
3x-ui по умолчанию инвалидирует сессии через **5-10 минут** простоя. Результат: после 5 минут без запросов следующий вызов вернёт 401, потребует ре-логина, но `Date.now() - lastLoginTime < SESSION_TTL` ещё `true` → повторный логин не происходит → **все запросы к XUI падают с 401**.

Метод `getInbounds()` обрабатывает 401 и делает re-login:
```js
if (e.response?.status === 401) {
  this.sessionCookie = null;
  await this.login(true);
  return this.getInbounds();
}
```
Но `addClient`, `updateClient`, `getInboundLink`, `deleteClient` — **не имеют этой обработки**. Они просто бросят ошибку.

**Исправление:** Уменьшить TTL до 4 минут и добавить 401-retry в критических методах:
```js
private readonly SESSION_TTL = 4 * 60 * 1000; // 4 минуты
```

---

## 🟠 BUG-06: Traffic sync блокирует Event Loop

**Файл:** `server.ts` → `syncTrafficStats()`

**Проблема:** Функция обходит всех активных пользователей **последовательно** в цикле `for...of`. При 50+ пользователях × 5s timeout = **250+ секунд** блокировки. Railway убивает процесс после ~120 секунд без ответа.

**Исправление:** Параллельный sync с ограничением concurrency:
```js
// Батчевая обработка по 5 пользователей одновременно
const BATCH_SIZE = 5;
for (let i = 0; i < userIds.length; i += BATCH_SIZE) {
  const batch = userIds.slice(i, i + BATCH_SIZE);
  await Promise.allSettled(batch.map(uid => syncUserTraffic(uid)));
}
```

---

## 🟠 BUG-07: Subscription URL нестабильна — зависит от IP бэкенда

**Файл:** `server.ts` → `GET /api/sub-url/:id` и `main.tsx`

**Проблема:**
- Если `PUBLIC_URL` не задан → URL берётся из `req.protocol + req.get('host')`
- На Railway/VPS host = `ip:port` → пользователи сохраняют `http://IP:3005/api/sub/...`
- При смене IP или деплое — **все subscription URLs у всех пользователей ломаются**

**Исправление:** Сделать `PUBLIC_URL` обязательным параметром, проверять при старте:
```js
// В startServer():
if (!process.env.PUBLIC_URL) {
  console.error('⚠️ PUBLIC_URL не задан! Ссылки подписок будут нестабильны.');
}
```
И в `.env.example` — явно документировать как критический параметр.

---

## 🟠 BUG-08: Bot launch race condition

**Файл:** `server.ts` → `launchBot()`

**Проблема:**
```js
botLaunchPromise = null;           // ← модульная переменная сбрасывается
return launchBot(retries - 1);     // ← рекурсивный вызов создаёт НОВЫЙ promise
```
Новый promise не присваивается в `botLaunchPromise`. Если `launchBot()` вызывается ещё раз извне пока идёт ретрай — guard `if (botLaunchPromise) return botLaunchPromise` не сработает → **несколько параллельных launch sequences** → Telegram 409 конфликт.

**Исправление:**
```js
botLaunchPromise = launchBot(retries - 1); // присвоить новый promise
return botLaunchPromise;
```

---

## 🟠 BUG-09: generateVlessLink генерирует невалидные ссылки

**Файл:** `server.ts` → `XUIService.generateVlessLink()`

**Проблема:** Метод генерирует `vless://...?security=none` как fallback в нескольких местах:
- В `addClient()` если XUI не вернул конфиг
- В ветке renewal (BUG-02)

`security=none` — незашифрованный трафик, который:
1. Блокируется провайдерами немедленно  
2. Не работает в Hiddify (требует TLS/Reality)
3. Ключ "работает" но трафик идёт в открытом виде

**Исправление:** `generateVlessLink` должен выбрасывать ошибку а не тихо генерировать нерабочий конфиг:
```js
generateVlessLink(...) {
  throw new Error(`[XUI] Не удалось получить реальный конфиг с сервера для ${email}. Проверьте настройки XUI.`);
}
```

---

## 🟡 BUG-10: Настройки Enot.io не инвалидируются в кэше

**Файл:** `server.ts` → `PaymentService.getEnotConfig()`

**Актуальный статус:** in-memory кэша настроек нет. `PaymentService.getEnotConfig()` читает `settings` при каждом создании инвойса/webhook-проверке и только затем использует ENV fallback.

**Реальная проблема:** диагностика и Admin UI были завязаны на старую терминологию `Merchant ID`, хотя новый ENOT API ожидает `shop_id`. Также второй ключ webhook должен явно пониматься как HMAC SHA-256 secret.

**Исправление:**
- В Admin UI поле переименовано в `Shop ID`.
- Подсказки обновлены: первый ключ используется как `x-api-key`, второй ключ — для HMAC webhook.
- `/api/admin/diag` показывает fallback второго ключа как `FALLBACK_KEY_1`, если отдельный ключ не задан.

**Улучшение на будущее:** добавить тест-запрос к Enot API при сохранении настроек.

---

## 🟡 BUG-11: `maybeSingle()` vs `single()` — некритичные 406 ошибки в логах

**Файл:** Множество мест в server.ts

В нескольких местах используется `.single()` там, где запись может отсутствовать. Это не ломает логику (т.к. data будет null) но **засоряет логи ошибками PGRST116**, усложняя отладку.

**Файлы для замены:**
```
subscriptions...single() → maybeSingle() (где данных может не быть)
balances...single() → maybeSingle()
```

---

## 🟡 BUG-12: Admin /api/admin/servers — таймаут 5 секунд слишком мал для обогащения статистики

**Файл:** `server.ts` → `GET /api/admin/servers`

При загрузке списка серверов запрашивается live-статистика из каждого XUI. Таймаут `Promise.race` = 5 секунд. На медленных серверах — все запросы fail и статистика всегда показывает 0/0/0.

**Исправление:** Разделить: список серверов отдавать сразу, статистику загружать отдельным async endpoint или SSE.

---

## 🔴 BUG-13: Enot.io — старый checkout URL ведёт на 404

**Файл:** `server.ts` → `PaymentService.createEnotInvoice()`, `vercel.json`

**Проблема:**
Кнопка оплаты на `https://dev-izinet.vercel.app/wallet` вызывает:
```txt
/api/pay/create
```

Но по `vercel.json` все API-запросы проксируются на backend:
```json
{
  "source": "/api/:path*",
  "destination": "http://194.50.94.28:3005/api/:path*"
}
```

На backend был развернут старый код, который возвращал ссылку:
```txt
https://enot.io/checkout?m=90851&oa=10&o=order_...
```

Этот старый checkout flow ENOT открывает страницу 404.

**Исправление:**
Backend должен создавать инвойс через новый API ENOT:
```js
await axios.post('https://api.enot.io/invoice/create', {
  amount,
  order_id: paymentId,
  currency: 'RUB',
  shop_id: merchantId,
  custom_fields: JSON.stringify({ user_id: userId }),
  success_url: `${origin}/dashboard`,
  fail_url: `${origin}/wallet`,
  hook_url: `${origin}/api/pay/webhook/enot`,
  expire: 300
}, {
  headers: { 'x-api-key': secretKey }
});
```

**Важно:** после изменения кода нужно деплоить и перезапускать именно backend на `194.50.94.28:3005`, потому что Vercel только проксирует `/api/*`.

**Статус:** ✅ Исправлено и проверено пользователем: оплата работает.

---

## Итоговый план исправлений (приоритет)

| # | Баг | Влияние | Статус |
|---|-----|---------|--------|
| 01 | payments/transactions схема оплаты | Оплата не создаётся или не зачисляется | ✅ Исправлено |
| 02 | VPN конфиг ломается при продлении | Ключи не работают | ✅ Исправлено |
| 03 | Balance upsert updated_at | Аудит не совпадал с production-схемой | ✅ Исправлено |
| 04 | Telegram regex тикет | Поддержка не отвечает в чате | ✅ Исправлено |
| 05 | XUI сессия TTL | Случайные 401 ошибки | ✅ Исправлено |
| 06 | Traffic sync блокировка | Server timeout / restart | ✅ Исправлено |
| 07 | Sub URL нестабильна | Ключи рвутся при деплое | ✅ Исправлено |
| 08 | Bot launch race condition | 409 Telegram конфликт | ✅ Исправлено |
| 09 | generateVlessLink невалид | Тихо сломанные ключи | ✅ Исправлено |
| 10 | Настройки Enot / Shop ID / webhook key | Неверная диагностика и путаница в ключах | ✅ Исправлено |
| 11 | single() vs maybeSingle() | Лишние логи | ✅ Исправлено |
| 12 | Admin stats таймаут | Пустая статистика | ✅ Исправлено |
| 13 | Старый Enot checkout 404 | Невозможно оплатить | ✅ Исправлено |
