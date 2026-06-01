-- Migration: add identity columns to users table
-- Run via Supabase SQL editor on linked project.
-- Adds email + name (captured from Dodo webhook) + twilio_account_sid (dedup key
-- to prevent trial bypass via reinstall).

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS name TEXT,
  ADD COLUMN IF NOT EXISTS twilio_account_sid TEXT;

-- Unique partial index — only one user per Twilio account.
-- Partial so existing rows without a SID don't conflict on backfill.
CREATE UNIQUE INDEX IF NOT EXISTS users_twilio_account_sid_idx
  ON users(twilio_account_sid)
  WHERE twilio_account_sid IS NOT NULL;

-- Lookup by email (for customer support).
CREATE INDEX IF NOT EXISTS users_email_idx
  ON users(email)
  WHERE email IS NOT NULL;
