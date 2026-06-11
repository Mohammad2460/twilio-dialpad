-- Migration: managed-AI credits (Phase 8 / v2). Idempotent. Apply in Supabase SQL editor.
--
-- Model:
--   pricing_config  — versioned vendor rates + caps + allotments (config, not constants).
--   credit_buckets  — the AUTHORITATIVE spendable balance, split by expiry bucket.
--                     A user's balance = SUM(remaining) over non-expired buckets.
--   credit_ledger   — append-only audit trail of every mutation (grant/topup/
--                     reservation/settlement/refund/expiry), idempotency-keyed.
--
-- All spend/settle/refund/grant logic lives in plpgsql functions that take a
-- row-level lock on the user's buckets (FOR UPDATE) so concurrent requests can
-- never oversell. Backend uses the service role (bypasses RLS); RLS is enabled
-- as defense-in-depth to deny anon/publishable-key access.
--
-- 1 credit = $0.01 face value. Credits are integers.

-- ─────────────────────────────────────────────────────────────────────────────
-- Tables
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pricing_config (
  version     INTEGER PRIMARY KEY,
  config      JSONB NOT NULL,
  active      BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- At most one active version.
CREATE UNIQUE INDEX IF NOT EXISTS pricing_config_one_active
  ON pricing_config (active) WHERE active;

CREATE TABLE IF NOT EXISTS credit_buckets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('grant','topup')),
  remaining   INTEGER NOT NULL CHECK (remaining >= 0),
  expires_at  TIMESTAMPTZ,            -- NULL = never expires
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Spend order: soonest-expiring first (NULLs last), then oldest.
CREATE INDEX IF NOT EXISTS credit_buckets_spend_order
  ON credit_buckets (user_id, expires_at NULLS LAST, created_at);

CREATE TABLE IF NOT EXISTS credit_ledger (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind             TEXT NOT NULL CHECK (kind IN
                     ('grant','topup','reservation','settlement','refund','expiry')),
  credits_delta    INTEGER NOT NULL,        -- negative = credits removed from spendable
  balance_after    INTEGER NOT NULL,        -- user's spendable balance after this row
  request_id       UUID,                    -- groups reservation+settlement+refund
  idempotency_key  TEXT UNIQUE,             -- dedupes client/webhook retries
  model            TEXT,
  vendor_cost_usd  NUMERIC(12,6),
  pricing_version  INTEGER REFERENCES pricing_config(version),
  status           TEXT,                    -- pending|settled|refunded (reservations)
  allocations      JSONB,                   -- [{bucket_id, amount}] a reservation drew from
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS credit_ledger_user_idx ON credit_ledger (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS credit_ledger_request_idx ON credit_ledger (request_id);

ALTER TABLE pricing_config  ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_buckets  ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_ledger   ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- Helper: current spendable balance (non-expired buckets). Caller may hold locks.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION credit_balance(p_user UUID)
RETURNS INTEGER
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(SUM(remaining), 0)::int
  FROM credit_buckets
  WHERE user_id = p_user
    AND remaining > 0
    AND (expires_at IS NULL OR expires_at > now());
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- grant_credits — add a grant/topup bucket + ledger row. Idempotent on key.
-- Returns the resulting spendable balance.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION grant_credits(
  p_user        UUID,
  p_amount      INTEGER,
  p_kind        TEXT,            -- 'grant' or 'topup'
  p_expires_at  TIMESTAMPTZ,
  p_idem_key    TEXT,
  p_pricing_ver INTEGER DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql AS $$
DECLARE
  v_existing INTEGER;
  v_balance  INTEGER;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'grant amount must be positive';
  END IF;
  IF p_kind NOT IN ('grant','topup') THEN
    RAISE EXCEPTION 'invalid grant kind %', p_kind;
  END IF;

  -- Idempotency: if this key already applied, return current balance unchanged.
  SELECT 1 INTO v_existing FROM credit_ledger WHERE idempotency_key = p_idem_key;
  IF FOUND THEN
    RETURN credit_balance(p_user);
  END IF;

  -- Lock the user's buckets so balance_after is consistent under concurrency.
  PERFORM 1 FROM credit_buckets WHERE user_id = p_user FOR UPDATE;

  INSERT INTO credit_buckets (user_id, kind, remaining, expires_at)
  VALUES (p_user, p_kind, p_amount, p_expires_at);

  v_balance := credit_balance(p_user);

  -- Ledger is audit-only; bucket expiry lives on credit_buckets, not here.
  INSERT INTO credit_ledger
    (user_id, kind, credits_delta, balance_after, idempotency_key, pricing_version, status)
  VALUES
    (p_user, p_kind, p_amount, v_balance, p_idem_key, p_pricing_ver, 'settled');

  RETURN v_balance;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- reserve_credits — atomically hold p_amount credits, soonest-expiry-first.
-- Rejects if insufficient. Idempotent on key (returns prior request_id).
-- Returns the reservation's request_id.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION reserve_credits(
  p_user        UUID,
  p_amount      INTEGER,
  p_idem_key    TEXT,
  p_model       TEXT DEFAULT NULL,
  p_pricing_ver INTEGER DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql AS $$
DECLARE
  v_existing_req UUID;
  v_available    INTEGER;
  v_need         INTEGER := p_amount;
  v_take         INTEGER;
  v_alloc        JSONB := '[]'::jsonb;
  v_request_id   UUID := gen_random_uuid();
  v_balance      INTEGER;
  r              RECORD;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'reserve amount must be positive';
  END IF;

  -- Idempotency: replay returns the original reservation's request_id.
  SELECT request_id INTO v_existing_req
  FROM credit_ledger WHERE idempotency_key = p_idem_key;
  IF FOUND THEN
    RETURN v_existing_req;
  END IF;

  -- Lock all of this user's buckets for the duration of the txn.
  PERFORM 1 FROM credit_buckets WHERE user_id = p_user FOR UPDATE;

  SELECT credit_balance(p_user) INTO v_available;
  IF v_available < p_amount THEN
    RAISE EXCEPTION 'insufficient_credits: have %, need %', v_available, p_amount
      USING ERRCODE = 'P0001';
  END IF;

  -- Draw down soonest-expiring non-expired buckets first.
  FOR r IN
    SELECT id, remaining FROM credit_buckets
    WHERE user_id = p_user
      AND remaining > 0
      AND (expires_at IS NULL OR expires_at > now())
    ORDER BY expires_at NULLS LAST, created_at
  LOOP
    EXIT WHEN v_need <= 0;
    v_take := LEAST(v_need, r.remaining);
    UPDATE credit_buckets SET remaining = remaining - v_take WHERE id = r.id;
    v_alloc := v_alloc || jsonb_build_object('bucket_id', r.id, 'amount', v_take);
    v_need := v_need - v_take;
  END LOOP;

  v_balance := credit_balance(p_user);

  INSERT INTO credit_ledger
    (user_id, kind, credits_delta, balance_after, request_id, idempotency_key,
     model, pricing_version, status, allocations)
  VALUES
    (p_user, 'reservation', -p_amount, v_balance, v_request_id, p_idem_key,
     p_model, p_pricing_ver, 'pending', v_alloc);

  RETURN v_request_id;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- settle_credits — finalize a reservation to actual cost.
--   p_actual_credits  = real credits owed (from real vendor usage).
--   Surplus (reserved > actual) is returned to the buckets we drew from
--   (those still alive); shortfall (actual > reserved) is deducted soonest-first.
-- Idempotent: a reservation already settled/refunded is a no-op.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION settle_credits(
  p_request_id   UUID,
  p_actual_credits INTEGER,
  p_vendor_cost  NUMERIC DEFAULT NULL,
  p_model        TEXT DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql AS $$
DECLARE
  v_res      RECORD;
  v_reserved INTEGER;
  v_delta    INTEGER;          -- positive = refund surplus, negative = extra charge
  v_need     INTEGER;
  v_take     INTEGER;
  v_balance  INTEGER;
  a          JSONB;
  r          RECORD;
BEGIN
  IF p_actual_credits < 0 THEN
    RAISE EXCEPTION 'actual credits cannot be negative';
  END IF;

  SELECT * INTO v_res FROM credit_ledger
   WHERE request_id = p_request_id AND kind = 'reservation';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no reservation for request %', p_request_id;
  END IF;
  IF v_res.status <> 'pending' THEN
    RETURN credit_balance(v_res.user_id);   -- already settled/refunded
  END IF;

  PERFORM 1 FROM credit_buckets WHERE user_id = v_res.user_id FOR UPDATE;

  v_reserved := -v_res.credits_delta;       -- reservation stored negative
  v_delta := v_reserved - p_actual_credits;

  IF v_delta > 0 THEN
    -- Refund surplus back into the buckets we took from (skip dead/missing ones).
    v_need := v_delta;
    FOR a IN SELECT * FROM jsonb_array_elements(COALESCE(v_res.allocations,'[]'::jsonb))
    LOOP
      EXIT WHEN v_need <= 0;
      SELECT * INTO r FROM credit_buckets
        WHERE id = (a->>'bucket_id')::uuid
          AND (expires_at IS NULL OR expires_at > now());
      IF FOUND THEN
        v_take := LEAST(v_need, (a->>'amount')::int);
        UPDATE credit_buckets SET remaining = remaining + v_take WHERE id = r.id;
        v_need := v_need - v_take;
      END IF;
    END LOOP;
    -- Any surplus tied to expired buckets is forfeit (already past validity).
  ELSIF v_delta < 0 THEN
    -- Extra charge: deduct the shortfall soonest-expiry-first. May underflow to
    -- zero available (we never push a bucket below 0); residual is absorbed.
    v_need := -v_delta;
    FOR r IN
      SELECT id, remaining FROM credit_buckets
      WHERE user_id = v_res.user_id AND remaining > 0
        AND (expires_at IS NULL OR expires_at > now())
      ORDER BY expires_at NULLS LAST, created_at
    LOOP
      EXIT WHEN v_need <= 0;
      v_take := LEAST(v_need, r.remaining);
      UPDATE credit_buckets SET remaining = remaining - v_take WHERE id = r.id;
      v_need := v_need - v_take;
    END LOOP;
  END IF;

  UPDATE credit_ledger SET status = 'settled' WHERE request_id = p_request_id AND kind = 'reservation';

  v_balance := credit_balance(v_res.user_id);
  INSERT INTO credit_ledger
    (user_id, kind, credits_delta, balance_after, request_id, model, vendor_cost_usd, status)
  VALUES
    (v_res.user_id, 'settlement', v_delta, v_balance, p_request_id,
     COALESCE(p_model, v_res.model), p_vendor_cost, 'settled');

  RETURN v_balance;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- refund_credits — reverse a reservation, MINUS any vendor cost actually
-- incurred (a partial generation still costs us). p_incurred_credits is the
-- non-refundable portion. Idempotent on reservation status.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION refund_credits(
  p_request_id      UUID,
  p_incurred_credits INTEGER DEFAULT 0,
  p_vendor_cost     NUMERIC DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql AS $$
DECLARE
  v_res      RECORD;
  v_reserved INTEGER;
  v_refund   INTEGER;
  v_need     INTEGER;
  v_take     INTEGER;
  v_balance  INTEGER;
  a          JSONB;
  r          RECORD;
BEGIN
  SELECT * INTO v_res FROM credit_ledger
   WHERE request_id = p_request_id AND kind = 'reservation';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no reservation for request %', p_request_id;
  END IF;
  IF v_res.status <> 'pending' THEN
    RETURN credit_balance(v_res.user_id);
  END IF;

  PERFORM 1 FROM credit_buckets WHERE user_id = v_res.user_id FOR UPDATE;

  v_reserved := -v_res.credits_delta;
  v_refund := GREATEST(v_reserved - GREATEST(p_incurred_credits, 0), 0);

  -- Return the refundable portion to the buckets we drew from (skip dead ones).
  v_need := v_refund;
  FOR a IN SELECT * FROM jsonb_array_elements(COALESCE(v_res.allocations,'[]'::jsonb))
  LOOP
    EXIT WHEN v_need <= 0;
    SELECT * INTO r FROM credit_buckets
      WHERE id = (a->>'bucket_id')::uuid
        AND (expires_at IS NULL OR expires_at > now());
    IF FOUND THEN
      v_take := LEAST(v_need, (a->>'amount')::int);
      UPDATE credit_buckets SET remaining = remaining + v_take WHERE id = r.id;
      v_need := v_need - v_take;
    END IF;
  END LOOP;

  UPDATE credit_ledger SET status = 'refunded' WHERE request_id = p_request_id AND kind = 'reservation';

  v_balance := credit_balance(v_res.user_id);
  INSERT INTO credit_ledger
    (user_id, kind, credits_delta, balance_after, request_id, vendor_cost_usd, status)
  VALUES
    (v_res.user_id, 'refund', v_refund, v_balance, p_request_id, p_vendor_cost, 'settled');

  RETURN v_balance;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- expire_credits — zero out expired grant/topup buckets, ledger an 'expiry' row
-- per affected user. Run on a schedule (cron). Idempotent: only acts on buckets
-- still holding remaining > 0 past expiry.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION expire_credits()
RETURNS INTEGER
LANGUAGE plpgsql AS $$
DECLARE
  v_total_expired INTEGER := 0;
  u               RECORD;
  v_sum           INTEGER;
  v_balance       INTEGER;
BEGIN
  FOR u IN
    SELECT DISTINCT user_id FROM credit_buckets
    WHERE remaining > 0 AND expires_at IS NOT NULL AND expires_at <= now()
  LOOP
    PERFORM 1 FROM credit_buckets WHERE user_id = u.user_id FOR UPDATE;

    SELECT COALESCE(SUM(remaining),0) INTO v_sum FROM credit_buckets
      WHERE user_id = u.user_id AND remaining > 0
        AND expires_at IS NOT NULL AND expires_at <= now();

    IF v_sum > 0 THEN
      UPDATE credit_buckets SET remaining = 0
        WHERE user_id = u.user_id AND remaining > 0
          AND expires_at IS NOT NULL AND expires_at <= now();

      v_balance := credit_balance(u.user_id);
      INSERT INTO credit_ledger
        (user_id, kind, credits_delta, balance_after, status)
      VALUES
        (u.user_id, 'expiry', -v_sum, v_balance, 'settled');

      v_total_expired := v_total_expired + v_sum;
    END IF;
  END LOOP;
  RETURN v_total_expired;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- reap_stale_reservations — refund reservations stuck 'pending' past a threshold
-- (serverless instance died after reserve but before settle/refund). refund is
-- idempotent on reservation status, so this never double-refunds. Run on a cron.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION reap_stale_reservations(p_minutes INTEGER DEFAULT 30)
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE n INTEGER := 0; r RECORD;
BEGIN
  FOR r IN
    SELECT request_id FROM credit_ledger
    WHERE kind = 'reservation' AND status = 'pending'
      AND created_at < now() - make_interval(mins => p_minutes)
  LOOP
    PERFORM refund_credits(r.request_id, 0, NULL);
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Seed pricing_config v1 (P8.0 safe conservative defaults — VERIFY vendor rates
-- live at build; tune N + free_grant from real burn post-launch).
-- Rates are USD per 1M tokens (LLM) / USD per minute per channel (Deepgram).
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO pricing_config (version, config, active)
VALUES (1, jsonb_build_object(
  'markup', 3,
  'min_charge', 1,                  -- credits
  'monthly_grant', 1000,            -- N: Pro monthly allotment (tune from data)
  'free_grant', 50,                 -- free-tier taste grant (tight, bounds abuse)
  'topup_expiry_months', 12,
  'transcription_channels', 1,      -- mono default (½ COGS); flip to 2 for stereo
  'caps', jsonb_build_object('max_input_tokens', 60000, 'max_output_tokens', 4000),
  'llm', jsonb_build_object(
    -- gpt-5-mini is the only free-tier model; cache_write unused for OpenAI (set = in).
    'gpt-5-mini',        jsonb_build_object('in', 0.25, 'out', 2.0,  'cache_write', 0.25, 'cache_read', 0.025),
    'claude-haiku-4-5',  jsonb_build_object('in', 1.0,  'out', 5.0,  'cache_write', 1.25, 'cache_read', 0.10),
    'claude-sonnet-4-6', jsonb_build_object('in', 3.0,  'out', 15.0, 'cache_write', 3.75, 'cache_read', 0.30),
    'claude-opus-4-8',   jsonb_build_object('in', 5.0,  'out', 25.0, 'cache_write', 6.25, 'cache_read', 0.50)
  ),
  'deepgram', jsonb_build_object(
    'nova-3', jsonb_build_object('per_min', 0.0077),
    'nova-2', jsonb_build_object('per_min', 0.0058)
  )
), true)
ON CONFLICT (version) DO NOTHING;
