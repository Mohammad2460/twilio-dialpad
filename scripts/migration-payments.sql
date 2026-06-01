-- Migration: add subscription columns + access helper.
-- Idempotent — uses IF NOT EXISTS / CREATE OR REPLACE.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS subscription_status TEXT NOT NULL DEFAULT 'trialing',
  ADD COLUMN IF NOT EXISTS subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS dodo_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days'),
  ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS users_subscription_id ON users(subscription_id) WHERE subscription_id IS NOT NULL;

CREATE OR REPLACE FUNCTION user_has_access(uid UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN subscription_status IN ('active', 'past_due') AND current_period_end > now() THEN TRUE
    WHEN subscription_status = 'cancelled' AND current_period_end > now() THEN TRUE
    WHEN subscription_status = 'trialing' AND trial_ends_at > now() THEN TRUE
    ELSE FALSE
  END
  FROM users WHERE id = uid;
$$;
