import { describe, it, expect } from 'vitest';
import {
  usdToCredits,
  costFromAnthropicUsage,
  costFromDeepgramMinutes,
  estimateLlmCredits,
  enforceLlmCaps,
  CapExceededError,
  type PricingConfig,
} from '../lib/pricing';

// Mirror of seeded pricing_config v1 (safe defaults). Pure-function tests only —
// no DB. The ledger/concurrency/idempotency/expiry behavior lives in plpgsql and
// is covered against a real Postgres (Supabase branch), not here.
const P: PricingConfig = {
  version: 1,
  markup: 3,
  min_charge: 1,
  monthly_grant: 1000,
  free_grant: 50,
  topup_expiry_months: 12,
  transcription_channels: 1,
  caps: { max_input_tokens: 60000, max_output_tokens: 4000 },
  llm: {
    'claude-haiku-4-5': { in: 1.0, out: 5.0, cache_write: 1.25, cache_read: 0.1 },
    'claude-sonnet-4-6': { in: 3.0, out: 15.0, cache_write: 3.75, cache_read: 0.3 },
    'claude-opus-4-8': { in: 5.0, out: 25.0, cache_write: 6.25, cache_read: 0.5 },
  },
  deepgram: { 'nova-3': { per_min: 0.0077 }, 'nova-2': { per_min: 0.0058 } },
};

describe('usdToCredits', () => {
  it('applies 3x markup and $0.01/credit, rounding up', () => {
    // $0.02 real → ceil(0.02 * 3 * 100) = 6 credits
    expect(usdToCredits(0.02, P)).toBe(6);
  });
  it('enforces MIN_CHARGE for sub-cent costs', () => {
    expect(usdToCredits(0.0001, P)).toBe(P.min_charge); // ceil(0.03)=1 anyway, but floor holds
    expect(usdToCredits(0, P)).toBe(P.min_charge);
  });
});

describe('costFromAnthropicUsage', () => {
  it('sums input/output/cache tokens at per-model rates (per 1M)', () => {
    // Haiku 5k in + 1k out = 5000*1 + 1000*5 = 10000 /1e6 = $0.010
    const usd = costFromAnthropicUsage(
      { input_tokens: 5000, output_tokens: 1000 },
      'claude-haiku-4-5',
      P,
    );
    expect(usd).toBeCloseTo(0.01, 6);
    expect(usdToCredits(usd, P)).toBe(3); // ceil(0.01*3*100)=3
  });
  it('includes cache-write and cache-read tokens', () => {
    const usd = costFromAnthropicUsage(
      { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 1_000_000, cache_read_input_tokens: 1_000_000 },
      'claude-haiku-4-5',
      P,
    );
    // 1.25 + 0.10 = $1.35
    expect(usd).toBeCloseTo(1.35, 6);
  });
  it('prices Opus higher than Sonnet higher than Haiku for identical usage', () => {
    const u = { input_tokens: 5000, output_tokens: 1000 };
    const h = costFromAnthropicUsage(u, 'claude-haiku-4-5', P);
    const s = costFromAnthropicUsage(u, 'claude-sonnet-4-6', P);
    const o = costFromAnthropicUsage(u, 'claude-opus-4-8', P);
    expect(h).toBeLessThan(s);
    expect(s).toBeLessThan(o);
  });
  it('throws on an unknown model', () => {
    expect(() => costFromAnthropicUsage({ input_tokens: 1 }, 'gpt-x', P)).toThrow();
  });
});

describe('costFromDeepgramMinutes', () => {
  it('mono (1 channel) costs half of stereo for the same minutes', () => {
    const mono = costFromDeepgramMinutes(3, 'nova-3', { ...P, transcription_channels: 1 });
    const stereo = costFromDeepgramMinutes(3, 'nova-3', { ...P, transcription_channels: 2 });
    expect(stereo).toBeCloseTo(mono * 2, 6);
    // 3 min mono nova-3 = 3 * 0.0077 = $0.0231
    expect(mono).toBeCloseTo(0.0231, 6);
  });
});

describe('estimateLlmCredits', () => {
  it('upper-bounds the hold using capped max output', () => {
    const est = estimateLlmCredits(5000, 'claude-haiku-4-5', P);
    // 5000*1 + 4000(out cap)*5 = 25000 /1e6 = $0.025 → ceil(0.025*3*100)=8
    expect(est).toBe(8);
  });
});

describe('enforceLlmCaps', () => {
  it('passes within caps', () => {
    expect(() => enforceLlmCaps(60000, 4000, P)).not.toThrow();
  });
  it('rejects over the input cap', () => {
    expect(() => enforceLlmCaps(60001, 4000, P)).toThrow(CapExceededError);
  });
  it('rejects over the output cap', () => {
    expect(() => enforceLlmCaps(100, 4001, P)).toThrow(CapExceededError);
  });
});
