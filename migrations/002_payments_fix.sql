-- =============================================
-- 002: Фикс платежей (PAY-001..006) + безопасное включение RLS
-- Выполнить ОДИН раз в Supabase SQL Editor (Run)
-- Скрипт идемпотентный: повторный запуск ничего не ломает
--
-- Что делает:
--  1. payments: добавляет provider, external_id (их ждёт backend)
--  2. balances: уникальный индекс user_id для ON CONFLICT (upsert)
--  3. RLS на чувствительных таблицах с политиками, ТОЧНО
--     повторяющими реальные операции фронтенда (ничего не ломает):
--     - пользователь видит/меняет только свои данные
--     - админ (role admin/superadmin в users) — полный доступ
--     - settings закрыты для пользователей (там ключи Enot/Cloudflare)
--     - telegram_linking_tokens, support_*, referrals и пр.
--       НЕ трогаем (вход через Telegram вставляет токен ДО авторизации)
-- =============================================

-- ---------- 1. payments: колонки для нового кода ----------
ALTER TABLE payments ADD COLUMN IF NOT EXISTS provider text;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS external_id text;
-- для новых сред: остальные колонки, которые пишет код (в живой БД уже есть)
ALTER TABLE payments ADD COLUMN IF NOT EXISTS completed_at timestamptz;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_link text;

-- ---------- 1b. subscriptions: уникальность user_id ----------
-- upsert с onConflict:'user_id' (buy, TRIAL24) требует unique-индекс.
-- В живой БД он есть (subscriptions_user_id_key), для новых сред создаём.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
    WHERE i.indrelid = 'subscriptions'::regclass
      AND i.indisunique
      AND a.attname = 'user_id'
  ) THEN
    BEGIN
      CREATE UNIQUE INDEX subscriptions_user_id_uidx ON subscriptions(user_id);
    EXCEPTION WHEN unique_violation THEN
      RAISE NOTICE 'subscriptions: найдены дубликаты user_id, индекс пропущен (нужно вручную)';
    END;
  END IF;
END $$;

-- ---------- 2. balances: уникальность user_id ----------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
    WHERE i.indrelid = 'balances'::regclass
      AND i.indisunique
      AND a.attname = 'user_id'
  ) THEN
    BEGIN
      CREATE UNIQUE INDEX balances_user_id_uidx ON balances(user_id);
    EXCEPTION WHEN unique_violation THEN
      RAISE NOTICE 'balances: найдены дубликаты user_id, индекс пропущен (нужно вручную)';
    END;
  END IF;
END $$;

-- ---------- 3. RLS ----------
-- Прокси /api/supabase-proxy после фикса ходит с JWT пользователя,
-- поэтому без RLS любой залогиненный прочитал бы ВСЕ данные (включая ключи).
-- Включаем только на чувствительных таблицах.

-- Guard: на свежих средах (без DDL notification_settings в Supabase.md) не падаем
DO $$
BEGIN
  IF to_regclass('public.notification_settings') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE notification_settings ENABLE ROW LEVEL SECURITY';
  END IF;
END $$;

-- C2: старые политики из Supabase.md §4 могут существовать в живой БД
-- (например "Settings readable by all" FOR SELECT USING (true)) —
-- после включения RLS они бы оставили settings открытыми (OR-семантика).
DROP POLICY IF EXISTS "Settings readable by all" ON settings;
DROP POLICY IF EXISTS "Users see own profile" ON users;
DROP POLICY IF EXISTS "Users see own subscriptions" ON subscriptions;
DROP POLICY IF EXISTS "Users see own balance" ON balances;
DROP POLICY IF EXISTS "Users see own transactions" ON transactions;

ALTER TABLE balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE vpn_servers ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE vpn_routing_rules ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  -- C3: админ = role в users ИЛИ is_admin в profiles (как в серверном adminOnly)
  is_admin text := '(EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN (''admin'',''superadmin'')) OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true))';
BEGIN
  -- --- Пользователь: только свои строки ---

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='balances' AND policyname='own_balance') THEN
    CREATE POLICY own_balance ON balances FOR SELECT USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='subscriptions' AND policyname='own_subscriptions') THEN
    CREATE POLICY own_subscriptions ON subscriptions FOR SELECT USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='transactions' AND policyname='own_transactions') THEN
    CREATE POLICY own_transactions ON transactions FOR SELECT USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='payments' AND policyname='own_payments') THEN
    CREATE POLICY own_payments ON payments FOR SELECT USING (auth.uid() = user_id);
  END IF;

  -- users: чтение своего профиля (Dashboard/Profile/AuthContext) +
  -- изменение ТОЛЬКО referral_code (Referrals.tsx).
  -- Колоночные гранты ниже не дают пользователю менять role/is_pro/balance.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='users' AND policyname='own_users') THEN
    CREATE POLICY own_users ON users FOR SELECT USING (auth.uid() = id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='users' AND policyname='own_users_update') THEN
    CREATE POLICY own_users_update ON users FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
  END IF;

  -- profiles: только своё чтение (is_admin не виден другим; фронтенд
  -- через прокси ничего в profiles не пишет)
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='profiles' AND policyname='own_profiles') THEN
    CREATE POLICY own_profiles ON profiles FOR SELECT USING (auth.uid() = id);
  END IF;

  -- notification_settings: upsert из Profile.tsx (только если таблица существует)
  IF to_regclass('public.notification_settings') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='notification_settings' AND policyname='own_notif_select') THEN
      CREATE POLICY own_notif_select ON notification_settings FOR SELECT USING (auth.uid() = user_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='notification_settings' AND policyname='own_notif_insert') THEN
      CREATE POLICY own_notif_insert ON notification_settings FOR INSERT WITH CHECK (auth.uid() = user_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='notification_settings' AND policyname='own_notif_update') THEN
      CREATE POLICY own_notif_update ON notification_settings FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
    END IF;
  END IF;

  -- vpn_servers: пользователь видит только активные серверы
  -- (Dashboard показывает location_code сервера подписки)
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='vpn_servers' AND policyname='users_active_servers') THEN
    CREATE POLICY users_active_servers ON vpn_servers FOR SELECT USING (is_active = true);
  END IF;
END $$;

-- C1: убираем учётные данные серверов из видимости пользователей
-- (Dashboard читает только location_code; password/username не нужны)
REVOKE SELECT (password, username) ON vpn_servers FROM authenticated, anon;

DO $$
DECLARE
  is_admin text := '(EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN (''admin'',''superadmin'')) OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true))';
BEGIN

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='vpn_servers' AND policyname='admins_vpn_servers') THEN
    EXECUTE format('CREATE POLICY admins_vpn_servers ON vpn_servers FOR ALL USING (%s) WITH CHECK (%s)', is_admin, is_admin);
  END IF;

  -- settings: только админ (внутри ключи Enot/Cloudflare)
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='settings' AND policyname='admins_settings') THEN
    EXECUTE format('CREATE POLICY admins_settings ON settings FOR ALL USING (%s) WITH CHECK (%s)', is_admin, is_admin);
  END IF;

  -- vpn_routing_rules: только админ (страница Admin/Routing.tsx)
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='vpn_routing_rules' AND policyname='admins_routing') THEN
    EXECUTE format('CREATE POLICY admins_routing ON vpn_routing_rules FOR ALL USING (%s) WITH CHECK (%s)', is_admin, is_admin);
  END IF;
END $$;

-- ---------- 3b. notification_settings: unique(user_id) для upsert из Profile.tsx ----------
DO $$
BEGIN
  IF to_regclass('public.notification_settings') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
    WHERE i.indrelid = 'notification_settings'::regclass
      AND i.indisunique
      AND a.attname = 'user_id'
  ) THEN
    BEGIN
      CREATE UNIQUE INDEX notification_settings_user_id_uidx ON notification_settings(user_id);
    EXCEPTION WHEN unique_violation THEN
      RAISE NOTICE 'notification_settings: найдены дубликаты user_id, индекс пропущен (нужно вручную)';
    END;
  END IF;
END $$;

-- ---------- 3c. Hardening: RPC-функции вызывает только сервер (service_role) ----------
REVOKE EXECUTE ON FUNCTION refund_user_balance(uuid, numeric) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION deduct_user_balance(uuid, numeric) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION append_vpn_device(uuid, jsonb) FROM anon, authenticated;

-- ---------- 4. Колоночные права: защита от эскалации ----------
-- Пользователь через прокси может менять у себя только referral_code.
-- role/is_pro/balance и пр. недоступны для UPDATE (только сервер/service_role).
REVOKE UPDATE ON users FROM authenticated, anon;
GRANT UPDATE (referral_code) ON users TO authenticated;

-- ---------- 5. Что намеренно НЕ трогаем ----------
-- telegram_linking_tokens — вход через Telegram вставляет токен ДО авторизации
--   (user_id = null), RLS сломает вход.
-- support_tickets / support_messages — чат поддержки, не секретны.
-- referrals / devices / app_config / partner_applications / tickets —
--   не содержат ключей; поведение не меняем.
