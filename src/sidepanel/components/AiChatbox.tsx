import { useEffect, useRef, useState } from 'react';
import { ensureCloudAccount, getSubscription, getCheckoutUrl } from '@shared/cloud';
import {
  streamChat,
  getCreditBalance,
  getCachedCreditState,
  startTopUp,
  TOPUP_PACKS,
  type ChatTurn,
} from '@shared/credits';
import { UpgradeModal } from './UpgradeModal';

/** Models offered in the picker. GPT-5 mini is the only free model (default);
 *  all Claude models require Pro. */
const MODELS: { id: string; label: string; pro: boolean }[] = [
  { id: 'gpt-5-mini', label: 'GPT-5 mini', pro: false },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku', pro: true },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet', pro: true },
  { id: 'claude-opus-4-8', label: 'Claude Opus', pro: true },
];

/**
 * Managed multi-provider AI chatbox. Works standalone (general chat) or over a
 * single call's transcript. Streams answers, meters credits server-side, surfaces
 * balance + upsell. `transcript` optional; when absent the backend uses a general
 * assistant prompt.
 */
export function AiChatbox({ transcript }: { transcript?: string }) {
  const [userId, setUserId] = useState<string | null>(null);
  const [hasPro, setHasPro] = useState(false);
  const [model, setModel] = useState(MODELS[0].id);
  const [balance, setBalance] = useState<number | null>(null);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'pro' | 'credits' | 'error'; msg: string } | null>(null);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [checkoutErr, setCheckoutErr] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Abort any in-flight stream on unmount (tab switch / context change) so we stop
  // streaming + billing instead of leaking the request.
  useEffect(() => () => abortRef.current?.abort(), []);

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
        const sub = await getSubscription(acct.userId);
        if (!cancelled) setHasPro(!!sub?.hasAccess);
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

  function selectModel(id: string) {
    const m = MODELS.find((x) => x.id === id);
    if (m?.pro && !hasPro) {
      setUpgradeOpen(true);
      return;
    }
    setModel(id);
  }

  async function handleUpgrade() {
    if (!userId) return;
    setCheckoutErr(null);
    try {
      const url = await getCheckoutUrl(userId);
      await chrome.tabs.create({ url, active: true });
    } catch (e) {
      setCheckoutErr(e instanceof Error ? e.message : 'Could not start checkout');
    }
  }

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
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let acc = '';
    try {
      for await (const ev of streamChat(userId, {
        model,
        transcript,
        mode: transcript ? 'call' : 'general',
        messages: next,
        idempotencyKey: crypto.randomUUID(),
        signal: ctrl.signal,
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
            setNotice({ kind: 'pro', msg: 'Claude models need Pro. GPT-5 mini is free.' });
            setUpgradeOpen(true);
          } else if (ev.status === 402 || ev.error === 'insufficient_credits') {
            setNotice({ kind: 'credits', msg: 'Out of credits — upgrade or top up to keep using AI.' });
          } else {
            setNotice({ kind: 'error', msg: 'AI request failed. Try again.' });
          }
          if (typeof ev.balance === 'number') setBalance(ev.balance);
          setTurns((t) => (t[t.length - 1]?.content ? t : t.slice(0, -1)));
        }
      }
    } catch (e) {
      // Aborted on unmount/context-switch — benign. Surface anything else.
      if ((e as { name?: string })?.name !== 'AbortError') {
        setNotice({ kind: 'error', msg: 'AI request failed. Try again.' });
        setTurns((t) => (t[t.length - 1]?.content ? t : t.slice(0, -1)));
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  const placeholder = !userId
    ? 'Set up your account first'
    : transcript
      ? 'Ask AI about this call…'
      : 'Ask AI anything about your sales calls…';

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-gray-200">
        <div className="flex flex-wrap items-center gap-1">
          {MODELS.map((m) => {
            const locked = m.pro && !hasPro;
            const active = m.id === model;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => selectModel(m.id)}
                disabled={streaming}
                className={[
                  'inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium transition disabled:opacity-50',
                  active ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200',
                ].join(' ')}
                title={locked ? 'Pro — tap to upgrade' : m.label}
              >
                {m.label}
                {m.pro && (
                  <span
                    className={[
                      'rounded px-1 text-[9px] font-bold uppercase tracking-wide',
                      active ? 'bg-white/25 text-white' : 'bg-amber-200 text-amber-800',
                    ].join(' ')}
                  >
                    Pro
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <span className="shrink-0 text-xs text-gray-500" title="Managed-AI credits">
          {balance === null ? '—' : `${balance} cr`}
        </span>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {turns.length === 0 && (
          <p className="text-xs text-gray-400 mt-4 text-center">
            {transcript
              ? 'Ask about this call — “Why didn’t they commit?”, “What objections came up?”'
              : 'Ask anything — “Draft a follow-up email”, “How do I handle a price objection?”'}
          </p>
        )}
        {turns.map((t, i) => (
          <div
            key={i}
            className={`text-sm rounded-lg px-3 py-2 max-w-[90%] whitespace-pre-wrap ${
              t.role === 'user' ? 'bg-blue-600 text-white ml-auto' : 'bg-gray-100 text-gray-900'
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
          {notice.kind === 'pro' && (
            <button
              onClick={() => setUpgradeOpen(true)}
              className="mt-1 font-medium text-blue-700 hover:underline"
            >
              See Pro benefits
            </button>
          )}
        </div>
      )}

      <div className="flex gap-2 p-3 border-t border-gray-200">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && ask()}
          placeholder={placeholder}
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

      <UpgradeModal
        open={upgradeOpen}
        onClose={() => setUpgradeOpen(false)}
        onUpgrade={handleUpgrade}
        error={checkoutErr}
      />
    </div>
  );
}
