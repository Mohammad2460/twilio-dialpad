-- Migration: call recordings (Phase 5c). Run via Supabase SQL editor. Idempotent.
-- Media lives in the private Storage bucket 'recordings'; this table is metadata.

CREATE TABLE IF NOT EXISTS recordings (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  call_sid       TEXT,
  recording_sid  TEXT UNIQUE,
  storage_path   TEXT NOT NULL,
  duration_sec   INTEGER,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  delete_after   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS recordings_user_idx ON recordings(user_id, created_at DESC);
ALTER TABLE recordings ENABLE ROW LEVEL SECURITY;

-- Private bucket for the audio (service-role access only).
INSERT INTO storage.buckets (id, name, public)
VALUES ('recordings', 'recordings', false)
ON CONFLICT (id) DO NOTHING;
