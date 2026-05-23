import { useEffect, useState } from 'react';
import { useCallStore } from '../stores/call-store';
import { prefs, transcripts } from '@shared/transcripts';
import type { CallRecord, Transcript } from '@shared/types';

type Handle = FileSystemDirectoryHandle & {
  queryPermission: (opts: { mode: 'read' | 'readwrite' }) => Promise<'granted' | 'denied' | 'prompt'>;
  requestPermission: (opts: { mode: 'read' | 'readwrite' }) => Promise<'granted' | 'denied' | 'prompt'>;
};

const TRANSCRIPT_FOLDER_KEY = 'transcriptFolderHandle';

/**
 * Side-panel banner that prompts the user to grant folder access.
 *
 * The folder was picked in the OPTIONS page (separate browsing context).
 * Chrome's File System Access API requires permission re-grant per context per session
 * — handle.queryPermission() returns 'prompt' here even though options page has access.
 *
 * One click triggers requestPermission() with the side panel's user gesture →
 * grants permission for the side panel session → enables transcript file sync.
 * Also offers a re-sync action to backfill calls that ended while perm was 'prompt'.
 */
export function FolderPermissionBanner() {
  const settings = useCallStore((s) => s.settings);
  const [perm, setPerm] = useState<'granted' | 'denied' | 'prompt' | 'unknown'>('unknown');
  const [busy, setBusy] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);

  const folderConfigured = !!settings?.transcriptFolderConfigured;

  // Check permission on mount + when folder config changes
  useEffect(() => {
    if (!folderConfigured) {
      setPerm('unknown');
      return;
    }
    let cancelled = false;
    (async () => {
      const handle = await prefs.get<Handle>(TRANSCRIPT_FOLDER_KEY);
      if (!handle) {
        if (!cancelled) setPerm('unknown');
        return;
      }
      try {
        const p = await handle.queryPermission({ mode: 'readwrite' });
        if (!cancelled) setPerm(p);
      } catch {
        if (!cancelled) setPerm('unknown');
      }
    })();
    return () => { cancelled = true; };
  }, [folderConfigured]);

  if (!folderConfigured || perm === 'granted' || perm === 'unknown') return null;

  async function grant() {
    setBusy(true);
    setSyncResult(null);
    try {
      const handle = await prefs.get<Handle>(TRANSCRIPT_FOLDER_KEY);
      if (!handle) return;
      const result = await handle.requestPermission({ mode: 'readwrite' });
      setPerm(result);
      if (result === 'granted') {
        // Backfill any transcripts captured while perm was 'prompt'
        const count = await resyncAll(handle);
        setSyncResult(count > 0 ? `Synced ${count} call${count === 1 ? '' : 's'}` : 'Up to date');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs">
      <div className="flex items-start gap-2">
        <span className="text-amber-600">⚠</span>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-amber-900">
            Transcript folder access needed
          </p>
          <p className="mt-0.5 text-amber-700">
            One-click grant. Required so finished call transcripts can save for Claude MCP.
          </p>
        </div>
        <button
          type="button"
          onClick={grant}
          disabled={busy}
          className="shrink-0 rounded-md bg-amber-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
        >
          {busy ? 'Granting…' : 'Grant'}
        </button>
      </div>
      {syncResult && (
        <p className="mt-1 pl-5 text-green-700">✓ {syncResult}</p>
      )}
    </div>
  );
}

/**
 * Re-sync — walk every transcript in IDB, write each to {folder}/calls/{callSid}.json,
 * rebuild {folder}/index.json from chrome.storage history. Idempotent.
 */
async function resyncAll(handle: FileSystemDirectoryHandle): Promise<number> {
  const all = await transcripts.list(1000);
  if (all.length === 0) return 0;

  // history records for meta + status
  const { storage } = await import('@shared/storage');
  const history = await storage.getHistory();
  const histBySid: Record<string, CallRecord> = {};
  for (const h of history) {
    if (h.sid) histBySid[h.sid] = h;
  }

  const callsDir = await handle.getDirectoryHandle('calls', { create: true });
  let written = 0;
  const indexRows: Record<string, unknown>[] = [];

  for (const t of all) {
    const h = histBySid[t.callSid];
    const payload = {
      meta: {
        callSid: t.callSid,
        direction: t.direction,
        number: t.remoteNumber,
        startedAt: t.startedAt,
        durationSec: Math.round((t.endedAt - t.startedAt) / 1000),
        status: h?.status ?? 'completed',
        contact: t.contactSnapshot,
      },
      transcript: {
        segments: t.segments,
        startedAt: t.startedAt,
        endedAt: t.endedAt,
      },
    };
    const fileHandle = await callsDir.getFileHandle(`${t.callSid}.json`, { create: true });
    const w = await fileHandle.createWritable();
    await w.write(JSON.stringify(payload, null, 2));
    await w.close();
    written++;
    indexRows.push({
      sid: t.callSid,
      direction: t.direction,
      number: t.remoteNumber,
      startedAt: t.startedAt,
      durationSec: Math.round((t.endedAt - t.startedAt) / 1000),
      status: h?.status ?? 'completed',
      hasTranscript: true,
    });
  }

  // index.json
  indexRows.sort((a, b) => (b.startedAt as number) - (a.startedAt as number));
  const idxHandle = await handle.getFileHandle('index.json', { create: true });
  const iw = await idxHandle.createWritable();
  await iw.write(JSON.stringify(indexRows, null, 2));
  await iw.close();

  return written;
}

// Hint to TypeScript about transcript shape used in resyncAll
export type _T = Transcript;
