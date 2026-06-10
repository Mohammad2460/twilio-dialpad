-- Migration: add email-consent + verification columns to users table
-- Run via Supabase SQL editor on linked project.
-- Idempotent: all ADD COLUMN IF NOT EXISTS.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_verified_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS product_email_consent_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS marketing_consent_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS email_verify_code_hash    VARCHAR(64),
  ADD COLUMN IF NOT EXISTS email_verify_expires_at   TIMESTAMPTZ;
