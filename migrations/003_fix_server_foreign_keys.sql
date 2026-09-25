-- ==============================================================================
-- 003: ИСПРАВЛЕНИЕ FOREIGN KEY ДЛЯ БЕЗОПАСНОГО УДАЛЕНИЯ СЕРВЕРОВ (ON DELETE SET NULL)
-- Позволяет удалять серверы без ошибки:
-- "Key (id)=(...) is still referenced from table subscriptions"
-- ==============================================================================

-- 1. Исправление внешнего ключа таблицы subscriptions (подписки пользователей)
ALTER TABLE public.subscriptions 
  DROP CONSTRAINT IF EXISTS subscriptions_server_id_fkey;

ALTER TABLE public.subscriptions 
  ADD CONSTRAINT subscriptions_server_id_fkey 
  FOREIGN KEY (server_id) 
  REFERENCES public.vpn_servers(id) 
  ON DELETE SET NULL;

-- 2. Исправление внешнего ключа таблицы vpn_routing_rules (правила маршрутизации)
ALTER TABLE IF EXISTS public.vpn_routing_rules 
  DROP CONSTRAINT IF EXISTS vpn_routing_rules_server_id_fkey;

ALTER TABLE IF EXISTS public.vpn_routing_rules 
  ADD CONSTRAINT vpn_routing_rules_server_id_fkey 
  FOREIGN KEY (server_id) 
  REFERENCES public.vpn_servers(id) 
  ON DELETE CASCADE;
