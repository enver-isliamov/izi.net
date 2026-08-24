-- ==============================================================================
-- 000: ПОЛНАЯ СХЕМА БАЗЫ ДАННЫХ IZINET VPN (SUPABASE POSTGRESQL)
-- Единый мастер-файл для развёртывания чистой БД с поддержкой VLESS, Hysteria2 и RLS.
-- Идемпотентно: можно запускать на чистой или существующей базе без потери данных.
-- ==============================================================================

-- 1. ТАБЛИЦА СЕРВЕРОВ VPN
CREATE TABLE IF NOT EXISTS vpn_servers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  ip text NOT NULL,
  domain text,
  public_host text,
  api_port integer DEFAULT 2053,
  vpn_port integer DEFAULT 443,
  inbound_id integer DEFAULT 0,
  username text,
  password text,
  location_code text DEFAULT 'DE',
  is_active boolean DEFAULT true,
  reality_sni text,
  panel_path text DEFAULT '/',
  health_status text DEFAULT 'unknown',
  last_health_check_at timestamptz,
  total_users integer DEFAULT 0,
  online_users integer DEFAULT 0,
  xui_total_clients integer DEFAULT 0,
  xui_config_state jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 2. ТАБЛИЦА ПОЛЬЗОВАТЕЛЕЙ
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  role text DEFAULT 'user',
  balance numeric DEFAULT 0,
  referral_code text UNIQUE,
  referred_by uuid REFERENCES users(id) ON DELETE SET NULL,
  telegram_id bigint,
  telegram_username text,
  is_banned boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 3. ТАБЛИЦА ПРОФИЛЕЙ
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  full_name text,
  avatar_url text,
  is_admin boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 4. ТАБЛИЦА БАЛАНСОВ
CREATE TABLE IF NOT EXISTS balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  balance numeric DEFAULT 0,
  currency text DEFAULT 'RUB',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS balances_user_id_uidx ON balances(user_id);

-- 5. ТАБЛИЦА ПОДПИСОК
CREATE TABLE IF NOT EXISTS subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  server_id uuid REFERENCES vpn_servers(id) ON DELETE SET NULL,
  status text DEFAULT 'active',
  plan_name text DEFAULT 'Standard',
  server_type text DEFAULT 'vless',
  traffic_used_mb bigint DEFAULT 0,
  traffic_limit_mb bigint DEFAULT 102400,
  v2ray_config text,
  device_limit integer DEFAULT 3,
  expires_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_user_id_uidx ON subscriptions(user_id);

-- 6. ТАБЛИЦА ПЛАТЕЖЕЙ
CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount numeric NOT NULL,
  status text DEFAULT 'pending',
  provider text DEFAULT 'enot',
  external_id text,
  payment_link text,
  completed_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- 7. ТАБЛИЦА ТРАНЗАКЦИЙ
CREATE TABLE IF NOT EXISTS transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount numeric NOT NULL,
  type text NOT NULL,
  description text,
  created_at timestamptz DEFAULT now()
);

-- 8. ТАБЛИЦА СИСТЕМНЫХ НАСТРОЕК
CREATE TABLE IF NOT EXISTS settings (
  key text PRIMARY KEY,
  value text,
  description text,
  updated_at timestamptz DEFAULT now()
);

-- 9. ТАБЛИЦА ПРАВИЛ РОУТИНГА VPN
CREATE TABLE IF NOT EXISTS vpn_routing_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id uuid REFERENCES vpn_servers(id) ON DELETE CASCADE,
  target_domains text[],
  outbound_tag text DEFAULT 'direct',
  description text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- 10. ТАБЛИЦА ТОКЕНОВ СВЯЗКИ TELEGRAM
CREATE TABLE IF NOT EXISTS telegram_linking_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text UNIQUE NOT NULL,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  telegram_id bigint,
  telegram_username text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- 11. ТАБЛИЦА ТИКЕТОВ ПОДДЕРЖКИ
CREATE TABLE IF NOT EXISTS support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  subject text NOT NULL,
  status text DEFAULT 'open',
  priority text DEFAULT 'medium',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS support_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid REFERENCES support_tickets(id) ON DELETE CASCADE,
  sender_id uuid REFERENCES users(id) ON DELETE CASCADE,
  is_admin boolean DEFAULT false,
  message text NOT NULL,
  created_at timestamptz DEFAULT now()
);
