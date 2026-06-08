# 🔧 IZINET — Полный гайд по исправлению VPN и сайта

> **Статус проблем:** Выявлено **9 критических причин** таймаутов Hiddify, недоступности сайта и сломанных подписок  
> **Дата:** Июнь 2026

---

## 📋 Оглавление

1. [Диагноз — что именно сломано и почему](#1-диагноз)
2. [Быстрое исправление текущего сервера (5 команд)](#2-быстрое-исправление-текущего-сервера)
3. [Пошаговый план исправления кода (в репозитории)](#3-исправление-кода-в-репозитории)
4. [Проверка — чеклист после деплоя](#4-чеклист-проверки)
5. [Как сделать "из коробки" работающим](#5-из-коробки-workaround)

---

## 1. Диагноз

### Проблема A — Линейный pricing в `user.ts` сломан (КРИТИЧНО)

**Файл:** `server/src/routes/user.ts`, строки с `periods`

```typescript
{ id: '2m', price: basePrice * 2 * 0.95 },  // НЕ целое число!
{ id: '6m', price: basePrice * 6 * 0.85 },  // float вместо int
```

Цены возвращаются как `190.0`, `510.0` — клиент сравнивает их с балансом через `<`, и если на балансе `190` (int), а цена `190.0` (float), то `190 < 190.0` = `true` → ошибка "Insufficient balance". Покупка не проходит, VPN ключ не генерируется.

---

### Проблема B — `getInboundLink` содержит синтаксическую ошибку (КРИТИЧНО)

**Файл:** `server/src/services/xui.service.ts`, метод `getInboundLink`

```typescript
const isIPOrEmpty = hn === 'localhost' || ...  // переменная isIPOrEmpty НИГДЕ НЕ ОБЪЯВЛЕНА
const sni = tlsSettings.serverName || (isIPOrEmpty ? "" : hostName);  // ReferenceError!
```

`isIPOrEmpty` не определена в этом scope — это приведёт к `ReferenceError` при любом `security=tls` сервере. Кроме того, при Reality ссылка генерируется без проверки что `pbk` не пустой — пустой `pbk` = таймаут в Hiddify.

---

### Проблема C — Fallback-адрес в `xui_bootstrap.py` некорректен для многих конфигураций

**Файл:** `xui_bootstrap.py`

```python
FALLBACKS = [
    {"name": "izinet.online", "dest": "host.docker.internal:3443", ...},
    {"name": "www.izinet.online", "dest": "host.docker.internal:3443", ...},
    {"dest": "host.docker.internal:3443", ...},  # wildcard
]
```

При чистой установке `host.docker.internal:3443` — это Nginx на хосте. Но если Nginx **не запущен** или **не слушает 3443** (а это типичное состояние при первом деплое без дополнительной настройки Nginx), Xray не может сделать fallback → любой браузер получает ошибку соединения на `izinet.online`, а VPN клиенты — таймаут при хэндшейке.

---

### Проблема D — `repair_xui.py` использует жёстко зашитые ключи Reality

**Файл:** `repair_xui.py`

```python
PRIV_KEY = env.get("XUI_REALITY_PRIV_KEY", "ABiVSJTP0fEMzgsHghSAsQJp-bYAJAat0jErpzaGtEo")
PUB_KEY = env.get("XUI_REALITY_PUB_KEY", "CXL0o8BEC7wz-TIuA7w-QBbJIadSsb9xL7G6UB410Xw")
```

Эти ключи **публично известны** (они в открытом репозитории на GitHub). Любой может использовать их для man-in-the-middle или детектирования трафика. Hiddify с актуальными базами может блокировать известные публичные Reality ключи. Кроме того, если `.env` не содержит этих ключей — они берутся из репо, что **не совпадает с тем, что сгенерировал `xui_bootstrap.py`** при первом запуске → клиент получает mismatch ключей → таймаут.

---

### Проблема E — `subscription/buy` в `user.ts` не реализован (заглушка!)

**Файл:** `server/src/routes/user.ts`

```typescript
// 2. Provisioning logic (simplified for out-of-the-box work)
// ... Implementation of provisioning ...
// To keep it simple, I'll return success and deduct balance
```

**МЕТОД ВЕРНЁТ `success: true` НО НЕ СОЗДАСТ VPN КЛЮЧ.** Деньги спишутся, подписка не появится. Это объясняет случаи когда баланс уходит но VPN не работает.

---

### Проблема F — `sniffing` не включён по умолчанию в xui_bootstrap.py для новых inbound

**Файл:** `xui_bootstrap.py`, функция `ensure_default_inbound`

В функции создания дефолтного inbound поле `sniffing` устанавливается корректно. Но функция `patch_inbounds` обновляет уже существующие — и если sniffing там `enabled: false`, то Reality Fallback **не сможет маршрутизировать по SNI**. Без SNI routing все обычные HTTPS запросы к сайту идут мимо — сайт недоступен.

---

### Проблема G — `docker-compose.yml` не монтирует nginx.conf

**Файл:** `docker-compose.yml`

В docker-compose.yml **нет сервиса nginx**. Файл `nginx.conf` присутствует в репо, но не используется ни в одном контейнере. При этом весь код завязан на архитектуру `Xray(443) → Nginx(3443) → App(3005)`, но Nginx-контейнер не поднимается. Системный Nginx на хосте должен быть установлен отдельно — но `install.sh` его **не устанавливает и не настраивает**.

---

### Проблема H — Ссылка подписки `/api/sub/:id` может возвращать пустую строку

**Файл:** `server/src/routes/config.ts`

```typescript
if (!configLines) return res.status(200).send('');
```

Если `v2ray_config` содержит устройства, но ни одна строка не прошла фильтр по `activeSuffices` — вернётся пустая строка с кодом 200. Hiddify интерпретирует это как "пустой профиль" и показывает ошибку импорта. Фильтр по суффиксам `#ServerName` работает только если имена серверов точно совпадают с суффиксами в ссылках — а это не гарантировано.

---

### Проблема I — Таймаут XUI сессии слишком короткий

**Файл:** `server/src/services/xui.service.ts`

```typescript
private readonly SESSION_TTL = 2 * 60 * 1000; // 2 minutes
```

При пике нагрузки (несколько пользователей одновременно покупают/обновляют) логин идёт параллельно на один и тот же сервер, сессия перетирается, и последующие запросы получают 401. Это вызывает cascade failures при синхронизации трафика.

---

## 2. Быстрое исправление текущего сервера

### Шаг 1 — Обновить код и пересобрать

```bash
cd /opt/izinet
git pull
docker compose down
docker compose up -d --build
docker image prune -f
```

### Шаг 2 — Сгенерировать новые Reality ключи (ОБЯЗАТЕЛЬНО)

```bash
# Генерация новой пары ключей x25519
docker exec x3-ui xray x25519

# Вывод будет такого вида:
# Private key: <NEW_PRIVATE_KEY>
# Public key: <NEW_PUBLIC_KEY>
```

**Скопируйте ключи в `.env`:**

```bash
echo "XUI_REALITY_PRIV_KEY=<NEW_PRIVATE_KEY>" >> /opt/izinet/.env
echo "XUI_REALITY_PUB_KEY=<NEW_PUBLIC_KEY>" >> /opt/izinet/.env
```

### Шаг 3 — Применить новые ключи в 3x-ui

```bash
cd /opt/izinet
python3 xui_bootstrap.py --wait-db 5
docker compose restart x3-ui
```

### Шаг 4 — Проверить и починить Nginx на хосте

```bash
# Проверить, есть ли Nginx
nginx -v 2>&1 || apt-get install -y nginx

# Проверить порт 3443
ss -tlnp | grep 3443

# Если 3443 не слушает — скопировать конфиг
cp /opt/izinet/nginx.conf /etc/nginx/sites-available/izinet

# Создать symlink и перезапустить
ln -sf /etc/nginx/sites-available/izinet /etc/nginx/sites-enabled/izinet
nginx -t && systemctl reload nginx
```

### Шаг 5 — Убедиться что UFW разрешает Docker → Host

```bash
# Разрешить соединения из Docker-сети на порт 3443
ufw allow from 172.16.0.0/12 to any port 3443
ufw reload

# Проверить
docker exec x3-ui wget -qO- --no-check-certificate --spider --timeout=5 https://host.docker.internal:3443/
```

---

## 3. Исправление кода в репозитории

### Fix 1 — `server/src/routes/user.ts` — Исправить prices и реализовать provisioning

**Проблема:** Float цены, заглушка вместо реального provisioning.

```typescript
// БЫЛО:
{ id: '2m', price: basePrice * 2 * 0.95 },

// ДОЛЖНО БЫТЬ:
{ id: '2m', label: '2 месяца', days: 60, price: Math.round(basePrice * 2) },
{ id: '6m', label: '6 месяцев', days: 180, price: Math.round(basePrice * 6) },
{ id: '12m', label: '1 год', days: 365, price: Math.round(basePrice * 12) },
```

> ⚠️ Согласно `fix.md` (SYS-17), скидки отключены и цена линейная — убрать все множители скидок (`* 0.95`, `* 0.85`, `* 0.75`).

**Метод `/subscription/buy` должен вызывать реальный XUI provisioning** — переключить на полную реализацию из `server.ts` (вероятно находится там).

---

### Fix 2 — `server/src/services/xui.service.ts` — Исправить `getInboundLink`

**Проблема:** Неопределённая переменная `isIPOrEmpty`, отсутствие проверки пустого `pbk`.

```typescript
// НАЙТИ строку (примерно строка 220):
const sni = tlsSettings.serverName || (isIPOrEmpty ? "" : hostName);

// ЗАМЕНИТЬ НА:
const isIpAddress = /^(\d{1,3}\.){3}\d{1,3}$/.test(hostName);
const sni = tlsSettings.serverName || (isIpAddress ? "" : hostName);
```

**Проверка pbk для Reality:**

```typescript
// Добавить ПЕРЕД генерацией ссылки:
const pbk = process.env.XUI_REALITY_PUB_KEY || rs.publicKey || '';
if (!pbk) {
  throw new Error(`[XUI] Reality public key не найден для сервера ${this.host}. Проверьте XUI_REALITY_PUB_KEY в .env`);
}
```

---

### Fix 3 — `server/src/routes/config.ts` — Исправить фильтрацию конфигов

**Проблема:** При несоответствии суффиксов возвращается пустая строка.

```typescript
// НАЙТИ:
.filter(line => {
  const isExplicitlyInactive = inactiveSuffices.some(...);
  if (isExplicitlyInactive) return false;
  const isActive = activeSuffices.some(...);
  if (isActive) return true;
  return true; // Keep legacy links
})

// ДОБАВИТЬ fallback после фильтра:
if (!configLines) {
  // Если фильтр убил всё — вернуть всё без фильтрации (безопаснее чем пустой ответ)
  const fallbackLines = configText.split('\n')
    .map(l => l.trim())
    .filter(line => line.startsWith('vless://') || line.startsWith('vmess://'))
    .join('\n');
  
  if (!fallbackLines) return res.status(404).send('No valid configs found');
  
  const fallbackBase64 = Buffer.from(fallbackLines).toString('base64');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  return res.send(fallbackBase64);
}
```

---

### Fix 4 — `install.sh` — Добавить установку и настройку Nginx

**Проблема:** Nginx не устанавливается и не настраивается при чистой установке.

Добавить блок **после** `compose_cmd up -d --build` в `install.sh`:

```bash
echo "Configuring system Nginx on port 3443..."

# Установить если нет
if ! command -v nginx >/dev/null 2>&1; then
  need_root_cmd apt-get install -y nginx
fi

# Получить SSL сертификат
if [ ! -f /etc/letsencrypt/live/$DOMAIN/fullchain.pem ]; then
  need_root_cmd apt-get install -y certbot
  # Временно остановить docker чтоб освободить порт 80
  compose_cmd stop x3-ui izinet-app
  need_root_cmd certbot certonly --standalone -d $DOMAIN -d www.$DOMAIN --non-interactive --agree-tos -m admin@$DOMAIN || true
  compose_cmd up -d
fi

# Создать nginx конфиг
cat > /tmp/izinet_nginx.conf << NGINXEOF
events { worker_connections 1024; }
http {
  include /etc/nginx/mime.types;
  server {
    listen 3443 ssl;
    http2 on;
    server_name $DOMAIN www.$DOMAIN;
    ssl_certificate /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;
    location / {
      proxy_pass http://127.0.0.1:3005;
      proxy_set_header Host \$host;
      proxy_set_header X-Real-IP \$remote_addr;
      proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    }
  }
  server {
    listen 80;
    server_name _;
    return 301 https://\$host\$request_uri;
  }
}
NGINXEOF

need_root_cmd cp /tmp/izinet_nginx.conf /etc/nginx/sites-available/izinet
need_root_cmd ln -sf /etc/nginx/sites-available/izinet /etc/nginx/sites-enabled/izinet
need_root_cmd rm -f /etc/nginx/sites-enabled/default

# UFW: разрешить Docker → host:3443
ufw allow from 172.16.0.0/12 to any port 3443 2>/dev/null || true
ufw allow from 192.168.0.0/16 to any port 3443 2>/dev/null || true

need_root_cmd nginx -t && need_root_cmd systemctl reload nginx
echo "✅ Nginx configured on port 3443"
```

---

### Fix 5 — `repair_xui.py` — Убрать hardcoded ключи

**Проблема:** Ключи Reality публичны в репо.

```python
# УДАЛИТЬ дефолтные значения:
# БЫЛО:
PRIV_KEY = env.get("XUI_REALITY_PRIV_KEY", "ABiVSJTP0fEMzgsHghSAsQJp-bYAJAat0jErpzaGtEo")
PUB_KEY = env.get("XUI_REALITY_PUB_KEY", "CXL0o8BEC7wz-TIuA7w-QBbJIadSsb9xL7G6UB410Xw")

# ЗАМЕНИТЬ НА:
PRIV_KEY = env.get("XUI_REALITY_PRIV_KEY", "")
PUB_KEY = env.get("XUI_REALITY_PUB_KEY", "")

# Добавить генерацию если ключей нет:
if not PRIV_KEY or not PUB_KEY:
    print("⚠️  Reality keys not found in .env — generating new pair...")
    PRIV_KEY, PUB_KEY = reality_keypair()
    # Записать в .env для постоянства
    env_path = os.path.join(PROJECT_DIR if 'PROJECT_DIR' in dir() else "/opt/izinet", ".env")
    with open(env_path, "a") as f:
        f.write(f"\nXUI_REALITY_PRIV_KEY={PRIV_KEY}\nXUI_REALITY_PUB_KEY={PUB_KEY}\n")
    print(f"✅ Generated and saved to .env: PUB={PUB_KEY[:20]}...")
```

---

### Fix 6 — `xui.service.ts` — Увеличить SESSION_TTL

```typescript
// БЫЛО:
private readonly SESSION_TTL = 2 * 60 * 1000; // 2 minutes

// СТАЛО:
private readonly SESSION_TTL = 10 * 60 * 1000; // 10 minutes
```

---

### Fix 7 — `docker-compose.yml` — Добавить health check для x3-ui

Добавить в сервис `x3-ui`:

```yaml
x3-ui:
  # ... существующий конфиг ...
  healthcheck:
    test: ["CMD", "wget", "-qO-", "--spider", "http://localhost:2053"]
    interval: 30s
    timeout: 10s
    retries: 3
    start_period: 20s
```

---

## 4. Чеклист проверки

После применения всех фиксов последовательно выполните:

```bash
# 1. Проверить что контейнеры запущены
docker ps

# 2. Проверить логи на ошибки  
docker logs --tail 30 izinet-app
docker logs --tail 30 x3-ui

# 3. Проверить доступность сайта
curl -sk https://izinet.online/ | head -c 200

# 4. Проверить что API работает
curl -sk http://localhost:3005/api/subscription/plans | python3 -m json.tool | head -20

# 5. Проверить fallback работает (сайт через Reality)
curl -sk --resolve izinet.online:443:127.0.0.1 https://izinet.online/ | head -c 100

# 6. Проверить Reality ключи совпадают
docker exec x3-ui sqlite3 /etc/x-ui/x-ui.db \
  "SELECT json_extract(stream_settings, '$.realitySettings.publicKey') FROM inbounds WHERE port=443;"

# Вывод должен совпадать с XUI_REALITY_PUB_KEY в .env:
cat /opt/izinet/.env | grep XUI_REALITY_PUB_KEY

# 7. Проверить что Nginx слушает 3443
ss -tlnp | grep 3443

# 8. Тест fallback из Docker-контейнера
docker exec x3-ui wget -qO- --no-check-certificate --spider \
  --timeout=5 https://host.docker.internal:3443/ && echo "FALLBACK OK" || echo "FALLBACK BROKEN"
```

### Ожидаемые результаты

| Проверка | Ожидаемый результат |
|---|---|
| `docker ps` | izinet-app, x3-ui — `Up` |
| Логи izinet-app | Нет `Error`, `ReferenceError` |
| `curl api/plans` | JSON с periods, deviceLimit |
| Reality pubkey | Совпадает с `.env` |
| `ss grep 3443` | `nginx` или `nginx: worker` |
| Docker→host fallback | `FALLBACK OK` |

---

## 5. Из коробки: Workaround для Cloudflare DNS

Если домен проксирован через Cloudflare (оранжевое облако):

**Это СЛОМАЕТ Reality.** Cloudflare терминирует TLS, Reality клиенты отправляют кастомный TLS ClientHello, который Cloudflare отклоняет.

```
DNS запись A для izinet.online → должна быть СЕРОЕ облако (DNS only)
```

Проверить: `nslookup izinet.online` должен вернуть IP вашего VPS, а не IP Cloudflare (104.x.x.x).

---

## Краткое резюме: Порядок действий прямо сейчас

```
1. git pull + docker compose up -d --build         # обновить код
2. docker exec x3-ui xray x25519                   # сгенерировать ключи  
3. добавить ключи в .env                            # XUI_REALITY_PRIV/PUB_KEY
4. python3 xui_bootstrap.py                        # применить в SQLite
5. apt install nginx + настроить на порт 3443      # починить fallback
6. ufw allow 172.16.0.0/12 to any port 3443        # Docker → host
7. systemctl reload nginx                          # применить
8. docker compose restart x3-ui                    # перезапустить с новыми ключами
9. проверить чеклист выше                          # убедиться что всё работает
```

> 💡 **Главная причина таймаутов Hiddify:** несоответствие Reality public key между `.env` (что использует сервер для генерации ссылок) и тем, что реально прописано в базе x3-ui. Шаги 2–4 это исправляют.

---

*Файл создан для проекта izinet. Все исправления основаны на анализе исходного кода репозитория.*
