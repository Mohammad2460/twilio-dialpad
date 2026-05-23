import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';

export interface NormalizeResult {
  ok: boolean;
  e164?: string;
  national?: string;
  country?: CountryCode;
  reason?: string;
}

export function normalizeE164(input: string, defaultCountry: CountryCode = 'US'): NormalizeResult {
  const raw = input.trim();
  if (!raw) return { ok: false, reason: 'Empty input' };
  try {
    const parsed = parsePhoneNumberFromString(raw, defaultCountry);
    if (!parsed) return { ok: false, reason: 'Could not parse' };
    if (!parsed.isValid()) return { ok: false, reason: 'Invalid number' };
    return {
      ok: true,
      e164: parsed.number,
      national: parsed.formatNational(),
      country: parsed.country,
    };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'Parse error' };
  }
}

export function formatForDisplay(e164: string): string {
  const parsed = parsePhoneNumberFromString(e164);
  if (!parsed) return e164;
  return parsed.formatInternational();
}

export function isClientIdentity(input: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9_-]{0,120}$/.test(input) && !/^\+?\d/.test(input);
}
