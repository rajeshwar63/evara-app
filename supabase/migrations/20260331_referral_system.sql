-- ═══════════════════════════════════════════════════════════════
-- REFERRAL SYSTEM MIGRATION
-- ═══════════════════════════════════════════════════════════════

-- 1. Add referral columns to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_prompt_shown BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_expires_at TIMESTAMPTZ;

-- 2. Create referrals table
CREATE TABLE IF NOT EXISTS referrals (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  referrer_phone TEXT NOT NULL REFERENCES users(phone_number),
  invitee_phone TEXT NOT NULL REFERENCES users(phone_number),
  referral_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  UNIQUE(invitee_phone)
);

-- 3. Create indexes
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_phone);
CREATE INDEX IF NOT EXISTS idx_referrals_code ON referrals(referral_code);
CREATE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code);

-- 4. Plan expiry cron job (requires pg_cron extension)
-- Run daily at midnight IST (18:30 UTC previous day)
-- Uncomment and run manually in Supabase SQL editor if pg_cron is enabled:
--
-- SELECT cron.schedule(
--   'downgrade-expired-plans',
--   '30 18 * * *',
--   $$
--   UPDATE users
--   SET plan = 'free'
--   WHERE plan = 'individual'
--     AND plan_expires_at IS NOT NULL
--     AND plan_expires_at < NOW();
--   $$
-- );
