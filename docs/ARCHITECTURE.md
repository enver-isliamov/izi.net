# 🏗 АРХИТЕКТУРА СИСТЕМЫ И ИНФРАСТРУКТУРА IZINET

> ⚠️ **КРИТИЧЕСКИЙ ДОКУМЕНТ ДЛЯ ВСЕХ AI-АГЕНТОВ И РАЗРАБОТЧИКОВ**
> VLESS-Reality и Hysteria2 — ядро сервиса. Они **НИКОГДА** не должны ломаться при обновлениях, перезагрузках или миграциях.

---

## 🌐 1. СЕТЕВАЯ ТОПОЛОГИЯ И МАРШРУТИЗАЦИЯ ТРАФИКА

### Схема входящих соединений на VPS:
```text
               ┌─────────────────── ВХОДЯЩИЙ ИНТЕРНЕТ ТРАФИК ───────────────────┐
               │                                                                │
               ▼ (Порт 443 / TCP)                                               ▼ (Порт 443 / UDP)
    ┌───────────────────────────┐                                    ┌─────────────────────┐
    │     Xray Core (3x-ui)     │                                    │      Hysteria 2     │
    │      VLESS + REALITY      │                                    │      (QUIC / UDP)   │
    └─────────────┬─────────────┘                                    └──────────┬──────────┘
                  │                                                             │
      ┌───────────┴───────────────────────┐                                     │
      ▼ (VPN Клиенты)                     ▼ (Обычный веб / non-Reality)         │
┌───────────────┐               ┌─────────────────────────────────┐             │
│   Интернет    │               │ Fallback: host.docker.internal  │             │
│  (Туннель)    │               │           Порт 3443             │             │
└───────────────┘               └────────────────┬────────────────┘             │
                                                 │                              │
                                                 ▼                              ▼
                                 ┌───────────────────────────────┐      ┌───────────────┐
                                 │       Nginx Reverse Proxy     │      │   Интернет    │
                                 │     (SSL Let's Encrypt 3443)  │      │  (Туннель)    │
                                 └───────────────┬───────────────┘      └───────────────┘
                                                 │
                                                 ▼ (Порт 3000 / 3005)
                                 ┌───────────────────────────────┐
                                 │   izinet Node.js / Express    │
                                 │     Web App + Telegram Bot    │
                                 └───────────────┬───────────────┘
                                                 │
                                                 ▼
                                 ┌───────────────────────────────┐
                                 │    Supabase Cloud Database    │
                                 │       (PostgreSQL Auth)       │
                                 └───────────────────────────────┘
```

---

## 🛡️ 2. ЗОЛОТЫЕ ПРАВИЛА VLESS-REALITY (СТРОГИЙ ЗАПРЕТ НА НАРУШЕНИЕ)

1. **Reality ключи хранятся ТОЛЬКО в SQLite 3x-ui (`x-ui.db`)**:
   - Никаких Reality ключей в `.env` или в Supabase.
   - Сервер всегда читает актуальный публичный ключ через API 3x-ui: `realitySettings.publicKey` (не из устаревшего поля `realitySettings.settings.publicKey`).
2. **Reality fallback (Target) ОБЯЗАН быть `host.docker.internal:3443`**:
   - Запрещено ставить `target: www.microsoft.com:443` — это ломает доступ к сайту без VPN.
   - Nginx слушает порт **3443**, а порт **443** всегда принадлежит Xray.
3. **Fingerprint**:
   - Только `chrome` или `firefox`. Значение `randomized` несовместимо с Reality.
4. **Volume mount**:
   - Запрещено монтировать volumes на `/app/bin/` — это удаляет бинарник `xray-linux-amd64`.
5. **Провижининг клиентов (addClient)**:
   - В актуальных версиях 3x-ui эндпоинт `/panel/api/inbounds/addClient` может возвращать 404.
   - Всегда используется гарантированный fallback `addClientViaFullUpdate` (через `/panel/api/inbounds/update/:id`).
   - Поле `tgId` должно быть числом (`0`), а не строкой.

---

## ⚡ 3. ЗОЛОТЫЕ ПРАВИЛА HYSTERIA 2

1. **Протокол и Порты**:
   - Hysteria2 работает поверх **UDP** на порту 443 (или выделенном UDP-порте, например, 8443/custom).
   - UFW на VPS **ОБЯЗАН** иметь разрешающее правило: `ufw allow 443/udp` (а также диапазон портов Hysteria hop, если включен).
2. **Пароли и Аутентификация**:
   - Пароли клиентов синхронизируются через конфигурационный файл Hysteria `/etc/hysteria/config.yaml` или API-сервис.
   - При смене мастер-пароля в админке вызывается горячая перезагрузка сервиса без остановки трафика (`systemctl reload hysteria-server` или рестарт через сервис).
3. **Сертификаты**:
   - Hysteria использует те же валидные Let's Encrypt сертификаты из `/etc/letsencrypt/live/domain/` или self-signed с `insecure: true` (в зависимости от режима ноды).

---

## 🔌 4. ПРАВИЛА ПОРТОВ ВЕБ-СЕРВЕРА И NGINX (ПРЕДОТВРАЩЕНИЕ 502 BAD GATEWAY)

1. **Порты Express Web App**:
   - На боевом VPS в Docker Express обязан слушать **порт 3005** (`docker-compose.yml` пробрасывает `3005:3005`).
   - Nginx на хосте настроен на `proxy_pass http://127.0.0.1:3005;`.
   - В среде разработки AI Studio Express слушает **порт 3000**.
2. **Строгий запрет**:
   - Запрещено жестко писать `const PORT = 3000;` в `server/src/index.ts`.
   - Порт обязан определяться динамически:
     `const PORT = Number(process.env.PORT) || (process.env.NODE_ENV === 'production' || process.env.IS_DOCKER ? 3005 : 3000);`
   - Если сервер запустится на порту 3000 в Docker, Nginx не сможет до него достучаться на 3005 и выдаст ошибку **502 Bad Gateway**.

---

## 🔄 5. ПРОТОКОЛ БЕЗОПАСНОГО ОБНОВЛЕНИЯ (SAFE UPDATE WORKFLOW)

Перед накатом обновлений на VPS (`update.sh` или ручной `git pull`) агенты и администраторы обязаны соблюдать следующий регламент:

```bash
# 1. Проверка синтаксиса и сборки ДО деплоя:
npm run lint && npm run build

# 2. Накат на сервере без перезаписи базы данных SQLite 3x-ui:
git pull
docker compose down
docker compose up -d --build

# 3. Валидация работоспособности (Smoke Test):
curl -s http://localhost:3005/api/health
curl -k -I https://127.0.0.1:3443/

# 4. Проверка выдачи конфигураций VLESS и Hysteria2:
# Ссылка подписки должна отдавать рабочий Base64 с vless:// и hysteria2://
```

---

## 📋 6. ТАБЛИЦА СОВМЕСТИМОСТИ И ДИАГНОСТИКИ

| Симптом | Корневая причина | Решение |
| :--- | :--- | :--- |
| **502 Bad Gateway на сайте** | Express слушает порт 3000 вместо 3005 в Docker | Проверить `server/src/index.ts`: `PORT` должен быть 3005 при `IS_DOCKER` / `NODE_ENV=production` |
| **VLESS не подключается (TLS Handshake error)** | Истёк SSL сертификат домена или сбился SNI | `certbot renew && systemctl reload nginx`, проверить `sni` в ссылке |
| **VLESS: 404 при добавлении клиента** | 3x-ui API не имеет метода `addClient` | Срабатывает fallback `addClientViaFullUpdate` в `xui.service.ts` |
| **Сайт недоступен, но VPN работает** | Xray target не указывает на `host.docker.internal:3443` | Запустить `python3 server/src/scripts/fix_reality_inbound.py` |
| **Hysteria2 не подключается** | Закрыт UDP порт в UFW или конфликт портов | Выполнить `ufw allow 443/udp` и проверить `systemctl status hysteria-server` |
| **`inbound_id = 0` у сервера** | Сервер создан без привязки к конкретному инбаунду | Сервер автоматически ищет reality inbound на 443 порту |
