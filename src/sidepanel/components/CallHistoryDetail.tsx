import { useEffect, useMemo, useState } from 'react';
import { transcripts } from '@shared/transcripts';
import type { Transcript } from '@shared/types';
import { formatForDisplay } from '@shared/phone';

interface Props {
  callSid: string;
  onClose: () => void;
}

export function CallHistoryDetail({ callSid, onClose }: Props) {
  const [t, setT] = useState<Transcript | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle');

  useEffect(() => {
    let cancelled = false;
    transcripts.get(callSid).then((res) => {
      if (cancelled) return;
      setT(res);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [callSid]);

  const filtered = useMemo(() => {
    if (!t) return [];
    const q = query.trim().toLowerCase();
    if (!q) return t.segments;
    return t.segments.filter((s) => s.text.toLowerCase().includes(q));
  }, [t, query]);

  async function copyAll() {
    if (!t) return;
    const text = t.segments
      .map((s) => `[${formatTs(s.ts)}] ${s.speaker === 'user' ? 'You' : 'Caller'}: ${s.text}`)
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopyState('copied');
      setTimeout(() => setCopyState('idle'), 1500);
    } catch (e) {
      console.warn('[history-detail] copy failed', e);
    }
  }

  async function deleteTranscript() {
    if (!confirm('Delete this transcript? Call record stays in history.')) return;
    await transcripts.delete(callSid);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/30 sm:items-center sm:justify-center" onClick={onClose}>
      <div
        className="w-full max-h-[90vh] flex flex-col rounded-t-2xl bg-white sm:max-w-md sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-2 border-b border-gray-100 px-4 py-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-gray-900">Call Transcript</h3>
            {t && (
              <p className="mt-0.5 text-xs text-gray-500">
                {t.contactSnapshot?.name ?? formatForDisplay(t.remoteNumber)} •{' '}
                {new Date(t.startedAt).toLocaleString()} •{' '}
                {Math.round((t.endedAt - t.startedAt) / 1000)}s
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-gray-500 hover:bg-gray-100"
            title="Close"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" />
            </svg>
          </button>
        </div>

        {/* Toolbar */}
        {t && (
          <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-100">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search within transcript…"
              className="flex-1 rounded-md border border-gray-200 px-2 py-1 text-xs outline-none focus:border-gray-400"
            />
            <button
              type="button"
              onClick={copyAll}
              className="rounded-md bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-200"
            >
              {copyState === 'copied' ? '✓ Copied' : 'Copy all'}
            </button>
            <button
              type="button"
              onClick={deleteTranscript}
              className="rounded-md px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
              title="Delete transcript"
            >
              Delete
            </button>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {loading && <p className="text-sm text-gray-400">Loading…</p>}
          {!loading && !t && <p className="text-sm text-gray-500">Transcript not found.</p>}
          {t && filtered.length === 0 && query && (
            <p className="text-sm text-gray-400 italic">No matches.</p>
          )}
          {t && (
            <div className="space-y-2 text-sm">
              {filtered.map((s, i) => (
                <div key={i} className="flex gap-2">
                  <span className="shrink-0 w-12 text-xs tabular-nums text-gray-400">
                    {formatTs(s.ts)}
                  </span>
                  <span
                    className={[
                      'shrink-0 rounded px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wider h-fit',
                      s.speaker === 'user'
                        ? 'bg-green-100 text-green-700'
                        : 'bg-gray-100 text-gray-600',
                    ].join(' ')}
                  >
                    {s.speaker === 'user' ? 'You' : 'Caller'}
                  </span>
                  <span className="flex-1 text-gray-900">{s.text}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function formatTs(ms: number): string {
  const sec = Math.floor(ms / 1000);
  const m = Math.floor(sec / 60).toString().padStart(2, '0');
  const s = (sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}
