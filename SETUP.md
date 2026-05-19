# 🚀 Руководство по настройке izinet Dashboard

> Актуально на 2026-05-06: Vercel обслуживает frontend и проксирует `/api/*` на VPS backend `YOUR_VPS_IP:3005`. Оплата работает через новый ENOT invoice API, а не через старый `enot.io/checkout`. Для точной схемы платежей см. `PAYMENT_SETUP.md`; для открытых проблем см. `fix.md`.

## Шаг 1: Создайте Supabase проект 

1. Перейдите на [supabase.com](https://supabase.com)
2. Нажмите **"Start your project"**
3. Войдите через **GitHub**
4. Создайте новый проект:
   - **Organization:** ваш GitHub аккаунт
   - **Name:** `vpn-dashboard`
   - **Region:** Frankfurt (или ближайшая)
   - **Password:** запомните этот пароль!

5. Дождитесь создания проекта (2-3 минуты)

## Шаг 2: Получите API ключи

1. В Supabase Dashboard перейдите в **Settings → API**
2. Скопируйте следующие значения:

```
Project URL:          https://xxxxx.supabase.co
anon/public key:      eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
service_role key:     eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9... (для админских операций)
```

## Шаг 3: Создайте таблицы в базе данных

Перейдите в **SQL Editor** в Supabase и выполните этот код:

```sql
-- Пользователи
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255),
  name VARCHAR(100),
  telegram_id VARCHAR(100),
  telegram_linked BOOLEAN DEFAULT FALSE,
  email_verified BOOLEAN DEFAULT FALSE,
  referral_code VARCHAR(20) UNIQUE,
  referred_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Баланс
CREATE TABLE balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) UNIQUE,
  amount DECIMAL(10,2) DEFAULT 0.00,
  currency VARCHAR(10) DEFAULT 'RUB'
);

-- Подписки
CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  plan_type VARCHAR(50) DEFAULT 'trial',
  status VARCHAR(20) DEFAULT 'active',
  traffic_limit_mb BIGINT DEFAULT 1073741824,
  traffic_used_mb BIGINT DEFAULT 0,
  device_limit INT DEFAULT 2,
  devices_connected INT DEFAULT 0,
  server_type VARCHAR(20) DEFAULT 'wifi',
  period_months INT DEFAULT 1,
  expires_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Устройства
CREATE TABLE devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  subscription_id UUID REFERENCES subscriptions(id),
  name VARCHAR(100),
  config_link VARCHAR(500),
  last_connected TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Рефералы
CREATE TABLE referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id UUID REFERENCES users(id),
  referee_id UUID REFERENCES users(id),
  commission_earned DECIMAL(10,2) DEFAULT 0,
  status VARCHAR(20) DEFAULT 'registered',
  created_at TIMESTAMP DEFAULT NOW()
);

-- Платежи
CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  amount DECIMAL(10,2),
  currency VARCHAR(10) DEFAULT 'RUB',
  payment_method VARCHAR(50),
  status VARCHAR(20) DEFAULT 'pending',
  payment_link VARCHAR(500),
  expires_at TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Тикеты поддержки
CREATE TABLE tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  subject VARCHAR(255),
  message TEXT,
  status VARCHAR(20) DEFAULT 'open',
  attachment_url VARCHAR(500),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Настройки уведомлений
CREATE TABLE notification_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) UNIQUE,
  subscription_expiry_alert BOOLEAN DEFAULT TRUE,
  subscription_expiry_days INT DEFAULT 3,
  traffic_warning_alert BOOLEAN DEFAULT TRUE,
  traffic_warning_percent INT DEFAULT 80,
  low_balance_alert BOOLEAN DEFAULT TRUE,
  low_balance_threshold DECIMAL(10,2) DEFAULT 100,
  news_alert BOOLEAN DEFAULT TRUE,
  promo_alert BOOLEAN DEFAULT TRUE
);

-- Политики доступа (RLS)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_settings ENABLE ROW LEVEL SECURITY;

-- Пользователи видят только свои данные
CREATE POLICY "users_own_data" ON users FOR SELECT USING (auth.uid() = id);
CREATE POLICY "balances_own_data" ON balances FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "subscriptions_own_data" ON subscriptions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "devices_own_data" ON devices FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "referrals_own_data" ON referrals FOR SELECT USING (auth.uid() = referrer_id);
CREATE POLICY "payments_own_data" ON payments FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "tickets_own_data" ON tickets FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "settings_own_data" ON notification_settings FOR SELECT USING (auth.uid() = user_id);
```

## Шаг 4: Заполните файл .env

Создайте файл `.env` в корне проекта:

```env
VITE_SUPABASE_URL=https://ваш-проект.supabase.co
VITE_SUPABASE_ANON_KEY=ваш-anon-ключ
VITE_SUPABASE_SERVICE_KEY=ваш-service-role-ключ
```

## Шаг 5: Подключитесь к платёжной системе

### Enot.io (Рекомендуется)
1. Зарегистрируйтесь на [enot.io](https://enot.io)
2. Получите API ключи (Merchant ID и Секретные ключи)
3. Добавьте в `.env`:
```env
ENOT_MERCHANT_ID=ваш-merchant-id
ENOT_SECRET_KEY=секрет-1
ENOT_SECRET_KEY2=секрет-2
```

## Шаг 6: Подключите VPN сервер

Ваш сервер: `YOUR_VPS_IP`

Для интеграции с 3x-ui панелью:
1. Войдите в панель 3x-ui
2. Создайте API ключ
3. Добавьте в `.env`:
```env
VITE_VPN_API_URL=http://YOUR_VPS_IP:2053
VITE_VPN_API_PASSWORD=ваш-3x-ui-пароль
```

## Запуск локально

```bash
cd vpn-dashboard
cp .env.example .env
# Заполните .env
pnpm install
pnpm dev
```

## Деплой на Vercel

1. Создайте GitHub репозиторий
2. Подключите к Vercel
3. Добавьте переменные окружения в Vercel Dashboard → Settings → Environment Variables
4. Deploy!

## Шаг 7: Настройка Realtime (Критично для TG-уведомлений)

Для того чтобы сервер мог мгновенно получать уведомления о новых тикетах и сихронизировать данные, необходимо включить Realtime для ключевых таблиц. Выполните этот SQL в Supabase:

```sql
-- Включение Realtime для основных таблиц
ALTER PUBLICATION supabase_realtime ADD TABLE public.subscriptions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.support_tickets;
ALTER PUBLICATION supabase_realtime ADD TABLE public.support_messages;
```

---

## Быстрая проверка

Если вы видите "Mock данные" — значит Supabase не подключён.
После настройки .env файла данные будут реальными.
