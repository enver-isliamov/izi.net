# 🚀 IZINET FIX GUIDE — ПОШАГОВАЯ ИНСТРУКЦИЯ

> **Дата создания:** 08 июня 2026  
> **Источник данных:** Реальный сервер с проблемами (docker logs анализ)  
> **Статус:** Готово к использованию

---

## 📖 ЧТО ЗДЕСЬ?

Полный набор инструментов для исправления IZINET на твоём сервере:

| Файл | Назначение | Запуск |
|------|-----------|--------|
| **00_RUN_ME_FIRST.sh** | 🎯 Главный мастер (меню) | `bash 00_RUN_ME_FIRST.sh` |
| 01_DIAGNOSTIC_SCRIPT.sh | 🔍 Проверить логи и найти ошибку | вызывается из меню |
| 02_FIX_ENV.sh | 📝 Создать правильный `.env` | вызывается из меню |
| 03_FIX_CODE.sh | 🔨 Исправить баги в коде | вызывается из меню |
| 04_REBUILD_DOCKER.sh | 🐳 Пересобрать контейнеры | вызывается из меню |
| 05_FIX_REALITY_KEYS.sh | 🔐 Синхронизировать ключи | вызывается из меню |
| 06_FULL_HEALTH_CHECK.sh | ✅ Проверить систему | вызывается из меню |
| IZINET_FIX_FINAL.md | 📚 Полная документация | для справки |

---

## 🎯 БЫСТРЫЙ СТАРТ (для нетерпеливых)

### Вариант 1️⃣ — АВТОМАТИЧЕСКИЙ (рекомендуется) 👤

```bash
cd /opt/izinet

# Скачай всё
wget -q https://link-to-your-files/00_RUN_ME_FIRST.sh
wget -q https://link-to-your-files/01_DIAGNOSTIC_SCRIPT.sh
wget -q https://link-to-your-files/02_FIX_ENV.sh
wget -q https://link-to-your-files/03_FIX_CODE.sh
wget -q https://link-to-your-files/04_REBUILD_DOCKER.sh
wget -q https://link-to-your-files/05_FIX_REALITY_KEYS.sh
wget -q https://link-to-your-files/06_FULL_HEALTH_CHECK.sh

chmod +x *.sh

# Запусти мастер
bash 00_RUN_ME_FIRST.sh
```

Выбери опцию `[7]` → процесс пойдёт автоматически через все этапы.

### Вариант 2️⃣ — ПОШАГОВЫЙ (для контроля каждого шага) 👤

```bash
# Шаг 1: Посмотреть что сломалось
bash 01_DIAGNOSTIC_SCRIPT.sh | tee diagnostic_report.txt

# Шаг 2: Создать .env (интерактивно)
bash 02_FIX_ENV.sh

# Шаг 3: Проверить код на баги
bash 03_FIX_CODE.sh

# Шаг 4: Пересобрать Docker
bash 04_REBUILD_DOCKER.sh

# Шаг 5: Синхронизировать Reality ключи
bash 05_FIX_REALITY_KEYS.sh

# Шаг 6: Проверить всё
bash 06_FULL_HEALTH_CHECK.sh
```

---

## 📋 ОБЯЗАТЕЛЬНЫЕ ДАННЫЕ ДЛЯ РАБОТЫ 👤

Перед запуском **убедись** что у тебя есть:

### 1️⃣ Supabase (https://supabase.com) 👤

```
Dashboard → Settings → API
```

Скопируй:
- **Project URL** (выглядит как `https://abcdef123456.supabase.co`)
- **Anon Key** (длинная строка, начинается на `eyJhbGc...`)
- **Service Role Key** (ещё длиннее)

### 2️⃣ Telegram Bot (BotFather) 👤

```
@BotFather → /token
```

Скопируй:
- **Bot TOKEN** (выглядит как `123456789:ABCDef...`)
- **Bot username** (без @, просто имя)

### 3️⃣ ENOT.io (платежи) 👤

```
Личный кабинет → Настройки → API
```

Скопируй:
- **Merchant ID** (UUID)
- **Secret Key** (для проверки подписей)
- **Secret Key 2** (дополнительный ключ)

### 4️⃣ 3x-UI панель 👤

```
Текущий пароль (по умолчанию: admin)
```

---

## 🎬 ПОДРОБНЫЙ ПРОЦЕСС

### ЭТАП 1️⃣ — ДИАГНОСТИКА (15 минут)

**Цель:** Найти точную причину почему `izinet-app` крашится

```bash
bash 01_DIAGNOSTIC_SCRIPT.sh > report.txt 2>&1
cat report.txt | head -200
```

**Ищи эти ошибки:**

| Если видишь | Это значит | Решение |
|---|---|---|
| `ReferenceError: isIPOrEmpty is not defined` | Баг в коде | Run Fix 3 |
| `Cannot find module` | Не собран dist | Run Fix 4 |
| `SUPABASE_URL: undefined` | Пустой .env | Run Fix 2 |
| `injected env (0)` | .env не читается | Run Fix 2 |
| `ECONNREFUSED` | Сеть в Docker | Check UFW |
| `SyntaxError` | Синтаксис TypeScript | Manual fix |

---

### ЭТАП 2️⃣ — СОЗДАНИЕ .env (5 минут) 👤

**Цель:** Заполнить все переменные окружения

```bash
bash 02_FIX_ENV.sh
```

Скрипт **интерактивно** попросит:
1. Supabase URL
2. Anon Key
3. Service Role Key
4. Domain
5. Telegram Bot TOKEN
6. 3x-UI пароль
7. ENOT Merchant ID и Secret Keys

**Результат:** Новый файл `/opt/izinet/.env` с 15+ переменными

**Проверка:**
```bash
grep "^[A-Z_]" /opt/izinet/.env | wc -l
# Должно быть 15+
```

---

### ЭТАП 3️⃣ — ИСПРАВЛЕНИЕ КОДА (5 минут) [x]

**Цель:** Исправить известные баги в репозитории

```bash
bash 03_FIX_CODE.sh
```

Скрипт автоматически:
- [x] ✅ Заменит `isIPOrEmpty` на `isIpAddr`
- [x] ⚠️ Предупредит о скидочных множителях в ценах
- [x] 📋 Покажет что нужно исправить вручную

**Если есть ошибки с ценами:**
```bash
# Найди строку с 0.95 / 0.85 / 0.75
grep -n "0.95\|0.85\|0.75" server/src/routes/user.ts

# Замени на Math.round()
nano server/src/routes/user.ts
# БЫЛО: { id: '2m', price: basePrice * 2 * 0.95 }
# СТАЛО: { id: '2m', price: Math.round(basePrice * 2) }
```

---

### ЭТАП 4️⃣ — ПЕРЕСБОРКА DOCKER (10-15 минут)

**Цель:** Собрать новый образ с исправленным кодом и верным .env

```bash
bash 04_REBUILD_DOCKER.sh
```

Это долго (собирает с нуля), но просто жди.

**После завершения:**
```bash
docker ps
# izinet-app должен быть в статусе "Up ..."

docker logs --tail 10 izinet-app
# Должны быть логи инициализации сервера, БЕЗ ошибок
```

**Если всё ещё крашится:**
```bash
docker logs izinet-app 2>&1 | grep -iE "error|cannot|undefined" | head -5
# Свяжись со мной с этим выводом
```

---

### ЭТАП 5️⃣ — СИНХРОНИЗАЦИЯ REALITY КЛЮЧЕЙ (5 минут)

**Цель:** Приватный и публичный ключи совпадали в .env и x3-ui базе

**Проблема:** Если ключи не совпадают → Hiddify таймауты

```bash
bash 05_FIX_REALITY_KEYS.sh
```

Скрипт:
1. Генерирует новые ключи через `xray x25519`
2. Обновляет их в SQLite базе x3-ui
3. Перезагружает x3-ui

**Проверка:**
```bash
sqlite3 /opt/izinet/xui-db/x-ui.db \
  "SELECT json_extract(stream_settings, '$.realitySettings.publicKey') FROM inbounds WHERE port=443;"

# Сравни с:
grep XUI_REALITY_PUB_KEY /opt/izinet/.env

# Должны быть ИДЕНТИЧНЫ
```

---

### ЭТАП 6️⃣ — ПОЛНАЯ ПРОВЕРКА (5 минут)

**Цель:** Убедиться что всё работает

```bash
bash 06_FULL_HEALTH_CHECK.sh
```

**Результаты:**

```
✅ izinet-app работает              → контейнер запущен
✅ x3-ui работает                   → панель VPN работает
✅ API /api/subscription/plans      → можно создавать подписки
✅ Nginx на порту 3443              → фронтенд доступен
✅ Fallback работает                → Docker видит Nginx
✅ Public keys совпадают            → Hiddify не будет таймаутить
✅ .env содержит переменные         → конфиг загружен
✅ Supabase переменные заполнены    → база подключена
✅ Supabase доступна и имеет подписки
```

**Если что-то не зелёное:**

Пункт | Решение
---|---
❌ App не работает | Запусти диагностику снова (шаг 1)
❌ Nginx 502 | App не отвечает на 3005 (проверь логи)
❌ Fallback BROKEN | Nginx слушает на 127.0.0.1 (нужна правка конфига)
❌ Keys не совпадают | Повтори шаг 5 (синхронизацию)
❌ Supabase недоступна | Проверь .env (URL и KEY)

---

## 🧪 ИТОГОВЫЕ ПРОВЕРКИ

### Проверка 1: APP стартует без ошибок

```bash
docker logs izinet-app 2>&1 | grep -c "BOOT\|Server ready\|listening"
# Должен быть результат > 0

docker logs izinet-app 2>&1 | grep -iE "error|cannot|undefined|fatal"
# Должна быть пустая строка (нет ошибок)
```

### Проверка 2: API отвечает

```bash
curl -s http://localhost:3005/api/subscription/plans | python3 -m json.tool | head -20

# Должно быть что-то типа:
# {
#   "periods": [ {"id": "1m", "days": 30, "price": 500}, ... ],
#   "deviceLimit": 2,
#   ...
# }
```

### Проверка 3: Подписка создаётся

```bash
# Получи UUID свежей подписки из Supabase
SUPABASE_URL=$(grep VITE_SUPABASE_URL /opt/izinet/.env | cut -d= -f2)
SERVICE_KEY=$(grep SUPABASE_SERVICE_ROLE_KEY /opt/izinet/.env | cut -d= -f2)

curl -s "$SUPABASE_URL/rest/v1/subscriptions?status=eq.active&limit=1" \
  -H "apikey: $SERVICE_KEY" \
  -H "Authorization: Bearer $SERVICE_KEY"

# Скопируй одного из "id"
SUB_ID="abc123..."

# Тест ссылки подписки
curl -s http://localhost:3005/api/sub/$SUB_ID | head -c 100

# Должна начинаться на: vless://
```

### Проверка 4: Сайт доступен снаружи

```bash
# С другого компьютера или VPS:
curl -sk https://izinet.online/ | head -c 200

# Должно вернуть HTML (не 502)
```

---

## 🔧 РЕШЕНИЕ ТИПИЧНЫХ ПРОБЛЕМ

### ❌ "FALLBACK BROKEN"

**Причина:** Nginx слушает на 127.0.0.1:3443, Docker не может достучаться

**Решение:**
```bash
# Проверь конфиг
grep "listen" /etc/nginx/sites-enabled/izinet

# Если там "listen 127.0.0.1:3443" — исправь:
sed -i 's/listen 127.0.0.1:3443/listen 3443/g' /etc/nginx/sites-enabled/izinet

# Проверь синтаксис
nginx -t

# Перезагрузи
systemctl reload nginx

# Проверь статус
docker exec x3-ui wget -qO- --no-check-certificate --spider \
  --timeout=5 https://host.docker.internal:3443/ && echo "OK" || echo "BROKEN"
```

### ❌ "Hiddify timeout / 404"

**Причина:** Reality ключи не совпадают

**Решение:**
```bash
# Повтори шаг 5
bash 05_FIX_REALITY_KEYS.sh

# Проверь совпадение
DB_PUB=$(sqlite3 /opt/izinet/xui-db/x-ui.db \
  "SELECT json_extract(stream_settings, '$.realitySettings.publicKey') FROM inbounds WHERE port=443 LIMIT 1;")
ENV_PUB=$(grep XUI_REALITY_PUB_KEY /opt/izinet/.env | cut -d= -f2)

if [ "$DB_PUB" = "$ENV_PUB" ]; then echo "✅ OK"; else echo "❌ MISMATCH"; fi
```

### ❌ "Error: SUPABASE_URL undefined"

**Причина:** .env не загружается правильно

**Решение:**
```bash
# Проверь что .env существует
ls -la /opt/izinet/.env

# Проверь что переменные там
grep "VITE_SUPABASE" /opt/izinet/.env

# Пересоздай .env
bash 02_FIX_ENV.sh

# Пересоберись
docker compose down && docker compose up -d --build
```

### ❌ "502 Bad Gateway"

**Причина:** izinet-app не отвечает на 3005

**Решение:**
```bash
# Проверь что app работает
docker ps | grep izinet-app

# Если Restarting — посмотри логи
docker logs izinet-app 2>&1 | tail -50

# Пересоберись с нуля
bash 04_REBUILD_DOCKER.sh

# Если всё ещё не работает — свяжись со мной с логами
```

---

## 📞 ЕСЛИ ЧТО-ТО НЕ РАБОТАЕТ

Выполни и отправь мне:

```bash
# Полная диагностика
bash 01_DIAGNOSTIC_SCRIPT.sh > my_diagnostic_report.txt 2>&1

# Отправь файл
# cat my_diagnostic_report.txt
```

Включи в сообщение:
1. Вывод из диагностики
2. Что именно не работает (подписки? сайт? VPN?)
3. Какие шаги уже проделал

---

## 🎉 УСПЕХ!

Если все пункты в `06_FULL_HEALTH_CHECK.sh` зелёные — **система работает!**

```bash
✅ izinet-app работает
✅ x3-ui работает  
✅ API доступен
✅ Nginx работает
✅ Fallback работает
✅ Reality ключи совпадают
✅ .env заполнен
✅ Supabase подключена
```

Можно:
- 🌐 Использовать сайт (https://izinet.online)
- 💳 Покупать подписки
- 📲 Подключаться к VPN через Hiddify
- 🚀 Развивать проект дальше

---

**Удачи! 🚀**

