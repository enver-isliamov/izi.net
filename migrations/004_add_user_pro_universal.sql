-- 004_add_user_pro_universal.sql
-- Add is_pro and universal_access columns to users table for fine-grained subscription access control

ALTER TABLE IF EXISTS public.users 
ADD COLUMN IF NOT EXISTS is_pro BOOLEAN DEFAULT false;

ALTER TABLE IF EXISTS public.users 
ADD COLUMN IF NOT EXISTS universal_access BOOLEAN DEFAULT false;

-- Add comment for schema documentation
COMMENT ON COLUMN public.users.is_pro IS 'User Pro status for extended limits and special badges';
COMMENT ON COLUMN public.users.universal_access IS 'Explicit permission for Universal multi-protocol subscription (VLESS + Hysteria2 + AmneziaWG)';
