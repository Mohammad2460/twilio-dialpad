import { describe, it, expect } from 'vitest';
import { MsgSchema } from '../../src/shared/messaging';

describe('MsgSchema', () => {
  it('accepts a well-formed call.start', () => {
    const r = MsgSchema.safeParse({ type: 'call.start', to: '+14155551234' });
    expect(r.success).toBe(true);
  });

  it('rejects call.start without to', () => {
    const r = MsgSchema.safeParse({ type: 'call.start' });
    expect(r.success).toBe(false);
  });

  it('rejects unknown type', () => {
    expect(MsgSchema.safeParse({ type: 'banana' }).success).toBe(false);
  });

  it('accepts device.state with no error', () => {
    expect(MsgSchema.safeParse({ type: 'device.state', state: 'registered' }).success).toBe(true);
  });

  it('rejects device.state with bad enum', () => {
    expect(MsgSchema.safeParse({ type: 'device.state', state: 'happy' }).success).toBe(false);
  });

  it('accepts call.dtmf with single digit', () => {
    expect(MsgSchema.safeParse({ type: 'call.dtmf', digit: '5' }).success).toBe(true);
  });

  it('rejects call.dtmf with multi-char', () => {
    expect(MsgSchema.safeParse({ type: 'call.dtmf', digit: '55' }).success).toBe(false);
  });
});
