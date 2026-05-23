-- =========================================================================
--                     IZINET DATABASE DEFINITION (SUPABASE)
-- =========================================================================
-- ИНСТРУКЦИЯ: Скопируйте ВЕСЬ текст ниже и вставьте в SQL Editor в Supabase.
-- Данный файл является единственным актуальным источником конфигурации БД.
-- =========================================================================

-- 1. ТАБЛИЦЫ БД (БАЗОВАЯ СХЕМА)

-- Профили / Пользователи
create table if not exists public.users (
  id uuid references auth.users on delete cascade primary key,
  email text unique not null,
  name text,
  telegram_id text unique,
  telegram_linked boolean default false,
  referral_code text unique,
  referred_by uuid references public.users(id),
  role text default 'user',
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- VPN Серверы (архитектура бесшовной сети)
create table if not exists public.vpn_servers (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  ip text not null,
  domain text,
  api_port integer default 2053,
  username text not null,
  password text not null,
  location_code text default 'DE',
  xui_config_state jsonb default '{}', -- Хранение текущего бэкапа inbounds
  is_active boolean default true,
  is_default boolean default false,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Балансы пользователей
create table if not exists public.balances (
  user_id uuid references public.users(id) on delete cascade primary key,
  amount numeric(12,2) default 0.00,
  currency text default 'RUB',
  updated_at timestamp with time zone default timezone('utc'::text, now())
);

-- Подписки пользователей
create table if not exists public.subscriptions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.users(id) on delete cascade not null,
  server_id uuid references public.vpn_servers(id) on delete set null,
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

-- Устройства (конфигурации VPN)
create table if not exists public.devices (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.users(id) on delete cascade not null,
  subscription_id uuid references public.subscriptions(id) on delete cascade not null,
  name text not null,
  config_link text,
  last_connected timestamp with time zone,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Поддержка: тикеты
create table if not exists public.support_tickets (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.users(id) on delete cascade not null,
  subject text not null,
  status text check (status in ('open', 'closed', 'pending')) default 'open',
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Поддержка: сообщения
create table if not exists public.support_messages (
  id uuid default gen_random_uuid() primary key,
  ticket_id uuid references public.support_tickets(id) on delete cascade not null,
  sender text check (sender in ('user', 'admin')) not null,
  content text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Инвойсы и балансовые платежи (Enot.io)
create table if not exists public.payments (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.users(id) on delete cascade,
  amount numeric(12,2) not null,
  currency text default 'RUB',
  payment_method text,
  status text default 'pending',
  payment_link text,
  expires_at timestamp with time zone,
  completed_at timestamp with time zone,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Логи транзакций баланса
create table if not exists public.transactions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.users(id) on delete cascade not null,
  amount numeric(12,2) not null,
  currency text default 'RUB',
  type text check (type in ('deposit', 'withdrawal', 'subscription_buy', 'referral_bonus')) not null,
  status text check (status in ('pending', 'completed', 'failed')) default 'pending',
  external_id text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Системные настройки (Enot, Cloudflare)
create table if not exists public.settings (
  key text primary key,
  value text not null,
  updated_at timestamp with time zone default timezone('utc'::text, now())
);

-- Временные токены связывания Telegram аккаунта
create table if not exists public.telegram_linking_tokens (
  token text primary key,
  user_id uuid references public.users(id) on delete cascade,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);


-- 2. БЕЗОПАСНОСТЬ И КОНТРОЛЬ ДОСТУПА (RLS ПОЛИТИКИ)

-- Включение RLS
alter table public.users enable row level security;
alter table public.vpn_servers enable row level security;
alter table public.balances enable row level security;
alter table public.subscriptions enable row level security;
alter table public.devices enable row level security;
alter table public.support_tickets enable row level security;
alter table public.support_messages enable row level security;
alter table public.payments enable row level security;
alter table public.transactions enable row level security;
alter table public.settings enable row level security;
alter table public.telegram_linking_tokens enable row level security;

-- Очистка старых политик (предотвращение конфликтов)
drop policy if exists "Users can view own data" on public.users;
drop policy if exists "Users can update own data" on public.users;
drop policy if exists "Admins can manage users" on public.users;
drop policy if exists "Users can view own balance" on public.balances;
drop policy if exists "Admins can manage balances" on public.balances;
drop policy if exists "Users can select active servers" on public.vpn_servers;
drop policy if exists "Admins can manage servers" on public.vpn_servers;
drop policy if exists "Users can view own subscriptions" on public.subscriptions;
drop policy if exists "Admins can manage subscriptions" on public.subscriptions;
drop policy if exists "Users can manage own devices" on public.devices;
drop policy if exists "Admins can manage devices" on public.devices;
drop policy if exists "Users can view own tickets" on public.support_tickets;
drop policy if exists "Users can insert own tickets" on public.support_tickets;
drop policy if exists "Admins can manage tickets" on public.support_tickets;
drop policy if exists "Users can view messages of their tickets" on public.support_messages;
drop policy if exists "Users can send messages to their tickets" on public.support_messages;
drop policy if exists "Admins can manage support messages" on public.support_messages;
drop policy if exists "Users can view own payments" on public.payments;
drop policy if exists "Users can insert own payments" on public.payments;
drop policy if exists "Admins can manage payments" on public.payments;
drop policy if exists "Users can view own transactions" on public.transactions;
drop policy if exists "Admins can manage transactions" on public.transactions;
drop policy if exists "Admins can manage settings" on public.settings;
drop policy if exists "Public access to telegram tokens" on public.telegram_linking_tokens;

-- Хелпер-функция безопасной проверки роли (security definer) во избежание рекурсии
create or replace function public.is_admin()
returns boolean as $$
begin
  return exists (
    select 1 from public.users 
    where id = auth.uid() and role in ('admin', 'superadmin')
  );
end;
$$ language plpgsql security definer;

-- Политики пользователей (users)
create policy "Users can view own data" on public.users for select using (auth.uid() = id);
create policy "Users can update own data" on public.users for update using (auth.uid() = id);
create policy "Admins can manage users" on public.users for all using (
  public.is_admin()
);

-- Политики балансов (balances)
create policy "Users can view own balance" on public.balances for select using (auth.uid() = user_id);
create policy "Admins can manage balances" on public.balances for all using (
  public.is_admin()
);

-- Политики серверов (vpn_servers)
create policy "Users can select active servers" on public.vpn_servers for select using (is_active = true);
create policy "Admins can manage servers" on public.vpn_servers for all using (
  public.is_admin()
);

-- Политики подписок (subscriptions)
create policy "Users can view own subscriptions" on public.subscriptions for select using (auth.uid() = user_id);
create policy "Admins can manage subscriptions" on public.subscriptions for all using (
  public.is_admin()
);

-- Политики устройств (devices)
create policy "Users can manage own devices" on public.devices for all using (auth.uid() = user_id);
create policy "Admins can manage devices" on public.devices for all using (
  public.is_admin()
);

-- Политики тикетов поддержки (support_tickets)
create policy "Users can view own tickets" on public.support_tickets for select using (auth.uid() = user_id);
create policy "Users can insert own tickets" on public.support_tickets for insert with check (auth.uid() = user_id);
create policy "Admins can manage tickets" on public.support_tickets for all using (
  public.is_admin()
);

-- Политики сообщений тикетов (support_messages)
create policy "Users can view messages of their tickets" on public.support_messages for select using (
  exists (select 1 from public.support_tickets where id = ticket_id and user_id = auth.uid())
);
create policy "Users can send messages to their tickets" on public.support_messages for insert with check (
  sender = 'user' and exists (select 1 from public.support_tickets where id = ticket_id and user_id = auth.uid())
);
create policy "Admins can manage support messages" on public.support_messages for all using (
  public.is_admin()
);

-- Политики счетов пополнений (payments)
create policy "Users can view own payments" on public.payments for select using (auth.uid() = user_id);
create policy "Users can insert own payments" on public.payments for insert with check (auth.uid() = user_id);
create policy "Admins can manage payments" on public.payments for all using (
  public.is_admin()
);

-- Политики транзакций (transactions)
create policy "Users can view own transactions" on public.transactions for select using (auth.uid() = user_id);
create policy "Admins can manage transactions" on public.transactions for all using (
  public.is_admin()
);

-- Политики глобальных настроек (settings)
create policy "Admins can manage settings" on public.settings for all using (
  public.is_admin()
);

-- Политики токенов авторизации Telegram
create policy "Public access to telegram tokens" on public.telegram_linking_tokens for all using (true);


-- 3. АВТОПРИВЯЗКА ПРИ РЕГИСТРАЦИИ (ТРИГГЕРЫ ПЛАТФОРМЫ)

-- Автоматическое создание профиля 'users' и баланса при регистрации в Supabase Auth
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.users (id, email, referral_code)
  values (new.id, new.email, substring(md5(random()::text) from 1 for 8));
  
  insert into public.balances (user_id, amount)
  values (new.id, 0.00);
  
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();


-- 4. REALTIME СИНХРОНИЗАЦИЯ (КАНАЛЫ)

begin;
  drop publication if exists supabase_realtime;
  create publication supabase_realtime;
commit;

alter publication supabase_realtime add table public.subscriptions;
alter publication supabase_realtime add table public.balances;
alter publication supabase_realtime add table public.vpn_servers;
alter publication supabase_realtime add table public.support_messages;
alter publication supabase_realtime add table public.support_tickets;


-- 5. ИНИЦИАЛИЗАЦИЯ НАСТРОЕК & НАЗНАЧЕНИЕ АДМИНИСТРАТОРА

-- Заполняем дефолтные пустые строки настроек, чтобы их можно было легко редактировать в Админ-панели
insert into public.settings (key, value) values 
  ('CLOUDFLARE_EMAIL', ''),
  ('CLOUDFLARE_API_KEY', ''),
  ('CLOUDFLARE_API_TOKEN', ''),
  ('ENOT_MERCHANT_ID', ''),
  ('ENOT_SECRET_KEY', ''),
  ('ENOT_SECRET_KEY2', '')
on conflict (key) do nothing;

-- 💡 Сделайте пользователя суперадминистратором, указав его email (например, enverphoto@gmail.com)
update public.users set role = 'superadmin' where email = 'enverphoto@gmail.com';
