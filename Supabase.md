# Настройка Supabase для izinet

Этот файл содержит все необходимые SQL-запросы для настройки базы данных. 
Скопируйте и вставьте этот код в **Supabase -> SQL Editor** и нажмите **Run**.

## 1. Базовая схема (Таблицы)

```sql
-- 1. Профили пользователей (связаны с auth.users)
create table public.profiles (
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

-- 2. VPN Серверы
create table public.vpn_servers (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  ip text not null,
  domain text,
  api_port integer default 2053,
  api_username text default 'admin',
  api_password text default 'admin',
  location_code text default 'DE',
  xui_config_state jsonb default '{}', -- Хранение настроек Inbounds (порты, протоколы)
  is_active boolean default true,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 3. Балансы пользователей
create table public.balances (
  user_id uuid references public.profiles(id) on delete cascade primary key,
  amount numeric(12,2) default 0.00,
  currency text default 'RUB',
  updated_at timestamp with time zone default timezone('utc'::text, now())
);

-- 4. Подписки
create table public.subscriptions (
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

-- 5. Устройства (конфиги)
create table public.devices (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  subscription_id uuid references public.subscriptions(id) on delete cascade not null,
  name text not null,
  config_link text,
  last_connected timestamp with time zone,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 6. Тикеты поддержки
create table public.support_tickets (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  subject text not null,
  status text check (status in ('open', 'closed', 'pending')) default 'open',
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 7. Сообщения в тикетах
create table public.support_messages (
  id uuid default gen_random_uuid() primary key,
  ticket_id uuid references public.support_tickets(id) on delete cascade not null,
  sender text check (sender in ('user', 'admin')) not null,
  content text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 8. Транзакции (Платежи)
create table public.transactions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  amount numeric(12,2) not null,
  type text check (type in ('deposit', 'withdrawal', 'subscription_buy', 'referral_bonus')) not null,
  status text check (status in ('pending', 'completed', 'failed')) default 'pending',
  external_id text, -- ID из Enot.io или другого мерчанта
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 9. Конфигурация приложения
create table public.app_config (
  key text primary key,
  value jsonb not null,
  updated_at timestamp with time zone default timezone('utc'::text, now())
);
```

## 2. Безопасность (RLS Политики)

```sql
-- Включаем RLS для всех таблиц
alter table public.profiles enable row level security;
alter table public.vpn_servers enable row level security;
alter table public.balances enable row level security;
alter table public.subscriptions enable row level security;
alter table public.devices enable row level security;
alter table public.support_tickets enable row level security;
alter table public.support_messages enable row level security;
alter table public.transactions enable row level security;
alter table public.app_config enable row level security;

-- Политики для Profiles
create policy "Users can view their own profile" on public.profiles for select using (auth.uid() = id);
create policy "Users can update their own profile" on public.profiles for update using (auth.uid() = id);

-- Политики для VPN Servers (Публичные для чтения)
create policy "Anyone can view active servers" on public.vpn_servers for select using (is_active = true);

-- Политики для Balances
create policy "Users can view their own balance" on public.balances for select using (auth.uid() = user_id);

-- Политики для Subscriptions
create policy "Users can view their own subscriptions" on public.subscriptions for select using (auth.uid() = user_id);

-- Политики для Devices
create policy "Users can manage their own devices" on public.devices for all using (auth.uid() = user_id);

-- Политики для Support
create policy "Users can view their own tickets" on public.support_tickets for select using (auth.uid() = user_id);
create policy "Users can create tickets" on public.support_tickets for insert with check (auth.uid() = user_id);

create policy "Users can view messages of their tickets" on public.support_messages for select 
  using (ticket_id in (select id from public.support_tickets where user_id = auth.uid()));
create policy "Users can send messages to their tickets" on public.support_messages for insert 
  with check (ticket_id in (select id from public.support_tickets where user_id = auth.uid()) and sender = 'user');

-- Политики для Transactions
create policy "Users can view their transactions" on public.transactions for select using (auth.uid() = user_id);

-- Политики для App Config (Только чтение для всех)
create policy "Anyone can view app config" on public.app_config for select using (true);
```

## 3. Автоматизация (Триггеры)

```sql
-- Авто-создание профиля при регистрации в Auth
create function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, referral_code)
  values (new.id, new.email, substring(md5(random()::text) from 1 for 8));
  
  insert into public.balances (user_id, amount)
  values (new.id, 0);
  
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
```

## 4. Realtime (Синхронизация)

```sql
-- Добавление таблиц в публикацию для обновлений в реальном времени
begin;
  -- Удаляем существующую публикацию, если она есть, чтобы избежать конфликтов
  drop publication if exists supabase_realtime;
  create publication supabase_realtime;
commit;

alter publication supabase_realtime add table public.subscriptions;
alter publication supabase_realtime add table public.support_tickets;
alter publication supabase_realtime add table public.support_messages;
alter publication supabase_realtime add table public.balances;
alter publication supabase_realtime add table public.vpn_servers;
```
