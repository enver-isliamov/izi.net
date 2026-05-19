-- ==========================================
-- ИНСТРУКЦИЯ: Скопируйте ВЕСЬ текст ниже 
-- и вставьте в SQL Editor в Supabase.
-- ==========================================

-- 1. БАЗОВАЯ СХЕМА (ТАБЛИЦЫ)

-- Профили пользователей
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  email text unique not null,
  name text,
  telegram_id bigint unique,
  telegram_linked boolean default false,
  referral_code text unique,
  referred_by uuid references public.profiles(id),
  is_admin boolean default false,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- VPN Серверы (с поддержкой авторизации и хранения состояния)
create table if not exists public.vpn_servers (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  ip text not null,
  domain text,
  api_port integer default 2053,
  api_username text default 'admin',
  api_password text default 'admin',
  location_code text default 'DE',
  xui_config_state jsonb default '{}', -- Здесь можно хранить бэкап Inbounds из 3x-ui
  is_active boolean default true,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Балансы пользователей
create table if not exists public.balances (
  user_id uuid references public.profiles(id) on delete cascade primary key,
  amount numeric(12,2) default 0.00,
  currency text default 'RUB',
  updated_at timestamp with time zone default timezone('utc'::text, now())
);

-- Подписки
create table if not exists public.subscriptions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  server_id uuid references public.vpn_servers(id),
  plan_type text check (plan_type in ('trial', 'basic', 'premium')) not null,
  status text check (status in ('trial', 'active', 'expired', 'cancelled')) default 'active',
  traffic_limit_mb bigint default 0,
  traffic_used_mb bigint default 0,
  device_limit integer default 1,
  devices_connected integer default 0,
  server_type text check (server_type in ('lte', 'wifi')) default 'wifi',
  period_months integer default 1,
  expires_at timestamp with time zone not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Устройства (конфиги vpn)
create table if not exists public.devices (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  subscription_id uuid references public.subscriptions(id) on delete cascade not null,
  name text not null,
  config_link text,
  last_connected timestamp with time zone,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Тикеты поддержки
create table if not exists public.support_tickets (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  subject text not null,
  status text check (status in ('open', 'closed', 'pending')) default 'open',
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Сообщения тикетов
create table if not exists public.support_messages (
  id uuid default gen_random_uuid() primary key,
  ticket_id uuid references public.support_tickets(id) on delete cascade not null,
  sender text check (sender in ('user', 'admin')) not null,
  content text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Транзакции
create table if not exists public.transactions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  amount numeric(12,2) not null,
  type text check (type in ('deposit', 'withdrawal', 'subscription_buy', 'referral_bonus')) not null,
  status text check (status in ('pending', 'completed', 'failed')) default 'pending',
  external_id text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Глобальные настройки
create table if not exists public.app_config (
  key text primary key,
  value jsonb not null,
  updated_at timestamp with time zone default timezone('utc'::text, now())
);

-- 2. БЕЗОПАСНОСТЬ (RLS МОДЕЛЬ)

alter table public.profiles enable row level security;
alter table public.vpn_servers enable row level security;
alter table public.balances enable row level security;
alter table public.subscriptions enable row level security;
alter table public.devices enable row level security;
alter table public.support_tickets enable row level security;
alter table public.support_messages enable row level security;
alter table public.transactions enable row level security;
alter table public.app_config enable row level security;

-- Профили
drop policy if exists "Users can view own profile" on public.profiles;
create policy "Users can view own profile" on public.profiles for select using (auth.uid() = id);
drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile" on public.profiles for update using (auth.uid() = id);

-- Серверы
drop policy if exists "Public servers" on public.vpn_servers;
create policy "Public servers" on public.vpn_servers for select using (true);

-- Баланс
drop policy if exists "Own balance" on public.balances;
create policy "Own balance" on public.balances for select using (auth.uid() = user_id);

-- Подписки
drop policy if exists "Own subs" on public.subscriptions;
create policy "Own subs" on public.subscriptions for select using (auth.uid() = user_id);

-- Транзакции
drop policy if exists "Own transactions" on public.transactions;
create policy "Own transactions" on public.transactions for select using (auth.uid() = user_id);

-- 3. АВТОМАТИЗАЦИЯ

-- Создание профиля и баланса при регистрации
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, referral_code)
  values (new.id, new.email, substring(md5(random()::text) from 1 for 8));
  
  insert into public.balances (user_id, amount)
  values (new.id, 0);
  
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 4. Включение REALTIME каналов

begin;
  drop publication if exists supabase_realtime;
  create publication supabase_realtime;
commit;

alter publication supabase_realtime add table public.subscriptions;
alter publication supabase_realtime add table public.balances;
alter publication supabase_realtime add table public.vpn_servers;
alter publication supabase_realtime add table public.support_messages;
alter publication supabase_realtime add table public.support_tickets;
