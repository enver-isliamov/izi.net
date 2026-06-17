# BugList — izi.net · Полный реестр багов

> **Версия:** 1.0 · **Составлен:** агрегация из 4 источников (Kimi, Qween, aiStudios, DeepSeek)  
> **Проект:** VPN-сервис с подписочной моделью · **Репозиторий:** github.com/enver-isliamov/izi.net  
> **Стек:** Node.js / Python (Flask) · Express · React/Vite · Supabase / SQLite → PostgreSQL · Docker · Nginx · X-UI (Xray)

---

## Сводная таблица

| ID | Название | Приоритет | Компонент | Срочность |
|----|----------|-----------|-----------|-----------|
| [x] [SEC-001](#sec-001) | SQL-инъекция в поиске admin-панели | 🔴 P0 CRITICAL | `admin.py` | 0–24 ч |
| [x] [SEC-002](#sec-002) | Webhook платежей без проверки подписи | 🔴 P0 CRITICAL | `server.py` | 0–24 ч |
| [SEC-003](#sec-003) | Hardcoded секреты в репозитории | 🔴 P0 CRITICAL | `config.py`, `.env` | 0–24 ч |
| [x] [SEC-004](#sec-004) | adminOnly middleware не проверяет роль | 🔴 P0 CRITICAL | `middleware/auth` | 0–24 ч |
| [SEC-005](#sec-005) | JWT остаётся валидным после смены пароля | 🟠 P1 HIGH | `controllers/auth.js` | 24–48 ч |
| [SEC-006](#sec-006) | XSS в списке пользователей admin-панели | 🟡 P2 MEDIUM | `admin-panel/UsersList.js` | 48–72 ч |
| [x] [CORE-001](#core-001) | Покупка подписки не создаёт VPN-ключ | 🔴 P0 CRITICAL | `subscription/buy` | 0–24 ч |
| [x] [CORE-002](#core-002) | ReferenceError в getInboundLink | 🔴 P0 CRITICAL | `XUIService` | 0–24 ч |
| [x] [CORE-003](#core-003) | checkConfig() не существует в XUIService | 🔴 P0 CRITICAL | `XUIService` | 0–24 ч |
| [x] [CORE-004](#core-004) | Race condition при выдаче конфигов (IP) | 🔴 P0 CRITICAL | `config_manager.py` | 24–48 ч |
| [x] [CORE-005](#core-005) | Race condition при покупке подписки | 🟠 P1 HIGH | `subscription/activate` | 24–48 ч |
| [CORE-006](#core-006) | Race condition при учёте трафика | 🟡 P2 MEDIUM | `middleware/traffic.js` | 48–72 ч |
| [x] [CORE-007](#core-007) | Лимит одновременных сессий не применяется | 🟡 P2 MEDIUM | `configController` | 48–72 ч |
| [x] [DATA-001](#data-001) | Цены тарифов хранятся как float | 🔴 P0 CRITICAL | БД / `tariffs` | 0–24 ч |
| [x] [DATA-002](#data-002) | Трафик не сбрасывается при продлении | 🔴 P0 CRITICAL | `services/subscription.js` | 0–24 ч |
| [DATA-003](#data-003) | Сброс лимитов по локальному времени, не UTC | 🟠 P1 HIGH | `cron/resetTraffic.js` | 24–48 ч |
| [DATA-004](#data-004) | Naive datetime вместо aware (таймзоны) | 🟠 P1 HIGH | `models.py` / `server.py` | 24–48 ч |
| [DATA-005](#data-005) | Cron сброса трафика падает без обработки ошибок | 🟠 P1 HIGH | `cron/resetTraffic.js` | 24–48 ч |
| [DATA-006](#data-006) | Некорректная валидация даты подписки в admin | 🟠 P1 HIGH | `admin.updateSubscription` | 24–48 ч |
| [CACHE-001](#cache-001) | Устаревший конфиг подписки из-за кэша | 🟠 P1 HIGH | Nginx / backend | 24–48 ч |
| [CACHE-002](#cache-002) | Устаревший трафик в дашборде пользователя | 🟢 P3 LOW | `panel/Dashboard.js` | 72+ ч |
| [INFRA-001](#infra-001) | Утечка файловых дескрипторов при генерации ключей | 🟠 P1 HIGH | `wireguard.py` | 48–72 ч |
| [INFRA-002](#infra-002) | Конфиги X-UI не удаляются при деактивации | 🟢 P3 LOW | `subscriptionService.deactivate` | 72+ ч |
| [INFRA-003](#infra-003) | Повреждение конфига при сохранении спецсимволов | 🟡 P2 MEDIUM | Admin → config templates | 48–72 ч |
| [PERF-001](#perf-001) | Нет rate limiting на API | 🟠 P1 HIGH | `server.py` / `app.py` | 24–48 ч |

---

## 🔴 P0 — КРИТИЧЕСКИЕ (блокируют работу / финансовые потери)

---

### SEC-001
**SQL-инъекция в поиске admin-панели**

**Компонент:** `admin.py`  
**CVSS:** 9.8 (CRITICAL)

**Симптом:** Поле поиска пользователей позволяет выполнить произвольный SQL через `UNION SELECT`.

**Как воспроизвести:**
1. Открыть `/admin/users`
2. В поле поиска ввести: `' UNION SELECT * FROM admins --`
3. Получить дамп таблицы администраторов

**Причина:** Прямая конкатенация пользовательского ввода в строку запроса:
```python
query = f"SELECT * FROM users WHERE username LIKE '%{search}%'"
cursor.execute(query)  # ❌
```

---

**✅ КАК ИСПРАВИТЬ:** Параметризованные запросы — единственный правильный способ.
```python
query = "SELECT * FROM users WHERE username LIKE ?"
cursor.execute(query, (f'%{search}%',))  # ✅
```

**❌ КАК НЕЛЬЗЯ ИСПРАВЛЯТЬ:**
- **Фильтрация/экранирование входных данных** (replace, strip, regex) — не защищает. Всегда есть способ обойти ручную фильтрацию через unicode, encoding tricks, вложенные кавычки.
- **Проверка на фронтенде** — фронтенд можно обойти напрямую через curl. Валидация на клиенте не является мерой безопасности.
- **WAF как основное решение** — WAF может быть обходным манёвром, но не заменой параметризации. Он закрывает симптом, а не причину.

---

### SEC-002
**Webhook платежей без проверки подписи**

**Компонент:** `server.py` — обработчик платежей  
**Уровень:** Финансовые потери, активация подписок без оплаты

**Симптом:** Любой POST-запрос с `"status": "success"` активирует подписку без оплаты.

**Как воспроизвести:**
```bash
curl -X POST https://izi.net/webhook/yookassa \
  -H "Content-Type: application/json" \
  -d '{"status":"success","user_id":12345,"months":12}'
# Подписка активирована без платежа!
```

**Причина:** Отсутствует проверка HMAC-подписи провайдера.

---

**✅ КАК ИСПРАВИТЬ:** Проверять подпись через `hmac.compare_digest` до любой бизнес-логики.
```python
import hmac, hashlib

def verify_signature(request_body, signature_header, secret):
    expected = hmac.new(secret.encode(), request_body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature_header):
        raise PermissionError("Invalid webhook signature")
```

**❌ КАК НЕЛЬЗЯ ИСПРАВЛЯТЬ:**
- **Проверять только IP-адрес** — IP можно подделать через заголовки прокси (X-Forwarded-For), а список IP провайдера может меняться.
- **Сравнивать подписи через `==`** — уязвимо к timing attack. Только `hmac.compare_digest`.
- **Логировать и пропускать** — "мы зафиксировали подозрительный запрос" при этом активировав подписку — это не защита.

---

### SEC-003
**Hardcoded секреты в репозитории**

**Компонент:** `config.py`, `.env`, `docker-compose.yml`

**Симптом:** В репозитории хранятся токены бота, ключи платёжных систем, пароли БД. Даже после удаления файла они остаются в истории git.

**Причина:** `.env` с реальными значениями попал в коммит.

---

**✅ КАК ИСПРАВИТЬ:**
1. **Немедленно** — ротировать все скомпрометированные секреты (токен бота, ключи ЮКасса, JWT_SECRET).
2. Перенести все чувствительные значения в переменные окружения без дефолтов:
```python
BOT_TOKEN = os.environ.get('BOT_TOKEN')
assert BOT_TOKEN, "BOT_TOKEN is required — set it as an env variable"
```
3. Добавить `.env` в `.gitignore` и создать `.env.example` с заглушками.
4. Настроить `pre-commit` хук с `git-secrets` или `detect-secrets`.
5. Пройтись по истории через `git log --all -- config.py` и при необходимости выполнить `git filter-branch` или `BFG Repo-Cleaner`.

**❌ КАК НЕЛЬЗЯ ИСПРАВЛЯТЬ:**
- **Просто удалить файл и закоммитить** — файл останется в истории git навсегда. Репозиторий можно клонировать и извлечь старый коммит.
- **Зашифровать секрет прямо в коде** — ключ шифрования тоже нужно где-то хранить; задача не решается таким образом.
- **Сделать репозиторий приватным как "решение"** — утечки внутри команды, форки, случайное открытие — всё это делает "приватность" ненадёжной защитой.

---

### SEC-004
**adminOnly middleware не проверяет роль пользователя**

**Компонент:** `middleware/auth`

**Симптом:** Любой авторизованный пользователь получает доступ к admin-эндпоинтам.

**Причина:** Middleware проверяет наличие токена, но не проверяет поле `role`.

---

**✅ КАК ИСПРАВИТЬ:**
```javascript
function adminOnly(req, res, next) {
  const user = req.user; // Из JWT после верификации
  if (!user || user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}
```

**❌ КАК НЕЛЬЗЯ ИСПРАВЛЯТЬ:**
- **Скрывать кнопки в UI** — клиент не является авторитетом для прав доступа. API должен защищать себя самостоятельно.
- **Проверять роль только в отдельных контроллерах** — при расширении API легко забыть. Централизованный middleware обязателен.

---

### CORE-001
**Покупка подписки не создаёт VPN-ключ**

**Компонент:** `POST /subscription/buy`

**Симптом:** После успешной оплаты пользователь не получает рабочий VPN-конфиг. Эндпоинт содержит заглушку вместо реального provisioning.

**Причина:** Логика создания inbound-клиента в X-UI не реализована — только stub.

---

**✅ КАК ИСПРАВИТЬ:** Реализовать полную цепочку provisioning после подтверждения оплаты:
1. Создать запись в БД (`subscriptions`)
2. Вызвать API X-UI для создания inbound-клиента
3. Сгенерировать ссылку конфигурации
4. Вернуть пользователю готовый конфиг

**❌ КАК НЕЛЬЗЯ ИСПРАВЛЯТЬ:**
- **Оставлять provisioning в webhook** без идемпотентности — при повторном вызове webhook создастся дублирующийся ключ.
- **Создавать ключ до подтверждения оплаты** — пользователь может прервать платёж и получить бесплатный доступ.

---

### CORE-002
**ReferenceError в getInboundLink**

**Компонент:** `XUIService`

**Симптом:** Генерация ссылки падает с `ReferenceError`, роняя весь сервер (uncaught exception в Node.js).

**Причина:** Обращение к несуществующей переменной внутри функции.

---

**✅ КАК ИСПРАВИТЬ:** Исправить ссылку на переменную + обернуть в try/catch:
```javascript
async function getInboundLink(inboundId) {
  try {
    const inbound = await xui.getInbound(inboundId); // было: inboundData (не объявлена)
    return buildLink(inbound);
  } catch (err) {
    logger.error('getInboundLink failed', { inboundId, err });
    throw err;
  }
}
```

**❌ КАК НЕЛЬЗЯ ИСПРАВЛЯТЬ:**
- **Глобальный try/catch на уровне сервера как единственная защита** — это маскирует баг, не устраняет его.
- **Возвращать `null` молча** — клиент получит невалидный конфиг без понимания причины.

---

### CORE-003
**checkConfig() не существует в XUIService**

**Компонент:** `XUIService` — вызывается из maintenance-задачи

**Симптом:** Maintenance-процесс падает с `TypeError: xui.checkConfig is not a function`.

**Причина:** Метод был переименован или удалён из XUIService, но вызов не обновили.

---

**✅ КАК ИСПРАВИТЬ:** Найти актуальный метод в XUIService API, обновить вызов или реализовать обёртку с правильным именем.

**❌ КАК НЕЛЬЗЯ ИСПРАВЛЯТЬ:**
- **Закомментировать вызов** — maintenance не будет выполняться, проблемы накопятся незаметно.

---

### CORE-004
**Race condition при выдаче конфигов — конфликт IP-адресов**

**Компонент:** `config_manager.py`

**Симптом:** При 10+ одновременных запросах нескольким пользователям выдаётся один IP. 9 из 10 получают broken-подписку.

**Причина:** Паттерн read → compute → write без транзакционной блокировки:
```python
last_ip = db.get('SELECT MAX(last_ip) FROM configs')  # Все читают одно
new_ip = increment_ip(last_ip)                          # Все вычисляют одно
db.execute('INSERT INTO configs (ip) VALUES (?)', (new_ip,))  # Все пишут одно ❌
```

---

**✅ КАК ИСПРАВИТЬ:** Атомарный SELECT FOR UPDATE внутри транзакции:
```python
def assign_ip_atomic():
    with db.transaction():
        last_ip = db.get('SELECT last_ip FROM ip_pool FOR UPDATE')
        new_ip = increment_ip(last_ip)
        db.execute('UPDATE ip_pool SET last_ip = ?', (new_ip,))
        db.execute('INSERT INTO configs (ip) VALUES (?)', (new_ip,))
    return new_ip
```
Альтернатива: `AUTO_INCREMENT` / `SERIAL` первичный ключ для IP-пула — БД гарантирует уникальность без ручных блокировок.

**❌ КАК НЕЛЬЗЯ ИСПРАВЛЯТЬ:**
- **Добавить `UNIQUE` constraint как единственную меру** — constraint не предотвращает конфликт, только фиксирует ошибку. Пользователь всё равно получит сбой.
- **Переход на SQLite WAL-mode** — SQLite не поддерживает `SELECT FOR UPDATE`. Для конкурентного доступа нужен PostgreSQL.
- **Application-level lock через глобальную переменную** — не работает при нескольких воркерах/процессах.

---

### DATA-001
**Цены тарифов хранятся как float**

**Компонент:** БД, таблица `tariffs`

**Симптом:** Ошибки округления при оплате. Например, `99.9 * 3 = 299.70000000000003` вместо `299.70`.

**Причина:** Поле цены объявлено как `FLOAT` вместо `INTEGER` (копейки) или `DECIMAL(10,2)`.

---

**✅ КАК ИСПРАВИТЬ:** Хранить цены в минимальных единицах валюты (копейки, центы) как `INTEGER`:
```sql
ALTER TABLE tariffs MODIFY COLUMN price INTEGER NOT NULL; -- цена в копейках
-- 990 = 9.90 руб, 29900 = 299.00 руб
```
Отображение на фронтенде: `price / 100` — только для UI.

**❌ КАК НЕЛЬЗЯ ИСПРАВЛЯТЬ:**
- **Использовать `ROUND()` при каждом вычислении** — это костыль. Ошибка накапливается до округления и может проявиться при агрегации.
- **Использовать `DECIMAL`/`NUMERIC` в SQLite** — SQLite игнорирует тип и всё равно хранит как float. Только INTEGER надёжен в SQLite.
- **Форматировать строкой (`f"{price:.2f}")` в логике оплаты** — форматирование строкой не меняет числовое значение при вычислениях.

---

### DATA-002
**Трафик не сбрасывается при продлении подписки**

**Компонент:** `services/subscription.js` → функция `renewSubscription`

**Симптом:** Пользователь с тарифом 30 ГБ, израсходовавший 20 ГБ, после продления видит только 10 ГБ доступного трафика.

**Причина:** `renewSubscription` обновляет только `expires_at`, поле `used_traffic` остаётся нетронутым.

---

**✅ КАК ИСПРАВИТЬ:**
```javascript
async function renewSubscription(userId, planId) {
  const plan = await getPlan(planId);
  await db.query(
    `UPDATE subscriptions
     SET expires_at = NOW() + INTERVAL '? days',
         used_traffic = 0,               -- ← обязательно сбросить
         total_limit = ?
     WHERE user_id = ?`,
    [plan.duration_days, plan.traffic_limit, userId]
  );
}
```

**❌ КАК НЕЛЬЗЯ ИСПРАВЛЯТЬ:**
- **Сбрасывать трафик отдельным запросом после UPDATE** — риск race condition и частичного обновления при сбое между запросами. Всё в одной транзакции.
- **Сбрасывать трафик через cron задним числом** — к моменту сброса пользователь уже видит неверные данные.

---

## 🟠 P1 — ВЫСОКИЙ ПРИОРИТЕТ (серьёзно влияют на UX и безопасность)

---

### SEC-005
**JWT остаётся валидным после смены пароля**

**Симптом:** Украденный токен продолжает работать после смены пароля.

**Причина:** Нет механизма инвалидации токенов.

---

**✅ КАК ИСПРАВИТЬ:** Один из двух подходов:
- **Token version:** добавить поле `token_version` в таблицу users. При смене пароля инкрементировать. В JWT включать `version`. При верификации — сравнивать с БД.
- **Redis blacklist:** при смене пароля добавлять старый `jti` (JWT ID) в Redis с TTL = оставшееся время жизни токена.

**❌ КАК НЕЛЬЗЯ ИСПРАВЛЯТЬ:**
- **Уменьшить TTL токена до 5 минут** — нарушает UX, но не решает проблему. Атака может быть выполнена и за 5 минут.
- **Хранить все выданные токены в БД и проверять каждый запрос** — O(n) запросов к БД на каждый запрос, убивает производительность. Только Redis.

---

### CORE-005
**Race condition при покупке подписки**

**Симптом:** 5 одновременных запросов на активацию создают 5 подписок, баланс уходит в минус.

---

**✅ КАК ИСПРАВИТЬ:** Транзакция с уровнем изолированности `SERIALIZABLE` + оптимистичная блокировка:
```sql
BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE;
SELECT balance FROM users WHERE id = ? FOR UPDATE;
-- проверить баланс >= цена
UPDATE users SET balance = balance - ? WHERE id = ?;
INSERT INTO subscriptions ...;
COMMIT;
```

**❌ КАК НЕЛЬЗЯ ИСПРАВЛЯТЬ:**
- **Проверка баланса без блокировки строки** — SELECT без FOR UPDATE не предотвращает параллельное списание.
- **Уникальный индекс на `(user_id, status='active')`** — не защищает от двойного списания баланса.

---

### DATA-003 + DATA-004
**Все операции с временем — по UTC**

**Симптомы:**
- Сброс лимитов трафика происходит в разное время для пользователей из разных часовых поясов
- `TypeError` при сравнении naive и aware datetime

**Причина:** `datetime.now()` возвращает naive datetime; разные части кода используют разные таймзоны.

---

**✅ КАК ИСПРАВИТЬ:** Единый стандарт UTC везде:
```python
# Только эта функция — во всём проекте
def utcnow():
    return datetime.now(timezone.utc)

# В БД — всегда TIMESTAMPTZ (PostgreSQL) или текст ISO 8601 с Z (SQLite)
```

**❌ КАК НЕЛЬЗЯ ИСПРАВЛЯТЬ:**
- **Устанавливать `TZ=Europe/Moscow` на сервере** — делает локальное время единым, но не UTC. Проблема вернётся при смене дата-центра или миграции.
- **Конвертировать timezone на фронтенде** — бэкенд обязан хранить UTC; фронтенд только отображает в локальной зоне.

---

### DATA-005
**Cron сброса трафика без обработки ошибок**

**Симптом:** При временном сбое БД cron падает с необработанным исключением. Pm2 не перезапускает задачу. Пользователи на следующий день имеют неверные лимиты.

---

**✅ КАК ИСПРАВИТЬ:**
```javascript
async function resetTraffic() {
  const MAX_RETRIES = 3;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await db.query('UPDATE subscriptions SET used_traffic = 0 WHERE ...');
      logger.info('Traffic reset successful');
      return;
    } catch (err) {
      logger.error(`Attempt ${attempt} failed`, err);
      if (attempt === MAX_RETRIES) {
        await notifyAdmin('CRITICAL: traffic reset failed after 3 attempts', err);
        throw err;
      }
      await sleep(1000 * Math.pow(2, attempt)); // экспоненциальная задержка
    }
  }
}
```

**❌ КАК НЕЛЬЗЯ ИСПРАВЛЯТЬ:**
- **Перезапускать cron чаще** — более частый запуск не решает проблему потери запуска; нужна идемпотентность и retry.
- **Игнорировать ошибку через `catch(() => {})`** — молчаливое поглощение ошибки делает баг невидимым.

---

### DATA-006
**Некорректная дата подписки через admin**

**Симптом:** Администратор может установить дату окончания подписки в прошлом или оставить `NULL`, что ломает проверки во всей системе.

---

**✅ КАК ИСПРАВИТЬ:**
```javascript
// middleware валидации (joi / zod):
const schema = z.object({
  expires_at: z.string().datetime().refine(
    (date) => new Date(date) > new Date(),
    { message: "Expiry date must be in the future" }
  )
});
```

**❌ КАК НЕЛЬЗЯ ИСПРАВЛЯТЬ:**
- **Только фронтенд-валидация** — API вызывается напрямую, минуя UI.
- **DEFAULT '9999-12-31' в БД** — маскирует отсутствие ввода, а не валидирует его.

---

### CACHE-001
**Устаревший конфиг подписки из кэша Nginx**

**Симптом:** После изменения параметров подписки в admin-панели клиент продолжает получать старый конфиг (304 Not Modified).

---

**✅ КАК ИСПРАВИТЬ:** Принудительно отключить кэширование для эндпоинта подписок:
```javascript
// middleware для /api/v1/subscription/:token
res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
res.setHeader('Pragma', 'no-cache');
res.setHeader('Expires', '0');
```
В конфиге Nginx: `proxy_no_cache 1; proxy_cache_bypass 1;` для location подписок.

**❌ КАК НЕЛЬЗЯ ИСПРАВЛЯТЬ:**
- **Менять TTL кэша на 1 минуту** — пользователь всё равно получит устаревший конфиг в течение минуты. Для VPN-конфигов кэш должен быть полностью отключён.
- **Добавлять timestamp в URL** (`/subscription/token?t=123`) — это меняет URL, а не управляет кэшированием. Клиенты VPN используют фиксированный URL из подписки.

---

### PERF-001
**Нет rate limiting на API**

**Симптом:** Перебор промокодов, DoS через генерацию конфигов, перебор user_id — всё это возможно без ограничений.

---

**✅ КАК ИСПРАВИТЬ:**
```python
# Flask-Limiter (Python) или express-rate-limit (Node.js)
from flask_limiter import Limiter

limiter = Limiter(app, key_func=get_remote_address)

@app.route('/api/apply-promo', methods=['POST'])
@limiter.limit("5 per minute")
def apply_promo():
    ...
```
Стратегия: строже на auth и финансовых эндпоинтах (5/min), мягче на read-эндпоинтах (60/min).

**❌ КАК НЕЛЬЗЯ ИСПРАВЛЯТЬ:**
- **Блокировать по IP без заголовков прокси** — за NAT могут сидеть сотни пользователей с одним IP. Нужно комбинировать IP + user_id для авторизованных запросов.
- **Реализовывать rate limiting в БД** — SELECT count(*) на каждый запрос убивает производительность. Только Redis или in-memory с скользящим окном.

---

### INFRA-001
**Утечка файловых дескрипторов при генерации WireGuard-ключей**

**Симптом:** После ~500 генераций в час: `OSError: [Errno 24] Too many open files`. Новые подписки не создаются.

**Причина:** subprocess для `wg genkey` не освобождает дескрипторы корректно.

---

**✅ КАК ИСПРАВИТЬ:** Заменить subprocess на библиотеку PyNaCl — нет форка процесса, нет утечки:
```python
from nacl.public import PrivateKey
import base64

def generate_wg_keys():
    private_key = PrivateKey.generate()
    return (
        base64.b64encode(bytes(private_key)).decode(),
        base64.b64encode(bytes(private_key.public_key)).decode()
    )
```

**❌ КАК НЕЛЬЗЯ ИСПРАВЛЯТЬ:**
- **Увеличить `ulimit -n`** — это откладывает проблему, не устраняет утечку. При высокой нагрузке всё равно закончатся дескрипторы.
- **Перезапускать сервис по расписанию** — костыль, сервис будет недоступен в момент рестарта.

---

## 🟡 P2 — СРЕДНИЙ ПРИОРИТЕТ

---

### SEC-006
**XSS в списке пользователей admin-панели**

**Симптом:** Регистрация с именем `<img src=x onerror=alert(document.cookie)>` выполняет JS в контексте admin-сессии.

**Причина:** Использование `dangerouslySetInnerHTML` в React-компоненте.

---

**✅ КАК ИСПРАВИТЬ:** Убрать `dangerouslySetInnerHTML`. Использовать стандартный React-рендеринг:
```jsx
// ❌
<td dangerouslySetInnerHTML={{ __html: user.name }} />

// ✅
<td>{user.name}</td>  // React автоматически экранирует
```
Дополнительно: санитизация на бэкенде при сохранении (DOMPurify или аналог).

---

### CORE-006
**Race condition при учёте трафика**

**Симптом:** При двух одновременных VPN-подключениях итоговый `used_traffic` меньше реального.

**Причина:** SELECT → вычисление → UPDATE без атомарности.

---

**✅ КАК ИСПРАВИТЬ:** Атомарное обновление:
```sql
UPDATE subscriptions
SET used_traffic = used_traffic + ?   -- атомарная операция
WHERE id = ?
```
Никакого SELECT перед UPDATE.

---

### CORE-007
**Лимит одновременных сессий не применяется**

**Симптом:** Пользователь с лимитом 3 устройства может создать 4-й и более конфигов. Снижение лимита администратором не разрывает активные сессии.

---

**✅ КАК ИСПРАВИТЬ:**
1. Перед созданием конфига: запросить у X-UI текущее количество активных клиентов, сравнить с `tariffs.max_connections`.
2. При изменении лимита: вызвать API X-UI для отключения лишних сессий.

---

### INFRA-003
**Повреждение конфига при сохранении спецсимволов в admin**

**Симптом:** Незакрытые кавычки или кириллица в полях конфигурации ломают JSON/YAML-парсер, делая конфиги недоступными для всех пользователей.

---

**✅ КАК ИСПРАВИТЬ:** Валидация JSON/YAML-схемы перед сохранением:
```javascript
function validateConfigTemplate(template) {
  try {
    JSON.parse(template); // или js-yaml.load(template)
  } catch (e) {
    throw new ValidationError(`Invalid config format: ${e.message}`);
  }
}
```

---

## 🟢 P3 — НИЗКИЙ ПРИОРИТЕТ

---

### CACHE-002
**Устаревший трафик в дашборде пользователя**

**Симптом:** После сброса трафика дашборд показывает старые данные до перезахода.

**Причина:** `useEffect` с пустым массивом зависимостей — данные загружаются только при монтировании.

**✅ Исправление:** Polling каждые 30–60 секунд или React Query с `refetchInterval`.

---

### INFRA-002
**Конфиги X-UI не удаляются при деактивации подписки**

**Симптом:** inbound-клиент в X-UI остаётся активным после деактивации. Порт занят, трафик может учитываться.

**✅ Исправление:** Добавить вызов API X-UI для удаления клиента в `subscriptionService.deactivate`.

---

## Дополнительно: что точно работает

| Компонент | Статус |
|-----------|--------|
| Frontend (React/Vite) — сборка | ✅ |
| Backend (Express) — запуск | ✅ |
| Docker-контейнеры | ✅ |
| Supabase — подключение | ✅ |
| Базовая авторизация | ✅ |
| Admin-панель — отображение | ✅ |

---

## Приоритизированный план исправлений

### Фаза 0 — Немедленно (0–24 часа) · Не деплоить в production до выполнения
1. Ротировать все секреты (BOT_TOKEN, JWT_SECRET, ключи ЮКасса)
2. [x] Закрыть SQL-инъекцию (`SEC-001`)
3. [x] Добавить проверку подписи webhook (`SEC-002`)
4. [x] Исправить adminOnly middleware (`SEC-004`)
5. [x] Привести цены к integer (`DATA-001`)
6. [x] Реализовать provisioning в `/subscription/buy` (`CORE-001`)
7. [x] Исправить ReferenceError в getInboundLink (`CORE-002`)

### Фаза 1 — Неделя 1 · Стабилизация
- [x] ${match.substring(2)} → перейти на PostgreSQL
- [x] ${match.substring(2)} → транзакции SERIALIZABLE
- [x] РЎР±СЂРѕСЃ С‚СЂР°С„РёРєР° РїСЂРё РїСЂРѕРґР»РµРЅРёРё (`DATA-002`)
- Инвалидация JWT (`SEC-005`)
- Rate limiting (`PERF-001`)
- Retry в cron (`DATA-005`)

### Фаза 2 — Неделя 2–3 · Качество
- Все таймзоны → UTC (`DATA-003`, `DATA-004`)
- Кэширование конфигов (`CACHE-001`)
- Утечка дескрипторов (`INFRA-001`)
- XSS (`SEC-006`)
- Валидация конфигов в admin (`INFRA-003`)

### Фаза 3 — Неделя 4 · UX и мониторинг
- Polling трафика в дашборде (`CACHE-002`)
- Удаление конфигов при деактивации (`INFRA-002`)
- Настройка Prometheus + Grafana
- Настройка CI/CD с автотестами

---

## Минимально необходимое тестовое покрытие

| Тип | Что покрывать | Инструменты |
|-----|---------------|-------------|
| Unit | `renewSubscription`, `resetTraffic`, валидаторы, `assign_ip_atomic` | pytest / Jest |
| Integration | Race condition (параллельные запросы), транзакции БД, webhook с подписью | Supertest / pytest-asyncio |
| E2E | Регистрация → оплата → VPN-конфиг → использование → лимит | Playwright / Cypress |
| Security | SQL-инъекции, XSS, перебор промокодов, JWT после смены пароля | OWASP ZAP, Bandit |
| Load | 100 одновременных покупок, 500 параллельных конфигов | k6 |

---

*Реестр агрегирован из анализов: Kimi, Qween, aiStudios, DeepSeek. При конфликте мнений — выбраны наиболее консервативные и безопасные рекомендации.*
