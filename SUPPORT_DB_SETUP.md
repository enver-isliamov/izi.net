# Настройка Чат-Поддержки (UI <-> Telegram)

Интеграция чата поддержки между интерфейсом пользователя и Telegram администратора — это **лучшее (и самое правильное) решение** для вашего сервиса VPN. 

Вам, как администратору, не понадобится заходить в отдельную админ-панель для ответов — всё общение будет происходить прямо в вашем Telegram (куда приходят уведомления о проблемах пользователей), а пользователи будут видеть ваши ответы прямо в интерфейсе сайта. Это работает намного быстрее и прозрачнее email-переписок.

Для реализации этой функции, пожалуйста, выполните следующий SQL-скрипт в **Supabase -> SQL Editor**:

```sql
-- Создание таблицы сообщений, если ее нет. Таблица support_tickets уже существует.
create table public.support_messages (
  id uuid default gen_random_uuid() primary key,
  ticket_id uuid references public.support_tickets(id) on delete cascade not null,
  sender text check (sender in ('user', 'admin')) not null,
  content text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- RLS для support_messages
alter table public.support_messages enable row level security;

create policy "Users can view messages of their tickets"
  on public.support_messages for select
  using (
    ticket_id in (
      select id from public.support_tickets where user_id = auth.uid()
    )
  );

create policy "Users can send messages to their tickets"
  on public.support_messages for insert
  with check (
    ticket_id in (
      select id from public.support_tickets where user_id = auth.uid()
    )
    and sender = 'user'
  );

-- Настройка Realtime (убедитесь, что таблица support_tickets уже добавлена)
-- Если таблица support_messages уже в публикации, эта команда может выдать ошибку, которую можно игнорировать.
alter publication supabase_realtime add table public.support_messages;
```

**После того как вы выполните этот код в Supabase, просто дайте мне команду, и я напишу код для Интерфейса и Бота!**
