import { useEffect } from 'react';
import {
  DeviceManager,
  registerCallbacks,
  registerTranscriptionCallbacks,
} from '../../offscreen/twilio-device';
import { useCallStore } from '../stores/call-store';
import { storage } from '@shared/storage';
import { findContactByPhone } from '@shared/hubspot';
import { transcripts, buildTranscript, prefs } from '@shared/transcripts';
import { ensureCloudAccount, syncCallToCloud } from '@shared/cloud';
import type { CallRecord, Transcript } from '@shared/types';

// Module-level singleton — persists across React re-renders and side-panel re-mounts.
let _manager: DeviceManager | null = null;

export function getManager(): DeviceManager {
  if (!_manager) _manager = new DeviceManager();
  return _manager;
}

/**
 * Primary hook — runs the Twilio Device directly in the side panel context.
 * No offscreen document, no message-passing for device state.
 * Works in any Chromium browser including Comet.
 */
export function useDevice() {
  const setDeviceState = useCallStore((s) => s.setDeviceState);
  const setActiveCall = useCallStore((s) => s.setActiveCall);
  const patchActiveCall = useCallStore((s) => s.patchActiveCall);
  const setSettings = useCallStore((s) => s.setSettings);
  const setHistory = useCallStore((s) => s.setHistory);
  const setCallerIds = useCallStore((s) => s.setCallerIds);
  const setSelectedCallerId = useCallStore((s) => s.setSelectedCallerId);

  useEffect(() => {
    const mgr = getManager();

    // ── Transcription callbacks ───────────────────────────────────
    // Live segments → Zustand draft for the panel UI.
    // Finalized transcript → IDB persist + CallRecord with hasTranscript.
    registerTranscriptionCallbacks(
      (_callSid, seg) => {
        useCallStore.getState().appendTranscriptSegment(seg);
      },
      async (info) => {
        try {
          const active = useCallStore.getState().activeCall;
          const contactSnapshot = active?.contact;
          const t = buildTranscript(info.callSid, info.segments, {
            startedAt: info.startedAt,
            endedAt: info.endedAt,
            direction: info.direction,
            remoteNumber: info.remoteNumber,
            contactSnapshot,
          });
          await transcripts.put(t);
        } catch (e) {
          console.error('[transcripts] persist failed', e);
        }
      },
      (err) => {
        console.warn('[transcription] error', err.message);
        useCallStore.getState().setTranscriptError(err.message);
      },
    );

    // Wire callbacks → Zustand (zero-latency, no storage round-trip).
    registerCallbacks(
      (state, error) => {
        setDeviceState(state as never, error);
      },
      (payload) => {
        const cs = payload as {
          state: string;
          direction?: 'in' | 'out';
          from?: string;
          to?: string;
          sid?: string;
          durationSec?: number;
          error?: string;
        };
        if (!cs.state || cs.state === 'closed') {
          // Snapshot the active call BEFORE clearing so we can build CallRecord.
          const ending = useCallStore.getState().activeCall;
          setActiveCall(null);
          // Side-panel-owned persistence: history record + sync-folder file write.
          // Service worker no longer writes CallRecord.
          if (ending && cs.sid) {
            persistEndedCall(ending, cs).catch((e) =>
              console.error('[history] persist failed', e),
            );
          }
        } else {
          const existing = useCallStore.getState().activeCall;
          if (existing) {
            patchActiveCall({
              phase: cs.state as never,
              sid: cs.sid ?? existing.sid,
              // Track exact answer time so timer survives remounts.
              ...(cs.state === 'open' ? { startedAt: Date.now() } : {}),
            });
          } else {
            const remoteNumber = (cs.to ?? cs.from ?? '') as string;
            // Reset transcript draft + error for new call.
            useCallStore.getState().clearTranscriptDraft();
            useCallStore.getState().setTranscriptError(null);
            setActiveCall({
              direction: cs.direction ?? 'out',
              remoteNumber,
              phase: cs.state as never,
              startedAt: Date.now(),
              muted: false,
              sid: cs.sid,
            });

            // HubSpot reverse lookup + auto screen-pop for incoming ringing calls.
            // Fire-and-forget — never blocks ring UI.
            if (cs.direction === 'in' && cs.state === 'ringing' && remoteNumber) {
              enrichWithHubSpot(remoteNumber).catch((e) =>
                console.warn('[hubspot] enrichment failed', e),
              );
            }
          }
        }
      },
    );

    // Load settings → init device + seed caller IDs.
    storage.getSettings().then(async (settings) => {
      setSettings(settings);
      if (settings) {
        mgr.init(settings).catch((e) => console.error('[sidepanel] Device init failed', e));
        // Seed callerIds from defaultCallerId if not yet stored.
        const stored = await storage.getCallerIds();
        const ids = stored.length > 0 ? stored : [settings.defaultCallerId];
        if (stored.length === 0) await storage.setCallerIds(ids);
        setCallerIds(ids);
        const sel = await storage.getSelectedCallerId();
        const selected = sel && ids.includes(sel) ? sel : ids[0];
        if (!sel || !ids.includes(sel)) await storage.setSelectedCallerId(selected);
        setSelectedCallerId(selected);
      } else {
        setDeviceState('uninitialized' as never, 'No settings — open Settings to configure.');
      }
    });

    // Re-init when settings change (wizard completion).
    const unsubSettings = storage.onChange(async (change) => {
      const s = (change.newValue as never) ?? null;
      setSettings(s);
      if (s) {
        mgr.init(s).catch((e) => console.error('[sidepanel] Device re-init failed', e));
      }
    });

    // Load call history.
    storage.getHistory().then(setHistory);

    // Keep history + callerIds fresh from storage changes.
    const storageListener = (
      changes: { [k: string]: chrome.storage.StorageChange },
      area: string,
    ) => {
      if (area !== 'local') return;
      if (changes.history) storage.getHistory().then(setHistory);
      if (changes.callerIds) {
        const ids: string[] = Array.isArray(changes.callerIds.newValue)
          ? changes.callerIds.newValue
          : [];
        setCallerIds(ids);
      }
      if (changes.selectedCallerId) {
        const id = changes.selectedCallerId.newValue;
        if (typeof id === 'string') setSelectedCallerId(id);
      }
    };
    chrome.storage.onChanged.addListener(storageListener);

    return () => {
      unsubSettings();
      chrome.storage.onChanged.removeListener(storageListener);
      // Don't teardown manager on unmount — side panel re-mounts on tab switch.
      // Device stays registered in background.
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/**
 * Side-panel-owned post-call persistence.
 * Runs in this order so each step depends only on what came before:
 *   1. Check IDB for transcript (already persisted by transcription onFinalized cb)
 *   2. Push CallRecord to chrome.storage.local with accurate hasTranscript flag
 *   3. Write JSON file to sync folder if user picked one (handles permission re-prompt)
 *
 * Service worker is now only responsible for desktop notifications.
 */
async function persistEndedCall(
  active: { direction: 'in' | 'out'; remoteNumber: string; startedAt: number; contact?: import('@shared/types').ContactInfo },
  cs: { sid?: string; durationSec?: number; error?: string },
): Promise<void> {
  if (!cs.sid) return;

  // 1. Check transcript presence
  let transcript: Transcript | null = null;
  try {
    transcript = await transcripts.get(cs.sid);
  } catch (e) {
    console.warn('[history] transcript lookup failed', e);
  }

  // 2. CallRecord
  const durationSec = cs.durationSec ?? 0;
  const record: CallRecord = {
    id: crypto.randomUUID(),
    sid: cs.sid,
    direction: active.direction,
    number: active.remoteNumber || 'Unknown',
    startedAt: Date.now() - durationSec * 1000,
    durationSec,
    status: cs.error ? 'failed' : durationSec > 0 ? 'completed' : 'missed',
    hasTranscript: !!transcript,
    contact: active.contact,
  };
  try {
    const { storage } = await import('@shared/storage');
    await storage.pushHistory(record);
  } catch (e) {
    console.error('[history] storage.pushHistory failed', e);
  }

  // 3. Cloud sync — fire-and-forget, never blocks call flow
  ensureCloudAccount()
    .then(({ userId }) => syncCallToCloud(userId, record, transcript))
    .catch(() => {});

  // 4. JSON sync-folder write (only if user configured a folder)
  if (transcript) {
    await writeTranscriptToSyncFolder(transcript, record).catch((e) =>
      console.warn('[sync-folder] write failed', e),
    );
  }
}

const TRANSCRIPT_FOLDER_KEY = 'transcriptFolderHandle';

/**
 * Write transcript JSON to user-picked folder via File System Access API.
 * Permission re-check uses queryPermission; re-prompt requires user gesture, so if
 * lapsed, we log and defer (user re-runs from "Re-sync all" in options if added later).
 */
async function writeTranscriptToSyncFolder(
  transcript: Transcript,
  record: CallRecord,
): Promise<void> {
  const handle = await prefs.get<FileSystemDirectoryHandle>(TRANSCRIPT_FOLDER_KEY);
  if (!handle) return;

  type Handle = FileSystemDirectoryHandle & {
    queryPermission: (opts: { mode: 'read' | 'readwrite' }) => Promise<'granted' | 'denied' | 'prompt'>;
  };
  const h = handle as Handle;
  let perm: 'granted' | 'denied' | 'prompt' = 'denied';
  try { perm = await h.queryPermission({ mode: 'readwrite' }); } catch { /* noop */ }
  if (perm !== 'granted') {
    console.info('[sync-folder] permission not granted (', perm, ') — skipping write');
    return;
  }

  // {folder}/calls/{callSid}.json
  const callsDir = await handle.getDirectoryHandle('calls', { create: true });
  const fileHandle = await callsDir.getFileHandle(`${transcript.callSid}.json`, { create: true });
  const writable = await fileHandle.createWritable();
  const payload = {
    meta: {
      callSid: record.sid,
      direction: record.direction,
      number: record.number,
      startedAt: record.startedAt,
      durationSec: record.durationSec,
      status: record.status,
      contact: record.contact,
    },
    transcript: {
      segments: transcript.segments,
      startedAt: transcript.startedAt,
      endedAt: transcript.endedAt,
    },
  };
  await writable.write(JSON.stringify(payload, null, 2));
  await writable.close();

  // Append/update index.json — flat list with summary records.
  try {
    const indexHandle = await handle.getFileHandle('index.json', { create: true });
    let existing: Record<string, unknown>[] = [];
    try {
      const file = await indexHandle.getFile();
      const text = await file.text();
      if (text.trim()) existing = JSON.parse(text);
    } catch { /* empty file */ }
    // Remove any prior entry for this callSid, then append.
    existing = existing.filter((e) => e.sid !== record.sid);
    existing.unshift({
      sid: record.sid,
      direction: record.direction,
      number: record.number,
      startedAt: record.startedAt,
      durationSec: record.durationSec,
      status: record.status,
      hasTranscript: true,
    });
    const indexWritable = await indexHandle.createWritable();
    await indexWritable.write(JSON.stringify(existing, null, 2));
    await indexWritable.close();
  } catch (e) {
    console.warn('[sync-folder] index.json update failed', e);
  }
}

/**
 * HubSpot reverse-lookup + auto screen-pop.
 * Reads settings live (not stale at hook-mount), so toggling token in options
 * applies on next incoming call without remounting the side panel.
 */
async function enrichWithHubSpot(remoteNumber: string): Promise<void> {
  const settings = useCallStore.getState().settings;
  if (!settings?.hubspotToken || !settings.hubspotPortalId) return;

  const contact = await findContactByPhone(settings.hubspotToken, settings.hubspotPortalId, remoteNumber);
  if (!contact) return;

  // Patch active call with contact info (only if still ringing — user may have hung up).
  const active = useCallStore.getState().activeCall;
  if (active && active.direction === 'in' && active.remoteNumber === remoteNumber) {
    useCallStore.getState().patchActiveCall({ contact });
  }

  // Auto-open HubSpot tab in background (doesn't steal focus).
  try {
    await chrome.tabs.create({ url: contact.portalUrl, active: false });
  } catch (e) {
    console.warn('[hubspot] tab open failed', e);
  }
}
