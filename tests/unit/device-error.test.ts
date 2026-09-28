import { describe, it, expect } from 'vitest';
import { describeDeviceError } from '../../src/shared/device-error';

describe('describeDeviceError', () => {
  it('never renders the literal "undefined"', () => {
    for (const bad of [undefined, null, 'undefined', '', {}, { message: undefined }, { message: 'undefined' }]) {
      const msg = describeDeviceError(bad);
      expect(msg).not.toMatch(/^undefined$/);
      expect(msg).toContain('Twilio');
    }
  });

  it('maps known Twilio codes to plain English', () => {
    expect(describeDeviceError({ code: 20005, message: 'Account not active' })).toMatch(/not active/);
    expect(describeDeviceError({ code: 31401 })).toMatch(/Microphone/);
    expect(describeDeviceError({ code: '20101' })).toMatch(/calling token/);
  });

  it('keeps a real message and appends an unknown code', () => {
    expect(describeDeviceError(new Error('Token mint failed: 500 Internal'))).toBe('Token mint failed: 500 Internal');
    expect(describeDeviceError({ code: 53405, message: 'Media failed' })).toBe('Media failed (Twilio 53405)');
  });
});
