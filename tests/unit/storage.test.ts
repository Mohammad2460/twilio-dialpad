import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock chrome.storage.local before importing storage
const data = new Map<string, unknown>();
const listeners: Array<(c: Record<string, chrome.storage.StorageChange>, area: string) => void> = [];

beforeEach(() => {
  data.clear();
  listeners.length = 0;
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
        remove: vi.fn(async (key: string) => { data.delete(key); }),
      },
      onChanged: {
        addListener: (l: (typeof listeners)[number]) => listeners.push(l),
        removeListener: (l: (typeof listeners)[number]) => {
          const i = listeners.indexOf(l);
          if (i >= 0) listeners.splice(i, 1);
        },
      },
    },
  };
});

describe('storage', () => {
  it('round-trips settings', async () => {
    const { storage } = await import('../../src/shared/storage');
    const s = {
      accountSid: 'AC' + 'a'.repeat(32),
      apiKeySid: 'SK' + 'a'.repeat(32),
      twimlAppSid: 'AP' + 'a'.repeat(32),
      functionUrl: 'https://x.twil.io',
      clientIdentity: 'dialpad',
      defaultCallerId: '+14155551234',
      configuredAt: 123,
    };
    await storage.setSettings(s);
    const got = await storage.getSettings();
    expect(got).toEqual(s);
  });

  it('returns null when no settings', async () => {
    const { storage } = await import('../../src/shared/storage');
    expect(await storage.getSettings()).toBeNull();
  });

  it('caps history at 20 entries', async () => {
    const { storage } = await import('../../src/shared/storage');
    for (let i = 0; i < 25; i++) {
      await storage.pushHistory({
        id: String(i),
        direction: 'out',
        number: '+1415555' + String(1000 + i),
        startedAt: i,
        durationSec: 5,
        status: 'completed',
      });
    }
    const h = await storage.getHistory();
    expect(h).toHaveLength(20);
    expect(h[0].id).toBe('24');
  });
});
