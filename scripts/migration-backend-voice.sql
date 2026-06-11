-- Backend-hosted voice: per-user Twilio voice config + paid/trialing predicates.
-- Idempotent. Apply to prod Supabase via MCP apply_migration.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS api_key_sid             TEXT,
  ADD COLUMN IF NOT EXISTS api_key_secret_enc      TEXT,   -- AES-256-GCM (CONFIG_ENC_KEY)
  ADD COLUMN IF NOT EXISTS twiml_app_sid           TEXT,
  ADD COLUMN IF NOT EXISTS voice_capability_secret TEXT,
  ADD COLUMN IF NOT EXISTS caller_id               TEXT,
  ADD COLUMN IF NOT EXISTS client_identity         TEXT,
  ADD COLUMN IF NOT EXISTS incoming_enabled        BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS forward_enabled         BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS forward_number          TEXT,
  ADD COLUMN IF NOT EXISTS record_outgoing         BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS backend_voice           BOOLEAN NOT NULL DEFAULT FALSE;
-- account_sid already exists as twilio_account_sid (migration-identity.sql).

-- Paid = elevated access EXCLUDING trial.
CREATE OR REPLACE FUNCTION user_is_paid(uid UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN subscription_status IN ('active', 'past_due') AND current_period_end > now() THEN TRUE
    WHEN subscription_status = 'cancelled' AND current_period_end > now() THEN TRUE
    ELSE FALSE
  END
  FROM users WHERE id = uid;
$$;

-- Trialing = trial window still open (used to make transcription free during trial).
CREATE OR REPLACE FUNCTION user_is_trialing(uid UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
  SELECT (subscription_status = 'trialing' AND trial_ends_at > now())
  FROM users WHERE id = uid;
$$;
