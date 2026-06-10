import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock chrome.storage.local (same pattern as storage.test.ts).
const data = new Map<string, unknown>();
beforeEach(() => {
  data.clear();
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: vi.fn(async (key: string | string[]) => {
          if (typeof key === 'string') return { [key]: data.get(key) };
          const out: Record<string, unknown> = {};
          for (const k of key) out[k] = data.get(k);
          return out;
        }),
        set: vi.fn(async (obj: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(obj)) data.set(k, v);
        }),
        remove: vi.fn(async () => undefined),
      },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  };
});

const today = () => new Date().toLocaleDateString('en-CA');

describe('auto-dial daily cap', () => {
  it('starts at 0 with today’s date', async () => {
    const { storage } = await import('../../src/shared/storage');
    const c = await storage.getDialerDailyCount();
    expect(c.count).toBe(0);
    expect(c.date).toBe(today());
  });

  it('increments within the same day', async () => {
    const { storage } = await import('../../src/shared/storage');
    await storage.incrementDialerDailyCount();
    const c = await storage.incrementDialerDailyCount();
    expect(c.count).toBe(2);
    expect(c.date).toBe(today());
  });

  it('rolls over when the stored date is stale (yesterday → 0)', async () => {
    data.set('dialerDailyCount', { date: '2000-01-01', count: 99 });
    const { storage } = await import('../../src/shared/storage');
    const c = await storage.getDialerDailyCount();
    expect(c.count).toBe(0);
    expect(c.date).toBe(today());
  });

  it('increment after rollover starts fresh at 1', async () => {
    data.set('dialerDailyCount', { date: '2000-01-01', count: 99 });
    const { storage } = await import('../../src/shared/storage');
    const c = await storage.incrementDialerDailyCount();
    expect(c.count).toBe(1);
    expect(c.date).toBe(today());
  });
});
