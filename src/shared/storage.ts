import { z } from 'zod';
import type { CallRecord, Settings } from './types';

const SettingsSchema = z.object({
  accountSid: z.string().regex(/^AC[a-zA-Z0-9]{32}$/),
  apiKeySid: z.string().regex(/^SK[a-zA-Z0-9]{32}$/),
  twimlAppSid: z.string().regex(/^AP[a-zA-Z0-9]{32}$/),
  functionUrl: z.string().url(),
  clientIdentity: z.string().min(1).max(121),
  defaultCallerId: z.string().min(1),
  configuredAt: z.number(),

  // V1.1 optional fields — never required so existing V0 installs still parse.
  serviceSid: z.string().regex(/^ZS[a-zA-Z0-9]{32}$/).optional(),
  environmentSid: z.string().regex(/^ZE[a-zA-Z0-9]{32}$/).optional(),
  configSecret: z.string().min(8).optional(),
  hubspotToken: z.string().min(1).optional(),
  hubspotPortalId: z.string().min(1).optional(),
  deepgramApiKey: z.string().min(1).optional(),
  transcriptFolderConfigured: z.boolean().optional(),
  incomingEnabled: z.boolean().optional(),
  forwardEnabled: z.boolean().optional(),
  forwardNumber: z.string().optional(),
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
};
