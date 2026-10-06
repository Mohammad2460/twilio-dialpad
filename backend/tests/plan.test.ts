import { describe, it, expect } from 'vitest';
import {
  checkoutProduct,
  dayPeriod,
  hubspotAllowed,
  DEFAULT_CHECKOUT,
  DEFAULT_LIMITS,
  limitBody,
  monthPeriod,
  nextReset,
  parseCycle,
  planLimits,
  resolvePlan,
} from '../lib/plan';

const NOW = Date.parse('2026-10-04T12:00:00Z');
const at = (iso: string) => iso;

describe('resolvePlan', () => {
  it('open trial is Pro and reports days left', () => {
    const p = resolvePlan(
      { subscription_status: 'trialing', trial_ends_at: at('2026-10-09T12:00:00Z'), current_period_end: null },
      NOW,
    );
    expect(p).toMatchObject({ plan: 'pro', trialing: true, trialDaysLeft: 5, status: 'trialing' });
  });

  it('ended trial drops to Free, never locked', () => {
    const p = resolvePlan(
      { subscription_status: 'trialing', trial_ends_at: at('2026-10-03T12:00:00Z'), current_period_end: null },
      NOW,
    );
    expect(p).toMatchObject({ plan: 'free', trialing: false });
    expect(p.trialDaysLeft).toBeUndefined();
  });

  it('any paid subscription inside its period is Pro — no product is looked at', () => {
    for (const status of ['active', 'past_due', 'cancelled']) {
      const p = resolvePlan(
        { subscription_status: status, trial_ends_at: at('2026-01-01T00:00:00Z'), current_period_end: at('2026-11-03T00:00:00Z') },
        NOW,
      );
      expect(p.plan).toBe('pro');
      expect(p.trialing).toBe(false);
    }
  });

  it('a yearly subscriber stays Pro for the whole year', () => {
    const p = resolvePlan(
      { subscription_status: 'active', trial_ends_at: null, current_period_end: at('2027-10-01T00:00:00Z') },
      NOW,
    );
    expect(p.plan).toBe('pro');
  });

  it('paid period over, expired, or unknown status is Free', () => {
    expect(
      resolvePlan({ subscription_status: 'cancelled', trial_ends_at: null, current_period_end: at('2026-10-01T00:00:00Z') }, NOW).plan,
    ).toBe('free');
    expect(resolvePlan({ subscription_status: 'expired', trial_ends_at: null, current_period_end: null }, NOW).plan).toBe('free');
    expect(resolvePlan({ subscription_status: 'active', trial_ends_at: null, current_period_end: null }, NOW).plan).toBe('free');
    expect(resolvePlan({ subscription_status: 'weird', trial_ends_at: null, current_period_end: null }, NOW).plan).toBe('free');
  });
});

describe('planLimits', () => {
  it('uses the defaults when the config predates plan limits', () => {
    expect(planLimits({}, 'free')).toEqual(DEFAULT_LIMITS.free);
    expect(planLimits({}, 'pro')).toEqual(DEFAULT_LIMITS.pro);
  });

  it('reads limits from config, so they change without a release', () => {
    const cfg = { plans: { free: { transcribe_seconds: 3600, ai_questions: 30 }, pro: { connector_calls: null } } };
    expect(planLimits(cfg, 'free')).toEqual({
      transcribe_seconds: 3600,
      ai_questions: 30,
      summaries_per_day: DEFAULT_LIMITS.free.summaries_per_day,
      connector_calls: 5,
    });
    expect(planLimits(cfg, 'pro').connector_calls).toBeNull();
  });

  it('ignores junk values', () => {
    const cfg = { plans: { free: { ai_questions: -4, transcribe_seconds: Number.NaN } } };
    expect(planLimits(cfg, 'free')).toEqual(DEFAULT_LIMITS.free);
  });

  it('a limit of 0 is allowed (turns the feature off for that plan)', () => {
    expect(planLimits({ plans: { free: { ai_questions: 0 } } }, 'free').ai_questions).toBe(0);
  });
});

describe('checkout', () => {
  it('no plan parameter (older builds) is monthly', () => {
    expect(parseCycle(undefined)).toBe('monthly');
    expect(parseCycle('')).toBe('monthly');
    expect(parseCycle('lifetime')).toBe('monthly');
    expect(parseCycle('yearly')).toBe('yearly');
  });

  it('defaults to the new product names and prices', () => {
    expect(checkoutProduct({}, 'monthly')).toEqual({ name: 'Twilio Dialpad Pro Monthly', price_cents: 1900 });
    expect(checkoutProduct({}, 'yearly')).toEqual({ name: 'Twilio Dialpad Pro Yearly', price_cents: 18000 });
  });

  it('takes name and price from config together; a broken entry falls back', () => {
    const cfg = { checkout: { monthly: { name: 'Twilio Dialpad Pro Monthly v2', price_cents: 2400 }, yearly: { name: ' ', price_cents: 1 } } };
    expect(checkoutProduct(cfg, 'monthly')).toEqual({ name: 'Twilio Dialpad Pro Monthly v2', price_cents: 2400 });
    expect(checkoutProduct(cfg, 'yearly')).toEqual(DEFAULT_CHECKOUT.yearly);
    expect(checkoutProduct({ checkout: { monthly: { name: 'x', price_cents: 0 } } }, 'monthly')).toEqual(DEFAULT_CHECKOUT.monthly);
  });

  it('never names the existing products', () => {
    for (const p of Object.values(DEFAULT_CHECKOUT)) {
      expect(p.name).not.toBe('AI Twilio Dialer Pro');
      expect(p.name).not.toBe('AI Twilio Dialer Credits');
    }
  });
});

describe('periods (UTC)', () => {
  it('month period is the 1st; reset is the 1st of next month', () => {
    expect(monthPeriod(NOW)).toBe('2026-10-01');
    expect(nextReset(NOW)).toBe('2026-11-01T00:00:00.000Z');
    expect(dayPeriod(NOW)).toBe('2026-10-04');
  });

  it('rolls over the year', () => {
    const dec = Date.parse('2026-12-31T23:59:59Z');
    expect(monthPeriod(dec)).toBe('2026-12-01');
    expect(nextReset(dec)).toBe('2027-01-01T00:00:00.000Z');
  });

  it('the last second of a month and the first of the next are different periods', () => {
    expect(monthPeriod(Date.parse('2026-10-31T23:59:59Z'))).toBe('2026-10-01');
    expect(monthPeriod(Date.parse('2026-11-01T00:00:00Z'))).toBe('2026-11-01');
  });
});

describe('limitBody', () => {
  it('keeps the error code the store builds already handle, and says when it resets', () => {
    expect(limitBody('transcription', 'free', 1800, NOW)).toEqual({
      error: 'insufficient_credits',
      limit: 'transcription',
      plan: 'free',
      max: 1800,
      resetsAt: '2026-11-01T00:00:00.000Z',
    });
  });

  it('the daily summary cap carries no monthly reset date', () => {
    expect(limitBody('summaries', 'pro', 100, NOW).resetsAt).toBeUndefined();
  });
});

describe('HubSpot', () => {
  it('is Pro-only (trial counts as Pro through resolvePlan)', () => {
    expect(hubspotAllowed('pro')).toBe(true);
    expect(hubspotAllowed('free')).toBe(false);
  });
});
