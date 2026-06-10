-- Migration: SMS opt-outs (Phase 5 compliance). Run via Supabase SQL editor. Idempotent.
-- One row per (user_id, number) the contact has STOP'd. Send path checks this;
-- inbound STOP inserts, inbound START removes. number stored as raw E.164.

CREATE TABLE IF NOT EXISTS sms_opt_outs (
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  number     TEXT NOT NULL,                       -- the contact's number (E.164)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, number)
);

-- Service-role only (backend). Defense-in-depth: deny anon/publishable access.
ALTER TABLE sms_opt_outs ENABLE ROW LEVEL SECURITY;
