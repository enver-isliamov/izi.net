-- СКОПИРУЙТЕ И ВЫПОЛНИТЕ ЭТОТ КОД В SUPABASE SQL EDITOR

-- 1. Исправление таблицы vpn_servers (добавление недостающих колонок)
ALTER TABLE public.vpn_servers ADD COLUMN IF NOT EXISTS is_default BOOLEAN DEFAULT false;
ALTER TABLE public.vpn_servers ADD COLUMN IF NOT EXISTS location_code TEXT DEFAULT 'DE';
ALTER TABLE public.vpn_servers ADD COLUMN IF NOT EXISTS xui_config_state JSONB DEFAULT '{}'::jsonb;

-- 2. Исправление таблицы profiles (добавление колонки роли)
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename  = 'profiles') THEN
        ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT false;
        ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user';
    END IF;
END $$;

-- 3. Исправление таблицы users (если используется отдельная таблица в public)
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename  = 'users') THEN
        ALTER TABLE public.users ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user';
    END IF;
END $$;

-- 4. Создание и наполнение таблицы настроек (settings)
CREATE TABLE IF NOT EXISTS public.settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Настройка политик безопасности для settings
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins can manage settings" ON public.settings;
CREATE POLICY "Admins can manage settings"
  ON public.settings FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND (role IN ('admin', 'superadmin') OR is_admin = true)
    )
  );

-- Наполнение базовыми настройками
INSERT INTO public.settings (key, value) VALUES
('MONTHLY_PRICE', '100'),
('DEVICE_LIMIT', '2'),
('PUBLIC_URL', 'https://izinet.online'),
('UNIVERSAL_LINK_STATUS', 'all'),
('PROMO_CODES_ENABLED', 'true')
ON CONFLICT (key) DO NOTHING;

-- 5. Исправление таблицы подписок (привязка к серверам)
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS server_id UUID REFERENCES public.vpn_servers(id);

-- 6. Создание таблицы для правил маршрутизации (Xray Routing)
CREATE TABLE IF NOT EXISTS public.vpn_routing_rules (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    domains JSONB DEFAULT '[]'::jsonb,
    ips JSONB DEFAULT '[]'::jsonb,
    outbound_tag TEXT DEFAULT 'direct',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 7. Исправление таблицы транзакций (если не хватает колонок)
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'completed';
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS description TEXT;
