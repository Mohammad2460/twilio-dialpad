import { useEffect, useMemo, useState } from 'react';
import { transcripts } from '@shared/transcripts';
import type { Transcript } from '@shared/types';
import { formatForDisplay } from '@shared/phone';
import { computeTalkRatio } from '@shared/talk-ratio';
import { PaywallGate } from './PaywallGate';
import { AiChatbox } from './AiChatbox';

interface Props {
  callSid: string;
  onClose: () => void;
}

export function CallHistoryDetail({ callSid, onClose }: Props) {
  const [t, setT] = useState<Transcript | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle');
  const [showChat, setShowChat] = useState(false);

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

  const ratio = useMemo(() => (t ? computeTalkRatio(t.segments) : null), [t]);

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

        {/* Talk-to-listen ratio — free, computed locally from real speaking time */}
        {t && ratio && !ratio.unknown && (
          <div className="border-b border-gray-100 px-4 py-2">
            <div className="mb-1 flex items-center justify-between text-[11px] font-medium text-gray-600">
              <span>Talk-to-listen</span>
              <span className="tabular-nums">
                {ratio.userPct}% you · {ratio.remotePct}% them
              </span>
            </div>
            <div className="flex h-2 overflow-hidden rounded-full bg-gray-100">
              <div className="bg-green-500" style={{ width: `${ratio.userPct}%` }} />
              <div className="bg-brand-500" style={{ width: `${ratio.remotePct}%` }} />
            </div>
            {ratio.userPct > 55 && (
              <p className="mt-1 text-[11px] text-gray-500">
                Top closers listen more — aim for closer to 45% you.
              </p>
            )}
          </div>
        )}

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
          {/* AI call analysis — Pro-gated; free users see an upsell */}
          {t && !query && (
            <div className="mb-3">
              <PaywallGate feature="ai_analysis">
                <div className="rounded-lg border border-brand-100 bg-brand-50 p-3">
                  <p className="text-xs font-semibold text-brand-800">AI call analysis</p>
                  <p className="mt-0.5 text-[11px] text-gray-600">
                    Ask Claude to break down this call — objections, talk ratio, and what to improve —
                    through your connected MCP. Use “Copy all”, then ask Claude about it.
                  </p>
                </div>
              </PaywallGate>
            </div>
          )}

          {/* Managed AI chatbox — ask Claude in-extension (credit-metered). */}
          {t && !query && (
            <div className="mb-3">
              {!showChat ? (
                <button
                  onClick={() => setShowChat(true)}
                  className="w-full rounded-lg border border-blue-200 bg-blue-50 p-3 text-left"
                >
                  <p className="text-xs font-semibold text-blue-800">Ask AI about this call</p>
                  <p className="mt-0.5 text-[11px] text-gray-600">
                    Managed AI — no setup. GPT-5 mini is free; Claude models are Pro.
                  </p>
                </button>
              ) : (
                <div className="h-72 rounded-lg border border-gray-200 overflow-hidden">
                  <AiChatbox
                    transcript={t.segments
                      .map((s) => `${s.speaker === 'user' ? 'You' : 'Caller'}: ${s.text}`)
                      .join('\n')}
                  />
                </div>
              )}
            </div>
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
