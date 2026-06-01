import { create } from 'zustand';
import { storage } from '@shared/storage';
import type { DialerQueueItem, DialerOutcome, DialerItemStatus } from '@shared/types';

/** Default daily call cap — guardrail against accidental TCPA-tier mass dialing. */
export const DEFAULT_DAILY_CAP = 100;

interface DialerStore {
  queue: DialerQueueItem[];
  index: number;
  dailyCount: number;
  dailyDate: string;
  dncList: string[];
  hydrated: boolean;

  /** Refresh entire store from chrome.storage.local — call on side-panel mount. */
  hydrate: () => Promise<void>;

  /** Replace queue + reset index. Persists. */
  setQueue: (items: DialerQueueItem[]) => Promise<void>;

  /** Append items to existing queue (skips dups by number). Persists. */
  appendToQueue: (items: DialerQueueItem[]) => Promise<DialerQueueItem[]>;

  /** Move pointer. Persists. */
  setIndex: (i: number) => Promise<void>;

  /** Update status of an item by id. Persists. */
  patchItem: (id: string, patch: Partial<DialerQueueItem>) => Promise<void>;

  /** Mark item as done + record CallSid. Used when call finishes. */
  markDone: (id: string, callSid: string | undefined, status: DialerItemStatus) => Promise<void>;

  /** Set outcome (interested / callback / no_answer / do_not_call). */
  setOutcome: (id: string, outcome: DialerOutcome) => Promise<void>;

  /** Clear queue + pointer. */
  clear: () => Promise<void>;

  /** DNC helpers. */
  addDnc: (number: string) => Promise<void>;
  removeDnc: (number: string) => Promise<void>;

  /** Increment daily counter — call right before each programmatic dial. */
  bumpDailyCount: () => Promise<{ date: string; count: number }>;
}

export const useDialerStore = create<DialerStore>((set, get) => ({
  queue: [],
  index: 0,
  dailyCount: 0,
  dailyDate: '',
  dncList: [],
  hydrated: false,

  async hydrate() {
    const [queue, index, dailyCount, dncList] = await Promise.all([
      storage.getDialerQueue(),
      storage.getDialerIndex(),
      storage.getDialerDailyCount(),
      storage.getDncList(),
    ]);
    set({
      queue,
      index: Math.min(index, Math.max(queue.length - 1, 0)),
      dailyCount: dailyCount.count,
      dailyDate: dailyCount.date,
      dncList,
      hydrated: true,
    });
  },

  async setQueue(items) {
    await storage.setDialerQueue(items);
    await storage.setDialerIndex(0);
    set({ queue: items, index: 0 });
  },

  async appendToQueue(newItems) {
    const existing = get().queue;
    const existingNumbers = new Set(existing.map((i) => i.number));
    const filtered = newItems.filter((i) => !existingNumbers.has(i.number));
    const merged = [...existing, ...filtered];
    await storage.setDialerQueue(merged);
    set({ queue: merged });
    return filtered;
  },

  async setIndex(i) {
    await storage.setDialerIndex(i);
    set({ index: i });
  },

  async patchItem(id, patch) {
    const next = get().queue.map((it) => (it.id === id ? { ...it, ...patch } : it));
    await storage.setDialerQueue(next);
    set({ queue: next });
  },

  async markDone(id, callSid, status) {
    await get().patchItem(id, { status, callSid, endedAt: Date.now() });
  },

  async setOutcome(id, outcome) {
    const item = get().queue.find((i) => i.id === id);
    if (!item) return;
    await get().patchItem(id, { outcome });
    if (outcome === 'do_not_call') {
      await get().addDnc(item.number);
    }
  },

  async clear() {
    await storage.clearDialerQueue();
    await storage.setDialerIndex(0);
    set({ queue: [], index: 0 });
  },

  async addDnc(number) {
    const list = await storage.addToDnc(number);
    set({ dncList: list });
  },

  async removeDnc(number) {
    const list = await storage.removeFromDnc(number);
    set({ dncList: list });
  },

  async bumpDailyCount() {
    const next = await storage.incrementDialerDailyCount();
    set({ dailyCount: next.count, dailyDate: next.date });
    return next;
  },
}));
