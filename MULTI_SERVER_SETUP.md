# Настройка Мульти-серверной архитектуры izinet

Для реализации возможности подключения нескольких VPN-серверов и управления ими из админ-панели, необходимо выполнить следующий SQL-запрос в **Supabase -> SQL Editor**:

```sql
-- 1. Создание таблицы серверов
create table public.vpn_servers (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  ip text not null,
  domain text, -- Например, node1.izinet.net
  api_port integer default 2053,
  username text not null,
  password text not null,
  is_active boolean default true,
  location_code text default 'DE', -- DE, NL, US и т.д.
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 2. Добавление ролей пользователям
alter table public.users add column if not exists role text default 'user';

-- 3. Назначение СУПЕРАДМИНА
update public.users set role = 'superadmin' where email = 'enverphoto@gmail.com';

-- 4. Привязка подписок к серверам
alter table public.subscriptions add column if not exists server_id uuid references public.vpn_servers(id);

-- 5. Включение RLS для vpn_servers (доступ только админам)
alter table public.vpn_servers enable row level security;

create policy "Admins can manage servers"
  on public.vpn_servers for all
  using (
    exists (
      select 1 from public.users
      where id = auth.uid() and role in ('admin', 'superadmin')
    )
  );

create policy "Users can view active servers"
  on public.vpn_servers for select
  using (is_active = true);

-- 6. Добавление vpn_servers в Realtime публикацию
ALTER PUBLICATION supabase_realtime ADD TABLE public.vpn_servers;

-- 7. Таблица системных настроек (для платежей и прочего)
create table if not exists public.settings (
  key text primary key,
  value text not null,
  updated_at timestamp with time zone default now()
);

alter table public.settings enable row level security;

create policy "Admins can manage settings"
  on public.settings for all
  using (
    exists (
      select 1 from public.users
      where id = auth.uid() and role in ('admin', 'superadmin')
    )
  );
```

**После выполнения этого запроса:**
1. Перейдите в раздел "Серверы" (будет доступен после обновления кода).
2. Добавьте ваш текущий сервер (185.72.11.57) в список.
3. Система автоматически начнет использовать домен (если указан) вместо прямого IP в конфигурациях.
