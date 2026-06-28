# izinet

React + Vite личный кабинет для VPN-подписок с backend на Express, Supabase, 3x-ui, Telegram bot и Enot.io.

**Статус:** VPN работает (Reality VLESS), сайт работает, платежи работают.

## Быстрый старт

### Новый сервер:
```bash
curl -sSL https://raw.githubusercontent.com/enver-isliamov/izi.net/main/install.sh | bash
```

### Обновление текущего сервера:
```bash
ssh root@194.50.94.28
cd /opt/izinet && bash update.sh
```

**ВАЖНО:** Не запускать update.sh через SSH из удалённой сессии — сервер имеет 2GB RAM, Docker rebuild вызывает OOM. Использовать Proxmox console.

## Архитектура

```
Порт 443 → Xray (VLESS+Reality) — VPN
  ├─ VPN-клиенты → туннель → интернет
  └─ Браузеры → fallback → host.docker.internal:3443
       → Nginx (SSL Let's Encrypt) → порт 3005 (сайт)

Порт 2053 → 3x-ui Panel (управление)
Порт 3005 → Express backend (API)
Порт 3443 → Nginx (сайт, fallback для Reality)
```

### Стек:
- Frontend: React 19, Vite, Tailwind
- Backend: Express (TypeScript)
- База данных: Supabase (PostgreSQL)
- VPN: 3x-ui + Xray (Reality VLESS)
- Платежи: Enot.io
- Деплой: Docker Compose

## Структура проекта

```
izi.net/
├── server/src/
│   ├── index.ts              — Express сервер, boot
│   ├── routes/
│   │   ├── admin.ts          — Админ API
│   │   ├── user.ts           — User API (покупка, устройства)
│   │   └── config.ts         — /api/sub/:id (VLESS ссылки)
│   ├── services/
│   │   ├── xui.service.ts    — X-UI API клиент
│   │   ├── maintenance.service.ts — Фоновые задачи
│   │   ├── routing.service.ts — Routing sync
│   │   └── supabase.ts       — Supabase клиент
│   └── scripts/
│       ├── fix_reality_inbound.py — Исправление Reality настроек
│       ├── patch_xray_routing.py  — Патчинг routing в SQLite
│       └── setup_supabase.py      — Авто-настройка Supabase
├── src/                      — React frontend
├── xui_bootstrap.py          — Генерация Reality ключей
├── install.sh                — Установка на новый сервер
├── update.sh                 — Обновление на текущем сервере
├── add_reality_ws.sh         — Создание Reality+WS inbound
├── docker-compose.yml        — Docker конфигурация
├── Supabase.md               — SQL для новой базы
├── BUGS_FIX_PLAN.md          — Исправленные баги
└── fix.md                    — История исправлений
```

## Reality VPN конфигурация

### Ключевые параметры (рабочие):
```
publicKey: 5c63w00dONo3ks5GAOMf5WMsnV1cD2vvLCUpE3Os6xo
privateKey: kJ2F0HSQBw2hNydpwjCcmYoX5wgxbk0-zW2zr5PP630
serverNames: ['www.microsoft.com', 'microsoft.com']
fingerprint: chrome
target: host.docker.internal:3443
flow: xtls-rprx-vision
```

### Критические правила:
1. **publicKey**: читать `realitySettings.publicKey`, НЕ `realitySettings.settings.publicKey`
2. **target**: ДОЛЖЕН быть `host.docker.internal:3443`, НЕ `www.microsoft.com:443`
3. **fingerprint**: только `chrome`/`firefox` (НЕ `randomized`)
4. **serverNames**: должны совпадать с SNI клиентов

## Деплой

### update.sh (текущий сервер):
```bash
cd /opt/izinet && bash update.sh
```
Делает: git pull → docker rebuild → xui_bootstrap.py → fix_reality_inbound.py → patch_xray_routing.py → restart

### install.sh (новый сервер):
```bash
bash install.sh
```
Делает: Docker → Nginx → SSL → xui_bootstrap.py → fix_reality_inbound.py → setup_supabase.py

## Окружение

### .env (минимальный набор):
```env
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
TELEGRAM_BOT_TOKEN=
TELEGRAM_ADMIN_ID=
ENOT_MERCHANT_ID=
ENOT_SECRET_KEY=
PUBLIC_URL=https://izinet.online
```

**ВАЖНО:** XUI_HOST, XUI_USERNAME, XUI_PASSWORD, XUI_INBOUND_ID — НЕ используются. Все настройки берутся из Supabase `vpn_servers`.

## Диагностика

```bash
# На сервере:
cd /opt/izinet && bash diagnose_vpn.sh   # Полная диагностика VPN
cd /opt/izinet && bash diagnose.sh       # Общая диагностика

# Проверка VLESS ссылки:
curl -s http://localhost:3005/api/sub/SUBSCRIPTION_ID | base64 -d
```

## Development

```bash
npm install
npm run dev      # Dev server
npm run build    # Production build
npm run lint     # TypeScript check (tsc --noEmit)
```
