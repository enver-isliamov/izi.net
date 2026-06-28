# Supabase — полная настройка базы данных для izi.net

Скопируй ВЕСЬ этот файл и выполни одним разом в Supabase SQL Editor (https://supabase.com/dashboard → SQL Editor → New query → Paste → Run).

---

## 1. Таблицы

```sql
-- =============================================
-- IZINET DATABASE SETUP
-- Выполнить ОДИН раз в Supabase SQL Editor
-- =============================================

-- 1. USERS (через Supabase Auth, но добавляем доп. поля)
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  role text DEFAULT 'user',
  is_pro boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 2. PROFILES (для admin check)
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  is_admin boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- 3. SETTINGS (key-value)
CREATE TABLE IF NOT EXISTS settings (
  key text PRIMARY KEY,
  value text,
  updated_at timestamptz DEFAULT now()
);

-- 4. VPN SERVERS
CREATE TABLE IF NOT EXISTS vpn_servers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  ip text,
  domain text,
  api_port integer DEFAULT 2053,
  username text DEFAULT 'oja',
  password text DEFAULT 'sireyra',
  location_code text DEFAULT 'DE',
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  -- Новые поля (миграция 001)
  public_host text,
  inbound_id integer DEFAULT 0,
  vpn_port integer DEFAULT 443,
  reality_sni text,
  health_status text DEFAULT 'unknown',
  last_health_check_at timestamptz,
  panel_path text DEFAULT '/'
);

-- 5. SUBSCRIPTIONS
CREATE TABLE IF NOT EXISTS subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  status text DEFAULT 'active',
  plan_type text,
  expires_at timestamptz,
  v2ray_config text,
  traffic_limit_mb integer DEFAULT 102400,
  traffic_used_mb integer DEFAULT 0,
  device_limit integer DEFAULT 2,
  server_id uuid REFERENCES vpn_servers(id),
  server_type text DEFAULT 'wifi',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 6. BALANCES
CREATE TABLE IF NOT EXISTS balances (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  amount numeric DEFAULT 0,
  currency text DEFAULT 'RUB',
  updated_at timestamptz DEFAULT now()
);

-- 7. TRANSACTIONS
CREATE TABLE IF NOT EXISTS transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  amount numeric NOT NULL,
  currency text DEFAULT 'RUB',
  type text NOT NULL,
  status text DEFAULT 'pending',
  description text,
  created_at timestamptz DEFAULT now()
);

-- 8. PAYMENTS
CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  amount numeric NOT NULL,
  currency text DEFAULT 'RUB',
  status text DEFAULT 'pending',
  payment_method text,
  external_id text,
  metadata jsonb,
  created_at timestamptz DEFAULT now()
);

-- 9. VPN ROUTING RULES
CREATE TABLE IF NOT EXISTS vpn_routing_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  rule jsonb NOT NULL,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- =============================================
-- 2. RPC ФУНКЦИИ
-- =============================================

-- Атомарное списание баланса
CREATE OR REPLACE FUNCTION deduct_user_balance(p_user_id uuid, p_amount numeric)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  current_amount numeric;
BEGIN
  SELECT amount INTO current_amount FROM balances WHERE user_id = p_user_id FOR UPDATE;
  IF current_amount IS NULL THEN
    RAISE EXCEPTION 'Balance not found for user %', p_user_id;
  END IF;
  IF current_amount < p_amount THEN
    RETURN false;
  END IF;
  UPDATE balances SET amount = amount - p_amount, updated_at = now() WHERE user_id = p_user_id;
  RETURN true;
END;
$$;

-- Возврат баланса
CREATE OR REPLACE FUNCTION refund_user_balance(p_user_id uuid, p_amount numeric)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO balances (user_id, amount, currency, updated_at)
  VALUES (p_user_id, p_amount, 'RUB', now())
  ON CONFLICT (user_id) DO UPDATE SET amount = balances.amount + p_amount, updated_at = now();
END;
$$;

-- Атомарное добавление устройства в подписку
CREATE OR REPLACE FUNCTION append_vpn_device(p_sub_id uuid, p_device_data jsonb)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  current_config text;
  devices jsonb;
BEGIN
  SELECT v2ray_config INTO current_config FROM subscriptions WHERE id = p_sub_id FOR UPDATE;
  IF current_config IS NULL OR current_config = '' THEN
    devices := jsonb_build_array(p_device_data);
  ELSIF current_config LIKE '[%]' THEN
    devices := current_config::jsonb || jsonb_build_array(p_device_data);
  ELSE
    devices := jsonb_build_array(p_device_data);
  END IF;
  UPDATE subscriptions SET v2ray_config = devices::text, updated_at = now() WHERE id = p_sub_id;
END;
$$;

-- =============================================
-- 3. НАЧАЛЬНЫЕ НАСТРОЙКИ
-- =============================================

-- Default settings
INSERT INTO settings (key, value) VALUES
  ('MONTHLY_PRICE', '100'),
  ('DEVICE_LIMIT', '2'),
  ('PUBLIC_URL', 'https://izinet.online')
ON CONFLICT (key) DO NOTHING;

-- Default admin profile (замени UUID на свой из auth.users)
-- INSERT INTO profiles (id, is_admin) VALUES ('YOUR-USER-UUID-HERE', true) ON CONFLICT (id) DO NOTHING;

-- =============================================
-- 4. ROW LEVEL SECURITY (RLS)
-- =============================================

-- Включить RLS на всех таблицах
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE vpn_servers ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE vpn_routing_rules ENABLE ROW LEVEL SECURITY;

-- Политики для service_role (backend использует service_role key, обходит RLS)
-- Service role automatically bypasses RLS, so no policies needed for backend.

-- Политики для anon/authenticated (если фронтенд обращается напрямую)
-- Разрешить чтение settings всем
CREATE POLICY "Settings readable by all" ON settings FOR SELECT USING (true);

-- Разрешить пользователям видеть только свои данные
CREATE POLICY "Users see own profile" ON users FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users see own subscriptions" ON subscriptions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users see own balance" ON balances FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users see own transactions" ON transactions FOR SELECT USING (auth.uid() = user_id);

-- Админы видят всё (через profiles.is_admin)
CREATE POLICY "Admins full access users" ON users FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
);
CREATE POLICY "Admins full access subscriptions" ON subscriptions FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
);
CREATE POLICY "Admins full access vpn_servers" ON vpn_servers FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
);
CREATE POLICY "Admins full access balances" ON balances FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
);
CREATE POLICY "Admins full access transactions" ON transactions FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
);
CREATE POLICY "Admins full access payments" ON payments FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
);
CREATE POLICY "Admins full access settings" ON settings FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
);
CREATE POLICY "Admins full access vpn_routing_rules" ON vpn_routing_rules FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
);

-- =============================================
-- 5. ИНДЕКСЫ
-- =============================================

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_vpn_servers_is_active ON vpn_servers(is_active);
CREATE INDEX IF NOT EXISTS idx_vpn_servers_health ON vpn_servers(health_status);

-- =============================================
-- ГОТОВО!
-- =============================================
```
