import { describe, it, expect } from 'vitest';
import { entitlementsFromSubscription } from '../../src/shared/entitlements';
import type { Subscription } from '../../src/shared/cloud';

const sub = (s: Partial<Subscription>): Subscription => ({
  status: 'expired',
  hasAccess: false,
  ...s,
});

describe('entitlementsFromSubscription', () => {
  it('null subscription → free, no Pro features', () => {
    const e = entitlementsFromSubscription(null);
    expect(e.tier).toBe('free');
    expect(e.isPro).toBe(false);
    expect(e.can('ai_analysis')).toBe(false);
    expect(e.can('sms')).toBe(false);
  });

  it('trialing WITH access → Pro (trial unlocks all) + trialing flag', () => {
    const e = entitlementsFromSubscription(sub({ status: 'trialing', hasAccess: true, daysLeft: 5 }));
    expect(e.isPro).toBe(true);
    expect(e.trialing).toBe(true);
    expect(e.daysLeft).toBe(5);
    expect(e.can('autodial_unlimited')).toBe(true);
    expect(e.can('recording')).toBe(true);
  });

  it('active → Pro, not trialing', () => {
    const e = entitlementsFromSubscription(sub({ status: 'active', hasAccess: true }));
    expect(e.isPro).toBe(true);
    expect(e.trialing).toBe(false);
  });

  it('past_due WITH access → Pro (grace before expiry)', () => {
    const e = entitlementsFromSubscription(sub({ status: 'past_due', hasAccess: true }));
    expect(e.isPro).toBe(true);
  });

  it('expired / no access → free, fail-closed', () => {
    const e = entitlementsFromSubscription(sub({ status: 'expired', hasAccess: false }));
    expect(e.tier).toBe('free');
    expect(e.can('cloud_history')).toBe(false);
  });

  it('cancelled but still within period (hasAccess true) → Pro', () => {
    const e = entitlementsFromSubscription(sub({ status: 'cancelled', hasAccess: true }));
    expect(e.isPro).toBe(true);
  });
});
