# fix.md — Аудит багов izinet

> Дата: 2026-05-06  
> Приоритеты: 🔴 Критический | 🟠 Высокий | 🟡 Средний

---

## 🔴 BUG-01: Платёжная система — неверная проверка дубликата

**Файл:** `server.ts` → `processSuccessfulPayment()`

**Проблема:**
```js
if (tableCheckErr && tableCheckErr.code === 'PGRST116') {
  tableName = 'transactions';
}
```
`PGRST116` = **"No rows returned"** (нет строк), а НЕ "таблица не найдена".  
**Итог:** При КАЖДОМ первом платеже (orderId не существует ещё) → `tableName` переключается на `transactions`.  
Защита от двойной оплаты сломана. Дублирование транзакций возможно.

**Правило:** `payments` таблица создана в SETUP.md, но `POST /api/pay/create` пишет в `transactions`. Нужно стандартизировать на одну таблицу.

**Исправление:**
```js
// Убрать хрупкую логику с двумя таблицами, использовать ТОЛЬКО transactions
const tableName = 'transactions';
const { data: existingTx } = await supabase
  .from(tableName)
  .select('status')
  .eq('provider_order_id', orderId)
  .maybeSingle(); // maybeSingle не бросает ошибку на 0 строк

if (existingTx?.status === 'completed') return;
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

## 🔴 BUG-03: Balance upsert — несуществующее поле `updated_at`

**Файл:** `server.ts` → `processSuccessfulPayment()`

**Проблема:**
```js
await supabase.from('balances').upsert({
  user_id: userId,
  amount: currentAmount + amount,
  updated_at: new Date().toISOString() // ← этого поля нет в схеме SETUP.md!
}, { onConflict: 'user_id' });
```
Supabase вернёт ошибку **"column updated_at does not exist"** → баланс не обновится → пополнение не зачтётся.

**Исправление:**
```js
await supabase.from('balances').upsert({
  user_id: userId,
  amount: currentAmount + amount,
  currency: 'RUB'
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

**Проблема:** Метод запрашивает настройки из БД при каждом вызове — это правильно. Но если настройки только что сохранены через Admin UI, а в памяти ещё остался ENV-fallback — следующий платёж может использовать старые ключи.

Фактически это не критично т.к. нет in-memory кэша настроек. Но нет и валидации что ключи рабочие при сохранении.

**Улучшение:** Добавить тест-запрос к Enot API при сохранении настроек.

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

## Итоговый план исправлений (приоритет)

| # | Баг | Влияние | Статус |
|---|-----|---------|--------|
| 01 | processSuccessfulPayment — PGRST116 | Оплата не зачисляется | ⬜ Fix нужен |
| 02 | VPN конфиг ломается при продлении | Ключи не работают | ⬜ Fix нужен |
| 03 | Balance upsert updated_at | Оплата не зачисляется | ⬜ Fix нужен |
| 04 | Telegram regex тикет | Поддержка не отвечает в чате | ⬜ Fix нужен |
| 05 | XUI сессия TTL | Случайные 401 ошибки | ⬜ Fix нужен |
| 06 | Traffic sync блокировка | Server timeout / restart | ⬜ Fix нужен |
| 07 | Sub URL нестабильна | Ключи рвутся при деплое | ⬜ Fix нужен |
| 08 | Bot launch race condition | 409 Telegram конфликт | ⬜ Fix нужен |
| 09 | generateVlessLink невалид | Тихо сломанные ключи | ⬜ Fix нужен |
| 10 | Настройки кэш | Минорное | ⬜ Улучшение |
| 11 | single() vs maybeSingle() | Лишние логи | ⬜ Улучшение |
| 12 | Admin stats таймаут | Пустая статистика | ⬜ Fix нужен |