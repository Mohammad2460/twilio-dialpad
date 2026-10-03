import { describe, it, expect } from 'vitest';
import {
  billableSeconds,
  isUuid,
  settleableModel,
  windowCharge,
  WINDOW_SECONDS,
  SETTLE_GRACE_SECONDS,
  type ReservationRow,
} from '../lib/transcribe-metering';
import { reservationKey } from '../lib/reservation-key';
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
