-- Migration: credit ledger settle/refund serialization + transcription reaper.
-- Idempotent (CREATE OR REPLACE only — no table or data changes). Apply in the
-- Supabase SQL editor. Safe to run before or after the backend deploys: function
-- names, arguments and return types are unchanged.
--
-- 1. settle_credits / refund_credits take a row lock on the reservation before
--    reading its status, so two concurrent calls for the same reservation are
--    serialized and the second is a no-op. The only change to each function is
--    `FOR UPDATE` on the reservation SELECT.
-- 2. reap_stale_reservations keeps the hold of a transcription window that was
--    never settled (its token was delivered, so the window counts as used) and
--    refunds every other stale reservation as before.

-- ─────────────────────────────────────────────────────────────────────────────
-- settle_credits — finalize a reservation to actual cost.
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

  -- Row lock: a concurrent settle/refund of this reservation waits here, then
  -- sees the updated status below.
  SELECT * INTO v_res FROM credit_ledger
   WHERE request_id = p_request_id AND kind = 'reservation'
   FOR UPDATE;
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
-- refund_credits — reverse a reservation, MINUS any vendor cost actually incurred.
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
  -- Row lock: see settle_credits.
  SELECT * INTO v_res FROM credit_ledger
   WHERE request_id = p_request_id AND kind = 'reservation'
   FOR UPDATE;
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
-- reap_stale_reservations — close reservations stuck 'pending' past a threshold.
--   Transcription windows (model 'deepgram:…'): the token was delivered, so the
--   window is settled at its full hold.
--   Everything else (LLM calls whose instance died before settle/refund): the
--   hold is refunded, as before.
-- settle/refund are idempotent on reservation status, so this never double-acts.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION reap_stale_reservations(p_minutes INTEGER DEFAULT 30)
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE n INTEGER := 0; r RECORD;
BEGIN
  FOR r IN
    SELECT request_id, model, credits_delta FROM credit_ledger
    WHERE kind = 'reservation' AND status = 'pending'
      AND created_at < now() - make_interval(mins => p_minutes)
  LOOP
    IF r.model LIKE 'deepgram:%' THEN
      PERFORM settle_credits(r.request_id, -r.credits_delta, NULL, NULL);
    ELSE
      PERFORM refund_credits(r.request_id, 0, NULL);
    END IF;
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;
