import { describe, it, expect } from 'vitest';
import {
  billableSeconds,
  isUuid,
  reusableWindow,
  settleableModel,
  windowCharge,
  WINDOW_SECONDS,
  SETTLE_GRACE_SECONDS,
  RETRY_REUSE_SECONDS,
  type PendingWindowRow,
  type ReservationRow,
} from '../lib/transcribe-metering';
import { reservationKey, reservationKeyPrefix } from '../lib/reservation-key';
import { estimateTranscriptionCredits, type PricingConfig } from '../lib/pricing';

// Mirror of seeded pricing_config v1. Pure-function tests only — no DB.
const P: PricingConfig = {
  version: 1,
  markup: 3,
  min_charge: 1,
  monthly_grant: 1000,
  free_grant: 50,
  topup_expiry_months: 12,
  transcription_channels: 1,
  caps: { max_input_tokens: 60000, max_output_tokens: 4000 },
  llm: {},
  deepgram: { 'nova-3': { per_min: 0.0077 }, 'nova-2': { per_min: 0.0058 } },
};

const HOLD = estimateTranscriptionCredits(WINDOW_SECONDS / 60, 'nova-3', P); // 5

const row = (over: Partial<ReservationRow> = {}): ReservationRow => ({
  user_id: 'u1',
  model: 'deepgram:nova-3',
  status: 'pending',
  credits_delta: -HOLD,
  created_at: '2026-10-01T00:00:00.000Z',
  ...over,
});

describe('reservationKey', () => {
  it('is unique per call even for the same client key', () => {
    const a = reservationKey('transcribe', 'CA123:0');
    const b = reservationKey('transcribe', 'CA123:0');
    expect(a).not.toBe(b);
    expect(a.startsWith('transcribe:CA1230:')).toBe(true);
  });

  it('ignores unusable client keys', () => {
    expect(reservationKey('transcribe', undefined)).toMatch(/^transcribe:[0-9a-f-]{36}$/);
    expect(reservationKey('transcribe', { x: 1 })).toMatch(/^transcribe:[0-9a-f-]{36}$/);
    const long = reservationKey('transcribe', 'x'.repeat(500) + ' ;drop');
    expect(long.length).toBeLessThan(120);
    expect(long).not.toContain(' ');
  });
});

describe('reservationKeyPrefix', () => {
  it('prefixes every key built from the same client key', () => {
    const prefix = reservationKeyPrefix('transcribe', 'CA123:0');
    expect(prefix).toBe('transcribe:CA1230:');
    expect(reservationKey('transcribe', 'CA123:0').startsWith(prefix!)).toBe(true);
  });

  it('is null without a usable client key', () => {
    expect(reservationKeyPrefix('transcribe', undefined)).toBeNull();
    expect(reservationKeyPrefix('transcribe', '')).toBeNull();
    expect(reservationKeyPrefix('transcribe', ':: ::')).toBeNull();
    expect(reservationKeyPrefix('transcribe', 7)).toBeNull();
  });
});

describe('reusableWindow', () => {
  const NOW = Date.parse('2026-10-01T00:00:10.000Z');
  const PREFIX = reservationKeyPrefix('transcribe', 'CA123:0');
  const R1 = '5857edd8-b03c-4707-8164-f0ec36acbca7';
  const R2 = 'cf6119e4-9966-4544-be53-5523d4af4d16';
  const pending = (over: Partial<PendingWindowRow> = {}): PendingWindowRow => ({
    request_id: R1,
    idempotency_key: reservationKey('transcribe', 'CA123:0'),
    created_at: '2026-10-01T00:00:09.000Z',
    ...over,
  });

  it('hands a just-reserved window back to a retry with the same label', () => {
    expect(reusableWindow([pending()], PREFIX, NOW)).toBe(R1);
  });

  it('prefers the newest matching window', () => {
    const older = pending({ request_id: R2, created_at: '2026-10-01T00:00:01.000Z' });
    expect(reusableWindow([pending(), older], PREFIX, NOW)).toBe(R1);
  });

  it('does not reuse a window reserved under another label', () => {
    const other = pending({ idempotency_key: reservationKey('transcribe', 'CA123:1') });
    expect(reusableWindow([other], PREFIX, NOW)).toBeNull();
    // A longer label that merely starts the same is a different window.
    const longer = pending({ idempotency_key: reservationKey('transcribe', 'CA123:01') });
    expect(reusableWindow([longer], PREFIX, NOW)).toBeNull();
    expect(reusableWindow([pending({ idempotency_key: null })], PREFIX, NOW)).toBeNull();
    expect(reusableWindow([pending({ idempotency_key: 'freegrant:u1' })], PREFIX, NOW)).toBeNull();
  });

  it('does not reuse a window past the reuse period', () => {
    const old = new Date(NOW - (RETRY_REUSE_SECONDS + 1) * 1000).toISOString();
    expect(reusableWindow([pending({ created_at: old })], PREFIX, NOW)).toBeNull();
    expect(reusableWindow([pending({ created_at: 'not a date' })], PREFIX, NOW)).toBeNull();
    expect(reusableWindow([pending({ created_at: '2026-10-01T00:05:00.000Z' })], PREFIX, NOW)).toBeNull();
  });

  it('never reuses without a window label or rows', () => {
    expect(reusableWindow([pending()], null, NOW)).toBeNull();
    expect(reusableWindow(null, PREFIX, NOW)).toBeNull();
    expect(reusableWindow([], PREFIX, NOW)).toBeNull();
  });
});

describe('isUuid', () => {
  it('accepts a ledger request id and rejects everything else', () => {
    expect(isUuid('5857edd8-b03c-4707-8164-f0ec36acbca7')).toBe(true);
    expect(isUuid('5857edd8b03c47078164f0ec36acbca7')).toBe(false);
    expect(isUuid('')).toBe(false);
    expect(isUuid(null)).toBe(false);
    expect(isUuid(42)).toBe(false);
  });
});

describe('settleableModel', () => {
  it('returns the reserved model for the owner of a pending window', () => {
    expect(settleableModel(row(), 'u1')).toBe('nova-3');
    expect(settleableModel(row({ model: 'deepgram:nova-2' }), 'u1')).toBe('nova-2');
  });

  it('refuses a reservation that belongs to someone else', () => {
    expect(settleableModel(row(), 'u2')).toBeNull();
  });

  it('refuses a reservation that is no longer pending', () => {
    expect(settleableModel(row({ status: 'settled' }), 'u1')).toBeNull();
    expect(settleableModel(row({ status: 'refunded' }), 'u1')).toBeNull();
    expect(settleableModel(row({ status: null }), 'u1')).toBeNull();
  });

  it('refuses a reservation that is not a transcription window', () => {
    expect(settleableModel(row({ model: 'gpt-5-mini' }), 'u1')).toBeNull();
    expect(settleableModel(row({ model: null }), 'u1')).toBeNull();
    expect(settleableModel(row({ model: 'deepgram:' }), 'u1')).toBeNull();
  });

  it('refuses a missing row', () => {
    expect(settleableModel(null, 'u1')).toBeNull();
    expect(settleableModel(undefined, 'u1')).toBeNull();
  });
});

describe('billableSeconds', () => {
  const G = SETTLE_GRACE_SECONDS;

  it('bills what an honest client reports mid-window', () => {
    // Call ended 30s in; the settle request lands ~2s later.
    expect(billableSeconds(30, 32_000)).toBe(30);
  });

  it('bills a full window at rotation', () => {
    expect(billableSeconds(120, 121_500)).toBe(WINDOW_SECONDS);
  });

  it('never bills below the server clock, whatever the client reports', () => {
    expect(billableSeconds(0, 90_000)).toBe(90 - G);
    expect(billableSeconds(undefined, 90_000)).toBe(90 - G);
    expect(billableSeconds(-50, 90_000)).toBe(90 - G);
    expect(billableSeconds('0', 90_000)).toBe(90 - G);
    expect(billableSeconds(NaN, 90_000)).toBe(90 - G);
  });

  it('is free inside the grace period when nothing is reported', () => {
    expect(billableSeconds(0, 1_500)).toBe(0);
    expect(billableSeconds(undefined, G * 1000)).toBe(0);
  });

  it('caps at the window length', () => {
    expect(billableSeconds(1e9, 10_000)).toBe(WINDOW_SECONDS);
    expect(billableSeconds(0, 3_600_000)).toBe(WINDOW_SECONDS);
    expect(billableSeconds(Infinity, 10_000)).toBe(10 - G);
  });

  it('bills the whole window when the reservation clock is unreadable', () => {
    expect(billableSeconds(0, NaN)).toBe(WINDOW_SECONDS);
  });

  it('treats a clock that runs backwards as zero elapsed', () => {
    expect(billableSeconds(20, -5_000)).toBe(20);
  });
});

describe('windowCharge', () => {
  it('charges the full hold for a full window', () => {
    expect(windowCharge(WINDOW_SECONDS, 'nova-3', HOLD, P).credits).toBe(HOLD);
  });

  it('charges pro rata for a partial window, with the vendor cost', () => {
    // 30s nova-3 = 0.5 * 0.0077 = $0.00385 → ceil(1.155) = 2 credits
    const c = windowCharge(30, 'nova-3', HOLD, P);
    expect(c.credits).toBe(2);
    expect(c.usd).toBeCloseTo(0.00385, 6);
  });

  it('is free for zero seconds (no min charge)', () => {
    expect(windowCharge(0, 'nova-3', HOLD, P)).toEqual({ credits: 0, usd: 0 });
  });

  it('never charges more than the hold', () => {
    expect(windowCharge(1e9, 'nova-3', HOLD, P).credits).toBe(HOLD);
    expect(windowCharge(120, 'nova-3', 1, P).credits).toBe(1);
  });

  it('keeps the whole hold when the model has left the pricing config', () => {
    expect(windowCharge(10, 'nova-1', HOLD, P)).toEqual({ credits: HOLD, usd: null });
  });
});
