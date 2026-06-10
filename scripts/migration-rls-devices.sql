-- Migration: enable RLS on Phase 0b auth tables (defense-in-depth). Idempotent.
-- All backend access uses the service role (bypasses RLS); this denies any
-- anon/publishable-key access to secret hashes + encrypted configSecrets.
-- NOTE: apply manually in the Supabase SQL editor (production schema change).

ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_functions ENABLE ROW LEVEL SECURITY;
