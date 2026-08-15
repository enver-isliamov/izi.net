-- BUG-VPN-03 + BUG-VPN-05: Добавление полей для явного описания серверов
-- Выполнить в Supabase SQL Editor

-- Новые поля для vpn_servers
ALTER TABLE vpn_servers ADD COLUMN IF NOT EXISTS public_host text;
ALTER TABLE vpn_servers ADD COLUMN IF NOT EXISTS inbound_id integer DEFAULT 0;
ALTER TABLE vpn_servers ADD COLUMN IF NOT EXISTS vpn_port integer DEFAULT 443;
ALTER TABLE vpn_servers ADD COLUMN IF NOT EXISTS reality_sni text;
ALTER TABLE vpn_servers ADD COLUMN IF NOT EXISTS health_status text DEFAULT 'unknown';
ALTER TABLE vpn_servers ADD COLUMN IF NOT EXISTS last_health_check_at timestamptz;
ALTER TABLE vpn_servers ADD COLUMN IF NOT EXISTS panel_path text DEFAULT '/';

-- Миграция данных из текущих полей
-- public_host = домен без протокола (из domain)
UPDATE vpn_servers SET
  public_host = CASE
    WHEN domain LIKE 'http://%' THEN regexp_replace(domain, '^https?://', '')
    WHEN domain LIKE 'https://%' THEN regexp_replace(domain, '^https?://', '')
    ELSE domain
  END,
  inbound_id = COALESCE(inbound_id, 0),
  vpn_port = COALESCE(vpn_port, 443)
WHERE public_host IS NULL;
