-- Migration: per-device auth + device Function registry (Phase 0b).
-- Run via Supabase SQL editor on the linked project. Idempotent.
--
-- Replaces the broken "userId == bearer secret" model. Each install gets its
-- own revocable device secret (hash stored, never the secret). The Twilio
-- Function URL + configSecret are registered per device, configSecret encrypted
-- at rest (AES-256-GCM, app layer — see backend/lib/crypto.ts, CONFIG_ENC_KEY env).

CREATE TABLE IF NOT EXISTS devices (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  secret_hash   TEXT NOT NULL,          -- sha256(salt || secret), hex
  secret_salt   TEXT NOT NULL,          -- hex, per-row
  label         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ,
  revoked_at    TIMESTAMPTZ             -- non-null => revoked, auth rejected
);
CREATE INDEX IF NOT EXISTS devices_user_id_idx ON devices(user_id);

CREATE TABLE IF NOT EXISTS device_functions (
  device_id         UUID PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  function_url      TEXT NOT NULL,
  config_secret_enc TEXT NOT NULL,      -- base64( iv(12) || ciphertext || tag(16) )
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS device_functions_user_id_idx ON device_functions(user_id);
