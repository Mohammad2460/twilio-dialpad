-- Migration: SMS messages (Phase 5). Run via Supabase SQL editor. Idempotent.
-- Stores inbound + outbound SMS for thread view. Idempotent on twilio_message_sid.

CREATE TABLE IF NOT EXISTS messages (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  direction          TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  from_number        TEXT NOT NULL,
  to_number          TEXT NOT NULL,
  body               TEXT NOT NULL,
  status             TEXT,
  twilio_message_sid TEXT UNIQUE,
  thread_key         TEXT NOT NULL,   -- remote number (the contact), for grouping
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_user_thread_idx ON messages(user_id, thread_key, created_at);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
