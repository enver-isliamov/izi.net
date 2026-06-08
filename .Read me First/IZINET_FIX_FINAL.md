# 🚨 IZINET — ПОЛНЫЙ ПЛАН ИСПРАВЛЕНИЯ (на основе реального лога сервера)

> Дата анализа: 07 июня 2026  
> Источник: вывод `docker ps`, `docker logs`, `curl`, `ss` с реального сервера

---

## 🔴 ДИАГНОЗ: что именно сломано

| # | Симптом из лога | Причина | Приоритет |
|---|---|---|---|
| 1 | `izinet-app` — `Restarting (0) 41 seconds ago` | Краш при старте: TypeScript ошибка в коде | 🔴 КРИТ |
| 2 | `injected env (0) from .env` | dotenvx не читает переменные — в `.env` нет данных или файл повреждён | 🔴 КРИТ |
| 3 | `curl localhost:3005` → пусто | App не стартует → API недоступно | 🔴 КРИТ |
| 4 | `FALLBACK BROKEN` / 502 | Nginx видит 3443, но app на 3005 не отвечает | 🟡 ВТОРИЧНО (следствие #1) |
| 5 | `XUI_REALITY_PUB_KEY=CXL0o8...` | Публичный ключ из репо — известен всем | 🟡 ВАЖНО |
| 6 | `sqlite3 not found` in x3-ui | Нельзя проверить DB через exec | 🟢 НЕКРИТИЧНО |

**Корневая причина всего:** `izinet-app` крашится при старте → всё остальное следствие.

---

## ЭТАП 1 — Найти причину краша izinet-app (делать ПЕРВЫМ)

```bash
# Смотрим полные логи краша — последние 50 строк с момента последнего старта
docker logs izinet-app 2>&1 | tail -50

# Смотрим именно stderr (там TypeScript/Node ошибки)
docker logs izinet-app 2>&1 | grep -E "Error|error|Cannot|cannot|SyntaxError|ReferenceError|TypeError|Module|ENOENT|ECONNREFUSED" | head -20
```

**Что искать в выводе:**

| Текст ошибки | Что это значит | Как чинить |
|---|---|---|
| `ReferenceError: isIPOrEmpty is not defined` | Баг в `xui.service.ts` | → Этап 3, Fix A |
| `Cannot find module` | Не собран dist или нет зависимости | → Этап 2 |
| `SUPABASE_URL` / `VITE_SUPABASE` | Пустые переменные окружения | → Этап 2, Fix ENV |
| `SyntaxError` | Ошибка TypeScript/синтаксиса в коде | → Этап 3 |
| `ECONNREFUSED` к Supabase | DNS или сеть не работает из Docker | → Этап 4 |
| `injected env (0)` | `.env` не читается dotenvx | → Этап 2, Fix ENV |

---

## ЭТАП 2 — Исправить переменные окружения (`.env`)

### Проблема: `injected env (0)`

Это означает что dotenvx прочитал `.env` но не нашёл ни одной переменной. Причины:
- `.env` пустой или содержит только комментарии
- файл в неправильной кодировке (BOM, CRLF)
- переменные зашифрованы dotenvx (`DOTENV_KEY` не задан)

### Проверить содержимое .env:

```bash
# Посмотреть первые 20 строк
head -20 /opt/izinet/.env

# Проверить кодировку и BOM
file /opt/izinet/.env
hexdump -C /opt/izinet/.env | head -3

# Сколько реальных переменных (не комментариев, не пустых строк)
grep -c "^[A-Z]" /opt/izinet/.env
```

### Создать правильный .env с нуля (ЗАМЕНИТЬ существующий):

```bash
# Сгенерировать новые Reality ключи СНАЧАЛА
docker exec x3-ui xray x25519
# Сохранить вывод! Скопировать Private key и Public key

# Создать свежий .env (заменить все значения в <...> на реальные)
cat > /opt/izinet/.env << 'EOF'
# === SUPABASE ===
VITE_SUPABASE_URL=https://ВАША_СТРОКА.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.ВАШ_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.ВАШ_SERVICE_KEY

# === ДОМЕН ===
DOMAIN=izinet.online
PUBLIC_URL=https://izinet.online

# === TELEGRAM BOT ===
TELEGRAM_BOT_TOKEN=ВАШ_ТОКЕН_БОТА
VITE_TELEGRAM_BOT_NAME=ВАШ_БОТ_БЕЗ_СОБАКИ

# === 3X-UI ===
XUI_HOST=http://x3-ui:2053
XUI_USERNAME=admin
XUI_PASSWORD=ВАШ_ПАРОЛЬ_ПАНЕЛИ
XUI_INBOUND_ID=1

# === REALITY KEYS (скопировать из: docker exec x3-ui xray x25519) ===
XUI_REALITY_PRIV_KEY=СГЕНЕРИРОВАННЫЙ_ПРИВАТНЫЙ_КЛЮЧ
XUI_REALITY_PUB_KEY=СГЕНЕРИРОВАННЫЙ_ПУБЛИЧНЫЙ_КЛЮЧ

# === ПЛАТЕЖИ ENOT.IO ===
ENOT_MERCHANT_ID=ВАШ_MERCHANT_UUID
ENOT_SECRET_KEY=ВАШ_SECRET_KEY
ENOT_SECRET_KEY2=ВАШ_SECRET_KEY2

# === СБОРКА VITE (для Docker build args) ===
NODE_ENV=production
IS_DOCKER=true

# === API URL для фронтенда ===
VITE_API_URL=https://izinet.online
EOF

echo "✅ .env создан"
cat /opt/izinet/.env | grep -c "^[A-Z]"
```

> ⚠️ Значения Supabase взять из: Supabase Dashboard → Settings → API

---

## ЭТАП 3 — Исправить код (баги в репозитории)

### Fix A: ReferenceError в `xui.service.ts` (вероятная причина краша)

```bash
# Открыть файл и найти баг
grep -n "isIPOrEmpty" /opt/izinet/server/src/services/xui.service.ts
```

**Если строка найдена — исправить:**

```bash
sed -i 's/(isIPOrEmpty ? "" : hostName)/((\/^(\\d{1,3}\\.){3}\\d{1,3}$\/.test(hostName)) ? "" : hostName)/g' \
  /opt/izinet/server/src/services/xui.service.ts
```

**Или вручную** в файле `server/src/services/xui.service.ts` найти строку (~220):
```typescript
// БЫЛО (СЛОМАНО):
const sni = tlsSettings.serverName || (isIPOrEmpty ? "" : hostName);

// ЗАМЕНИТЬ НА:
const isIpAddr = /^(\d{1,3}\.){3}\d{1,3}$/.test(hostName);
const sni = tlsSettings.serverName || (isIpAddr ? "" : hostName);
```

### Fix B: Проверить `user.ts` — заглушка вместо реальной логики

```bash
grep -n "Implementation of provisioning\|To keep it simple\|simplified for out-of-the-box" \
  /opt/izinet/server/src/routes/user.ts
```

Если нашлось — маршрут `/subscription/buy` не создаёт VPN ключи. Пользователи платят, но ключей не получают. Нужно интегрировать реальный provisioning из основного `server.ts` (если он существует в другой ветке или файле).

### Fix C: Цены подписок (float → integer)

```bash
# Проверить наличие скидочных множителей
grep -n "0.95\|0.85\|0.75" /opt/izinet/server/src/routes/user.ts
```

Если найдено — заменить на округлённые значения:
```typescript
// БЫЛО:
{ id: '2m', price: basePrice * 2 * 0.95 }

// ДОЛЖНО БЫТЬ:
{ id: '2m', label: '2 месяца', days: 60, price: Math.round(basePrice * 2) }
{ id: '6m', label: '6 месяцев', days: 180, price: Math.round(basePrice * 6) }
{ id: '12m', label: '1 год', days: 365, price: Math.round(basePrice * 12) }
```

---

## ЭТАП 4 — Пересобрать и перезапустить app 👤

```bash
cd /opt/izinet

# Полная пересборка с форсированием
docker compose down

# Убедиться что .env правильный
echo "=== Проверка .env ==="
grep "VITE_SUPABASE_URL\|SUPABASE_SERVICE_ROLE\|XUI_HOST" .env

# Сборка с передачей build args
docker compose build --no-cache izinet-app

# Запуск
docker compose up -d

# Ждём 30 секунд и проверяем
sleep 30
docker ps
docker logs --tail 30 izinet-app 2>&1
```

### Проверка что app запустился:

```bash
# App должен отвечать на порту 3005
curl -s http://localhost:3005/api/subscription/plans | head -100

# Должен вернуть JSON с periods и deviceLimit
# Если пусто или error — смотреть логи снова
```

---

## ЭТАП 5 — Исправить Reality ключи в 3x-ui

**Проблема:** Ключ в `.env` = публичный из репо = не совпадает с тем что в базе 3x-ui.

### Шаг 5.1 — Сгенерировать новые ключи

```bash
docker exec x3-ui xray x25519
# Вывод:
# Private key: ABC123...
# Public key: XYZ456...
```

### Шаг 5.2 — Обновить .env

```bash
# Отредактировать .env — заменить строки XUI_REALITY_*
nano /opt/izinet/.env
# Обновить XUI_REALITY_PRIV_KEY и XUI_REALITY_PUB_KEY
```

### Шаг 5.3 — Записать ключи в базу 3x-ui через Python

```bash
python3 << 'PYEOF'
import sqlite3, json, os

DB = "/opt/izinet/xui-db/x-ui.db"
PRIV = os.environ.get("XUI_REALITY_PRIV_KEY", "")
PUB  = os.environ.get("XUI_REALITY_PUB_KEY", "")

if not PRIV or not PUB:
    # Читаем из .env вручную
    with open("/opt/izinet/.env") as f:
        for line in f:
            if line.startswith("XUI_REALITY_PRIV_KEY="):
                PRIV = line.strip().split("=",1)[1]
            if line.startswith("XUI_REALITY_PUB_KEY="):
                PUB = line.strip().split("=",1)[1]

print(f"Using PUB: {PUB[:20]}...")

conn = sqlite3.connect(DB)
c = conn.cursor()
c.execute("SELECT id, stream_settings FROM inbounds WHERE port=443")
rows = c.fetchall()

for iid, ss_raw in rows:
    ss = json.loads(ss_raw or "{}")
    rs = ss.get("realitySettings", {})
    rs["privateKey"] = PRIV
    rs["publicKey"] = PUB
    if "settings" not in rs:
        rs["settings"] = {}
    rs["settings"]["publicKey"] = PUB
    ss["realitySettings"] = rs
    c.execute("UPDATE inbounds SET stream_settings=? WHERE id=?", (json.dumps(ss), iid))
    print(f"✅ Updated inbound {iid} with new keys")

conn.commit()
conn.close()
print("Done!")
PYEOF

# Перезапустить x3-ui чтобы применить
docker compose restart x3-ui
sleep 10
docker logs --tail 5 x3-ui
```

---

## ЭТАП 6 — Починить Nginx (502 → 200)

**Проблема:** Nginx на 3443 даёт 502, потому что app на 3005 не работал. После Этапа 4 должно само починиться.

```bash
# Проверить что app отвечает
curl -s http://localhost:3005/ | head -c 100

# Проверить конфиг Nginx
nginx -t

# Если конфиг норм — перезагрузить
systemctl reload nginx

# Проверить fallback из Docker
docker exec x3-ui wget -qO- --no-check-certificate --spider \
  --timeout=5 https://host.docker.internal:3443/ && echo "✅ FALLBACK OK" || echo "❌ FALLBACK BROKEN"
```

**Если fallback всё ещё BROKEN после запуска app:**

```bash
# Проверить что nginx слушает на всех интерфейсах, не только 127.0.0.1
grep "listen" /etc/nginx/sites-enabled/izinet

# Должно быть: listen 3443 ssl;  (без 127.0.0.1:)
# Если там 127.0.0.1:3443 — Docker не может достучаться

# Исправить:
sed -i 's/listen 127.0.0.1:3443/listen 3443/g' /etc/nginx/sites-enabled/izinet
nginx -t && systemctl reload nginx

# Проверить UFW
ufw status | grep 3443
# Если нет правила:
ufw allow from 172.16.0.0/12 to any port 3443
ufw allow from 192.168.0.0/16 to any port 3443
ufw reload
```

---

## ЭТАП 7 — Проверить работу подписок и Supabase

### 7.1 Проверить подключение к Supabase из app

```bash
docker exec izinet-app wget -qO- \
  "$(grep VITE_SUPABASE_URL /opt/izinet/.env | cut -d= -f2)/rest/v1/vpn_servers?select=id" \
  --header "apikey: $(grep VITE_SUPABASE_ANON_KEY /opt/izinet/.env | cut -d= -f2)" \
  --header "Authorization: Bearer $(grep VITE_SUPABASE_ANON_KEY /opt/izinet/.env | cut -d= -f2)" \
  | head -200
```

**Ожидаемый результат:** JSON массив с серверами. Если пусто — проверить RLS политики.

### 7.2 Проверить API планов

```bash
curl -s http://localhost:3005/api/subscription/plans
# Ожидаемый результат:
# {"periods":[...],"serverTypes":[...],"deviceLimit":2}
```

### 7.3 Проверить ссылку подписки (взять реальный UUID из Supabase)

```bash
# Найти активную подписку в базе (заменить SUPABASE данные)
SUPABASE_URL=$(grep VITE_SUPABASE_URL /opt/izinet/.env | cut -d= -f2)
SERVICE_KEY=$(grep SUPABASE_SERVICE_ROLE_KEY /opt/izinet/.env | cut -d= -f2)

curl -s "$SUPABASE_URL/rest/v1/subscriptions?status=eq.active&select=id,user_id&limit=1" \
  -H "apikey: $SERVICE_KEY" \
  -H "Authorization: Bearer $SERVICE_KEY"
```

```bash
# Проверить что ссылка подписки возвращает base64 данные
SUB_ID="UUID_ИЗ_ПРЕДЫДУЩЕЙ_КОМАНДЫ"
curl -sI http://localhost:3005/api/sub/$SUB_ID
# Должен вернуть: Content-Type: text/plain, код 200
# Тело — base64 строка с vless:// ссылками

curl -s http://localhost:3005/api/sub/$SUB_ID | base64 -d | head -5
# Должно показать: vless://UUID@izinet.online:443?...
```

---

## ЭТАП 8 — Итоговая проверка всего стека

```bash
echo "=== ПОЛНЫЙ HEALTH CHECK ==="

echo ""
echo "1. Docker containers:"
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

echo ""
echo "2. App API (порт 3005):"
curl -s http://localhost:3005/api/subscription/plans | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'✅ Plans OK: {len(d[\"periods\"])} periods, deviceLimit={d[\"deviceLimit\"]}')" 2>/dev/null || echo "❌ App API недоступен"

echo ""
echo "3. Nginx → App (порт 3443):"
curl -sk https://localhost:3443/ -o /dev/null -w "%{http_code}" 2>/dev/null | grep -q "200\|301\|304" && echo "✅ Nginx OK" || echo "❌ Nginx 502"

echo ""
echo "4. Docker → Host fallback:"
docker exec x3-ui wget -qO- --no-check-certificate --spider --timeout=5 \
  https://host.docker.internal:3443/ 2>&1 | grep -q "200\|Remote\|Spider" && echo "✅ Fallback OK" || echo "❌ Fallback BROKEN"

echo ""
echo "5. Reality keys match:"
DB_PUB=$(python3 -c "
import sqlite3, json
conn = sqlite3.connect('/opt/izinet/xui-db/x-ui.db')
row = conn.execute('SELECT stream_settings FROM inbounds WHERE port=443').fetchone()
if row:
    ss = json.loads(row[0])
    print(ss.get('realitySettings',{}).get('publicKey','NOT FOUND')[:20])
" 2>/dev/null)
ENV_PUB=$(grep XUI_REALITY_PUB_KEY /opt/izinet/.env | cut -d= -f2 | head -c 20)
[ "$DB_PUB" = "$ENV_PUB" ] && echo "✅ Keys match: $DB_PUB..." || echo "❌ Keys MISMATCH: DB=$DB_PUB ENV=$ENV_PUB"

echo ""
echo "6. External site access:"
curl -sk https://izinet.online/ -o /dev/null -w "HTTP %{http_code}" 2>/dev/null && echo "" || echo "❌ Сайт недоступен снаружи"

echo ""
echo "=== КОНЕЦ ПРОВЕРКИ ==="
```

---

## Быстрый план действий (последовательность)

```
ПРЯМО СЕЙЧАС:

1. docker logs izinet-app 2>&1 | tail -50
   └→ Найти ТОЧНУЮ ошибку краша → решить по таблице в Этапе 1

2. Проверить .env:
   head -5 /opt/izinet/.env
   └→ Если пустой или "injected env (0)" — создать заново (Этап 2)

3. Исправить код (Этап 3):
   grep -n "isIPOrEmpty" server/src/services/xui.service.ts
   └→ Если найден — исправить

4. Пересобрать:
   docker compose down && docker compose up -d --build
   sleep 30 && docker logs --tail 20 izinet-app 2>&1

5. Сгенерировать новые Reality ключи (Этап 5):
   docker exec x3-ui xray x25519
   └→ Обновить .env и записать в SQLite через Python-скрипт

6. Запустить итоговую проверку (Этап 8)
   └→ Все 6 пунктов должны быть ✅
```

---

## Типичные ошибки и их решения

| Симптом | Решение |
|---|---|
| `izinet-app` Restarting | Смотреть `docker logs izinet-app 2>&1 \| tail -50` |
| `injected env (0)` | Пересоздать `.env` (Этап 2) |
| 502 Bad Gateway | App не запущен → Этап 4 |
| Hiddify таймаут | Reality keys mismatch → Этап 5 |
| Пустая подписка | `v2ray_config` пустой или фильтр убил всё → проверить Этап 7.3 |
| Supabase 401 | Неправильный ANON_KEY или SERVICE_KEY → перепроверить в Supabase Dashboard |
| DNS EAI_AGAIN | Добавить DNS в docker-compose: `dns: [8.8.8.8, 1.1.1.1]` |
 `dns: [8.8.8.8, 1.1.1.1]` |
