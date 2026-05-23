import { describe, it, expect } from 'vitest';
import { normalizeE164, isClientIdentity, formatForDisplay } from '../../src/shared/phone';

describe('normalizeE164', () => {
  it('parses US national number with default country', () => {
    const r = normalizeE164('(415) 555-1234', 'US');
    expect(r.ok).toBe(true);
    expect(r.e164).toBe('+14155551234');
    expect(r.country).toBe('US');
  });

  it('parses already-E.164', () => {
    const r = normalizeE164('+919876543210');
    expect(r.ok).toBe(true);
    expect(r.e164).toBe('+919876543210');
    expect(r.country).toBe('IN');
  });

  it('rejects empty input', () => {
    expect(normalizeE164('').ok).toBe(false);
  });

  it('rejects garbage', () => {
    expect(normalizeE164('hello').ok).toBe(false);
  });

  it('rejects too-short number', () => {
    expect(normalizeE164('123').ok).toBe(false);
  });
});

describe('isClientIdentity', () => {
  it('accepts safe identifiers', () => {
    expect(isClientIdentity('mohammad-laptop')).toBe(true);
    expect(isClientIdentity('alice_123')).toBe(true);
  });
  it('rejects numbers / E.164', () => {
    expect(isClientIdentity('+14155551234')).toBe(false);
    expect(isClientIdentity('1234')).toBe(false);
  });
  it('rejects empty / too long', () => {
    expect(isClientIdentity('')).toBe(false);
    expect(isClientIdentity('a'.repeat(200))).toBe(false);
  });
});

describe('formatForDisplay', () => {
  it('formats E.164 internationally', () => {
    expect(formatForDisplay('+14155551234')).toContain('415');
  });
  it('passes through non-parseable strings', () => {
    expect(formatForDisplay('not-a-number')).toBe('not-a-number');
  });
});
