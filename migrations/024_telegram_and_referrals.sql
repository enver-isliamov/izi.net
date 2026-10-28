-- =========================================================
-- Миграция 024: Синхронизация полей Telegram и таблица referrals
-- =========================================================

-- 1. Добавляем колонку telegram_linked, если её ещё не было
ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_linked boolean DEFAULT false;

-- 2. Проставляем telegram_linked = true всем, у кого уже есть telegram_id
UPDATE users SET telegram_linked = true WHERE telegram_id IS NOT NULL;

-- 3. Создаём таблицу referrals, если отсутствует
CREATE TABLE IF NOT EXISTS referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  referred_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text DEFAULT 'active',
  commission_earned numeric DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(referrer_id, referred_user_id)
);

-- Индексы для быстрого поиска
CREATE INDEX IF NOT EXISTS idx_referrals_referrer_id ON referrals(referrer_id);
CREATE INDEX IF NOT EXISTS idx_referrals_referred_user_id ON referrals(referred_user_id);
