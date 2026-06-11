import { useEffect, useState } from 'react';
import { storage } from '@shared/storage';
import { transcripts } from '@shared/transcripts';
import type { CallRecord } from '@shared/types';
import { AiChatbox } from './AiChatbox';
import { formatForDisplay } from '@shared/phone';

/**
 * Standalone AI tab. Defaults to general chat (no transcript). The user can pick a
 * recent transcribed call to load it as context. Selecting a call remounts the
 * chatbox (keyed) so a fresh thread starts with that transcript bound.
 */
export function AiTab() {
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [selectedSid, setSelectedSid] = useState<string>(''); // '' = general chat
  const [transcript, setTranscript] = useState<string | undefined>(undefined);
  const [loadingCtx, setLoadingCtx] = useState(false);

  useEffect(() => {
    storage.getHistory().then((h) => setCalls(h.filter((c) => c.hasTranscript))).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!selectedSid) {
      setTranscript(undefined);
      return;
    }
    setLoadingCtx(true);
    transcripts
      .get(selectedSid)
      .then((t) => {
        if (cancelled) return;
        if (!t) {
          setTranscript(undefined);
          return;
        }
        // Match CallHistoryDetail labeling: speaker is 'user' | 'remote'.
        const text = t.segments
          .map((s) => `${s.speaker === 'user' ? 'You' : 'Caller'}: ${s.text}`)
          .join('\n');
        setTranscript(text);
      })
      .catch(() => {
        if (!cancelled) setTranscript(undefined);
      })
      .finally(() => {
        if (!cancelled) setLoadingCtx(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedSid]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-gray-200 bg-gray-50 px-3 py-2">
        <span className="shrink-0 text-xs font-medium text-gray-500">Context</span>
        <select
          value={selectedSid}
          onChange={(e) => setSelectedSid(e.target.value)}
          className="flex-1 rounded border border-gray-300 bg-white px-2 py-1 text-xs"
        >
          <option value="">General chat (no call)</option>
          {calls.map((c) => (
            <option key={c.sid} value={c.sid}>
              {formatForDisplay(c.number)} · {new Date(c.startedAt).toLocaleDateString()}
            </option>
          ))}
        </select>
      </div>
      <div className="min-h-0 flex-1">
        {loadingCtx ? (
          <p className="p-4 text-center text-xs text-gray-400">Loading transcript…</p>
        ) : (
          <AiChatbox key={selectedSid || 'general'} transcript={transcript} />
        )}
      </div>
    </div>
  );
}
