import { z } from 'zod';
import type { CallRecord, DialerQueueItem, Settings } from './types';

const SettingsSchema = z.object({
  accountSid: z.string().regex(/^AC[a-zA-Z0-9]{32}$/),
  // Legacy (per-user Twilio Function) installs carry real values here; backend-voice
  // installs leave them empty ('') since the API key / TwiML app / webhook live
  // server-side. Accept either: valid format OR empty string.
  apiKeySid: z.string().regex(/^SK[a-zA-Z0-9]{32}$/).or(z.literal('')),
  twimlAppSid: z.string().regex(/^AP[a-zA-Z0-9]{32}$/).or(z.literal('')),
  functionUrl: z.string().url().or(z.literal('')),
  clientIdentity: z.string().min(1).max(121),
  defaultCallerId: z.string().min(1),
  configuredAt: z.number(),

  /** True for installs provisioned on the backend (no per-user Twilio Function). */
  backendVoice: z.boolean().optional(),

  // V1.1 optional fields — never required so existing V0 installs still parse.
  serviceSid: z.string().regex(/^ZS[a-zA-Z0-9]{32}$/).optional(),
  environmentSid: z.string().regex(/^ZE[a-zA-Z0-9]{32}$/).optional(),
  configSecret: z.string().min(8).optional(),
  hubspotToken: z.string().min(1).optional(),
  hubspotPortalId: z.string().min(1).optional(),
  deepgramApiKey: z.string().min(1).optional(),
  deepgramModel: z.string().min(1).optional(),
  /** Managed transcription (P8.3): use our Deepgram key, metered by credits,
   * instead of BYO. Opt-in; default off (BYO stays the default). */
  managedTranscription: z.boolean().optional(),
  transcriptFolderConfigured: z.boolean().optional(),
  incomingEnabled: z.boolean().optional(),
  forwardEnabled: z.boolean().optional(),
  forwardNumber: z.string().optional(),

  // v1a — extension prefs + recording (all optional, back-compat with older installs).
  clickToCallEnabled: z.boolean().optional(),
  floatingIconEnabled: z.boolean().optional(),
  smartCopyEnabled: z.boolean().optional(),
  lastCalledNumber: z.string().optional(),
  recordOutgoing: z.boolean().optional(),
  recordIncoming: z.boolean().optional(),
  recordingConsentAck: z.boolean().optional(),
  // True once provisionMessagingAddon() has deployed the SMS + recording-status
  // (+ delete-recording) Functions and set RECORDING_CALLBACK. Recording can't be
  // enabled before this — otherwise Twilio records with no ingest callback.
  messagingProvisioned: z.boolean().optional(),
});

const CallRecordSchema = z.object({
  id: z.string(),
  sid: z.string().optional(),
  direction: z.enum(['in', 'out']),
  number: z.string(),
  startedAt: z.number(),
  durationSec: z.number(),
  status: z.enum(['completed', 'missed', 'failed']),
  hasTranscript: z.boolean().optional(),
  contact: z.object({
    id: z.string(),
    name: z.string(),
    lifecycleStage: z.string().optional(),
    lastContacted: z.string().optional(),
    portalUrl: z.string(),
  }).optional(),
});

const HISTORY_CAP = 20;

export const storage = {
  async getSettings(): Promise<Settings | null> {
    const { settings } = await chrome.storage.local.get('settings');
    if (!settings) return null;
    const parsed = SettingsSchema.safeParse(settings);
    return parsed.success ? parsed.data : null;
  },

  async setSettings(s: Settings): Promise<void> {
    SettingsSchema.parse(s);
    await chrome.storage.local.set({ settings: s });
  },

  /** Partial update — merges patch into existing settings. No-op if no settings exist. */
  async updateSettings(patch: Partial<Settings>): Promise<Settings | null> {
    const current = await this.getSettings();
    if (!current) return null;
    const merged = { ...current, ...patch } as Settings;
    await this.setSettings(merged);
    return merged;
  },

  async clearSettings(): Promise<void> {
    await chrome.storage.local.remove('settings');
  },

  async getHistory(): Promise<CallRecord[]> {
    const { history } = await chrome.storage.local.get('history');
    if (!Array.isArray(history)) return [];
    const valid: CallRecord[] = [];
    for (const item of history) {
      const p = CallRecordSchema.safeParse(item);
      if (p.success) valid.push(p.data);
    }
    return valid;
  },

  async pushHistory(record: CallRecord): Promise<void> {
    CallRecordSchema.parse(record);
    const list = await this.getHistory();
    list.unshift(record);
    await chrome.storage.local.set({ history: list.slice(0, HISTORY_CAP) });
  },

  async clearHistory(): Promise<void> {
    await chrome.storage.local.remove('history');
  },

  /** Delete a single call record by its `id` field. No-op if not found. */
  async deleteCallRecord(id: string): Promise<void> {
    const list = await this.getHistory();
    const next = list.filter((r) => r.id !== id);
    await chrome.storage.local.set({ history: next });
  },

  /**
   * Sign out of this device — wipe Twilio creds, caller IDs, history, cloud binding.
   * Transcripts in IndexedDB are preserved (those are "user data"; signout ≠ delete account).
   * Cloud subscription on the backend is unaffected — cancel that separately.
   */
  async signOut(): Promise<void> {
    await chrome.storage.local.remove([
      'settings',
      'callerIds',
      'selectedCallerId',
      'history',
      'cloudUserId',
      'cloudMcpUrl',
      'cloudSyncBlocked',
      'micGranted',
      'dialerQueue',
      'dialerIndex',
      'dialerDailyCount',
    ]);
  },

  onChange(cb: (changes: chrome.storage.StorageChange) => void): () => void {
    const listener = (changes: { [k: string]: chrome.storage.StorageChange }, area: string) => {
      if (area === 'local' && changes.settings) cb(changes.settings);
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  },

  // ── Caller IDs ───────────────────────────────────────────────────────────

  async getCallerIds(): Promise<string[]> {
    const { callerIds } = await chrome.storage.local.get('callerIds');
    return Array.isArray(callerIds) ? callerIds : [];
  },

  async setCallerIds(ids: string[]): Promise<void> {
    await chrome.storage.local.set({ callerIds: ids });
  },

  async getSelectedCallerId(): Promise<string | null> {
    const { selectedCallerId } = await chrome.storage.local.get('selectedCallerId');
    return typeof selectedCallerId === 'string' ? selectedCallerId : null;
  },

  async setSelectedCallerId(id: string): Promise<void> {
    await chrome.storage.local.set({ selectedCallerId: id });
  },

  // ── Auto-dialer queue ────────────────────────────────────────────────────

  async getDialerQueue(): Promise<DialerQueueItem[]> {
    const { dialerQueue } = await chrome.storage.local.get('dialerQueue');
    if (!Array.isArray(dialerQueue)) return [];
    return dialerQueue.filter(
      (item): item is DialerQueueItem =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as DialerQueueItem).id === 'string' &&
        typeof (item as DialerQueueItem).number === 'string',
    );
  },

  async setDialerQueue(items: DialerQueueItem[]): Promise<void> {
    await chrome.storage.local.set({ dialerQueue: items });
  },

  async clearDialerQueue(): Promise<void> {
    await chrome.storage.local.remove('dialerQueue');
  },

  async getDialerIndex(): Promise<number> {
    const { dialerIndex } = await chrome.storage.local.get('dialerIndex');
    return typeof dialerIndex === 'number' && dialerIndex >= 0 ? dialerIndex : 0;
  },

  async setDialerIndex(i: number): Promise<void> {
    await chrome.storage.local.set({ dialerIndex: i });
  },

  // ── Do-not-call list ─────────────────────────────────────────────────────

  async getDncList(): Promise<string[]> {
    const { dncList } = await chrome.storage.local.get('dncList');
    return Array.isArray(dncList) ? dncList.filter((s) => typeof s === 'string') : [];
  },

  async setDncList(list: string[]): Promise<void> {
    await chrome.storage.local.set({ dncList: Array.from(new Set(list)) });
  },

  async addToDnc(number: string): Promise<string[]> {
    const list = await this.getDncList();
    if (!list.includes(number)) list.push(number);
    await this.setDncList(list);
    return list;
  },

  async removeFromDnc(number: string): Promise<string[]> {
    const list = (await this.getDncList()).filter((n) => n !== number);
    await this.setDncList(list);
    return list;
  },

  // ── Daily call counter (TCPA cap) ────────────────────────────────────────

  /**
   * Returns count of auto-dial calls made today (local date).
   * Reset happens implicitly when date string changes.
   */
  async getDialerDailyCount(): Promise<{ date: string; count: number }> {
    const { dialerDailyCount } = await chrome.storage.local.get('dialerDailyCount');
    const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, stable
    if (
      dialerDailyCount &&
      typeof dialerDailyCount === 'object' &&
      typeof (dialerDailyCount as { date?: unknown }).date === 'string' &&
      typeof (dialerDailyCount as { count?: unknown }).count === 'number' &&
      (dialerDailyCount as { date: string }).date === today
    ) {
      return dialerDailyCount as { date: string; count: number };
    }
    return { date: today, count: 0 };
  },

  async incrementDialerDailyCount(): Promise<{ date: string; count: number }> {
    const current = await this.getDialerDailyCount();
    const next = { date: current.date, count: current.count + 1 };
    await chrome.storage.local.set({ dialerDailyCount: next });
    return next;
  },
};
