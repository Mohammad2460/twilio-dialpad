import { describe, it, expect } from 'vitest';
import { entitlementsFromSubscription } from '../../src/shared/entitlements';
import type { Subscription } from '../../src/shared/cloud';

const sub = (s: Partial<Subscription>): Subscription => ({
  status: 'expired',
  hasAccess: false,
  ...s,
});

describe('entitlementsFromSubscription — light trial (paid vs trial)', () => {
  it('null subscription → free, no features', () => {
    const e = entitlementsFromSubscription(null);
    expect(e.tier).toBe('free');
    expect(e.isPro).toBe(false);
    expect(e.paid).toBe(false);
    expect(e.can('ai_analysis')).toBe(false);
    expect(e.can('sms')).toBe(false);
    expect(e.can('managed_transcription')).toBe(false);
  });

  it('trialing → managed_transcription only, NOT paid features', () => {
    const e = entitlementsFromSubscription(sub({ status: 'trialing', hasAccess: true, daysLeft: 5 }));
    expect(e.trialing).toBe(true);
    expect(e.paid).toBe(false);
    expect(e.daysLeft).toBe(5);
    expect(e.can('managed_transcription')).toBe(true);
    expect(e.can('sms')).toBe(false);
    expect(e.can('recording')).toBe(false);
    expect(e.can('ai_analysis')).toBe(false);
    expect(e.can('autodial_unlimited')).toBe(false);
  });

  it('active → paid, all features incl managed_transcription', () => {
    const e = entitlementsFromSubscription(sub({ status: 'active', hasAccess: true }));
    expect(e.paid).toBe(true);
    expect(e.trialing).toBe(false);
    expect(e.can('sms')).toBe(true);
    expect(e.can('recording')).toBe(true);
    expect(e.can('ai_analysis')).toBe(true);
    expect(e.can('managed_transcription')).toBe(true);
  });

  it('past_due WITH access → paid (grace before expiry)', () => {
    const e = entitlementsFromSubscription(sub({ status: 'past_due', hasAccess: true }));
    expect(e.paid).toBe(true);
    expect(e.can('sms')).toBe(true);
  });

  it('cancelled but still within period (hasAccess true) → paid', () => {
    const e = entitlementsFromSubscription(sub({ status: 'cancelled', hasAccess: true }));
    expect(e.paid).toBe(true);
    expect(e.can('recording')).toBe(true);
  });

  it('expired / no access → free, fail-closed', () => {
    const e = entitlementsFromSubscription(sub({ status: 'expired', hasAccess: false }));
    expect(e.tier).toBe('free');
    expect(e.paid).toBe(false);
    expect(e.trialing).toBe(false);
    expect(e.can('cloud_history')).toBe(false);
    expect(e.can('managed_transcription')).toBe(false);
  });
});
