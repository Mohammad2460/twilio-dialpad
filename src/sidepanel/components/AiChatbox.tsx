import { useEffect, useRef, useState } from 'react';
import { ensureCloudAccount } from '@shared/cloud';
import {
  streamChat,
  getCreditBalance,
  getCachedCreditState,
  startTopUp,
  TOPUP_PACKS,
  type ChatTurn,
} from '@shared/credits';

/** Models offered in the picker. Haiku is the free-tier default; the rest are Pro. */
const MODELS: { id: string; label: string; pro: boolean }[] = [
  { id: 'claude-haiku-4-5', label: 'Haiku · fastest', pro: false },
  { id: 'claude-sonnet-4-6', label: 'Sonnet · sharper', pro: true },
  { id: 'claude-opus-4-8', label: 'Opus · deepest', pro: true },
];

/**
 * Managed Claude chatbox over a single call's transcript (P8.4 + P8.6).
 * Streams answers, meters credits server-side, surfaces balance + upsell.
 * `transcript` is the plain-text transcript assembled by the caller.
 */
export function AiChatbox({ transcript }: { transcript: string }) {
  const [userId, setUserId] = useState<string | null>(null);
  const [model, setModel] = useState(MODELS[0].id);
  const [balance, setBalance] = useState<number | null>(null);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'pro' | 'credits' | 'error'; msg: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cached = await getCachedCreditState();
      if (!cancelled && cached) setBalance(cached.balance);
      try {
        const acct = await ensureCloudAccount();
        if (cancelled) return;
        setUserId(acct.userId);
        const state = await getCreditBalance(acct.userId);
        if (!cancelled) setBalance(state.balance);
      } catch {
        /* not registered — chatbox stays disabled */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns, streaming]);

  async function ask() {
    const q = draft.trim();
    if (!q || !userId || streaming) return;
    setNotice(null);
    setDraft('');
    const next: ChatTurn[] = [...turns, { role: 'user', content: q }];
    setTurns(next);
    setStreaming(true);

    // Optimistic empty assistant turn we append deltas to.
    setTurns((t) => [...t, { role: 'assistant', content: '' }]);
    let acc = '';
    try {
      for await (const ev of streamChat(userId, {
        model,
        transcript,
        messages: next,
        idempotencyKey: crypto.randomUUID(),
      })) {
        if (ev.type === 'delta') {
          acc += ev.text;
          setTurns((t) => {
            const copy = t.slice();
            copy[copy.length - 1] = { role: 'assistant', content: acc };
            return copy;
          });
        } else if (ev.type === 'done') {
          setBalance(ev.balance);
        } else if (ev.type === 'error') {
          if (ev.status === 402 && ev.error === 'pro_required') {
            setNotice({ kind: 'pro', msg: 'Sonnet & Opus need Pro. Haiku is free.' });
          } else if (ev.status === 402 || ev.error === 'insufficient_credits') {
            setNotice({ kind: 'credits', msg: 'Out of credits — upgrade or top up to keep using AI.' });
          } else {
            setNotice({ kind: 'error', msg: 'AI request failed. Try again.' });
          }
          if (typeof ev.balance === 'number') setBalance(ev.balance);
          // Drop the empty/partial assistant turn on hard failure.
          setTurns((t) => (t[t.length - 1]?.content ? t : t.slice(0, -1)));
        }
      }
    } finally {
      setStreaming(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-gray-200">
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          disabled={streaming}
          className="text-xs border border-gray-300 rounded px-2 py-1 bg-white"
        >
          {MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
              {m.pro ? ' (Pro)' : ''}
            </option>
          ))}
        </select>
        <span className="text-xs text-gray-500" title="Managed-AI credits">
          {balance === null ? '—' : `${balance} cr`}
        </span>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {turns.length === 0 && (
          <p className="text-xs text-gray-400 mt-4 text-center">
            Ask about this call — “Why didn’t they commit?”, “What objections came up?”
          </p>
        )}
        {turns.map((t, i) => (
          <div
            key={i}
            className={`text-sm rounded-lg px-3 py-2 max-w-[90%] whitespace-pre-wrap ${
              t.role === 'user'
                ? 'bg-blue-600 text-white ml-auto'
                : 'bg-gray-100 text-gray-900'
            }`}
          >
            {t.content || (streaming ? '…' : '')}
          </div>
        ))}
      </div>

      {notice && (
        <div
          className={`mx-3 mb-2 text-xs rounded px-3 py-2 ${
            notice.kind === 'error' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-800'
          }`}
        >
          <p>{notice.msg}</p>
          {notice.kind === 'credits' && userId && (
            <button
              onClick={() => startTopUp(userId, TOPUP_PACKS[0])}
              className="mt-1 font-medium text-blue-700 hover:underline"
            >
              Top up {TOPUP_PACKS[0]} credits (${TOPUP_PACKS[0] / 100})
            </button>
          )}
        </div>
      )}

      <div className="flex gap-2 p-3 border-t border-gray-200">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && ask()}
          placeholder={userId ? 'Ask Claude about this call…' : 'Set up your account first'}
          disabled={!userId || streaming}
          className="flex-1 text-sm border border-gray-300 rounded px-3 py-2 disabled:bg-gray-50"
        />
        <button
          onClick={ask}
          disabled={!userId || streaming || !draft.trim()}
          className="text-sm px-3 py-2 rounded bg-blue-600 text-white disabled:opacity-40"
        >
          {streaming ? '…' : 'Ask'}
        </button>
      </div>
    </div>
  );
}
