import { useEffect, useRef, useState } from 'react';
import { ensureCloudAccount } from '@shared/cloud';
import { streamChat, startTopUp, AI_MODEL, TOPUP_PACKS, type ChatTurn } from '@shared/credits';
import { splitCitations, type CallDigest, type CallRef } from '@shared/ai-context';
import { formatForDisplay } from '@shared/phone';
import { useCallStore } from '../stores/call-store';

interface Props {
  /** Single-call mode: the transcript of the call being discussed. */
  transcript?: string;
  /**
   * Multi-call mode: builds the call digest. Called once per thread, on the
   * first question, so `[C#]` references stay stable for the whole conversation.
   */
  loadContext?: () => Promise<CallDigest>;
  /** One-tap starter questions, shown while the thread is empty. */
  suggestions?: string[];
  /** Open a cited call. Citations render as plain text without it. */
  onOpenCall?: (callSid: string) => void;
}

type Notice = { kind: 'credits' | 'error'; msg: string };

/**
 * Managed AI chatbox. Answers over one call's transcript, over the user's whole
 * call digest, or as open chat when given neither. Streams answers; the backend
 * meters credits and is the only thing that can refuse spend (402).
 */
export function AiChatbox({ transcript, loadContext, suggestions, onOpenCall }: Props) {
  const [userId, setUserId] = useState<string | null>(null);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [refs, setRefs] = useState<Record<string, CallRef>>({});
  const setView = useCallStore((s) => s.setView);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const digestRef = useRef<CallDigest | null>(null);

  // Abort any in-flight stream on unmount (tab switch / context change) so we stop
  // streaming + billing instead of leaking the request.
  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    let cancelled = false;
    ensureCloudAccount()
      .then((acct) => {
        if (!cancelled) setUserId(acct.userId);
      })
      .catch(() => {
        /* not registered — chatbox stays disabled */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns, streaming]);

  function reset() {
    abortRef.current?.abort();
    digestRef.current = null;
    setTurns([]);
    setRefs({});
    setNotice(null);
  }

  async function ask(question?: string) {
    const q = (question ?? draft).trim();
    if (!q || !userId || streaming) return;
    setNotice(null);
    setDraft('');
    const next: ChatTurn[] = [...turns, { role: 'user', content: q }];
    // Optimistic empty assistant turn we append deltas to.
    setTurns([...next, { role: 'assistant', content: '' }]);
    setStreaming(true);

    const dropEmptyAnswer = () => setTurns((t) => (t[t.length - 1]?.content ? t : t.slice(0, -1)));
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let acc = '';
    try {
      if (loadContext && !digestRef.current) {
        digestRef.current = await loadContext();
        setRefs(digestRef.current.refs);
      }
      const context = digestRef.current?.text;
      for await (const ev of streamChat(userId, {
        model: AI_MODEL,
        transcript,
        context,
        mode: context ? 'calls' : transcript ? 'call' : 'general',
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
        } else if (ev.type === 'error') {
          if (ev.status === 402 || ev.error === 'insufficient_credits') {
            setNotice({ kind: 'credits', msg: 'You’re out of AI credits. Top up or go Pro to keep asking.' });
          } else if (ev.status === 413) {
            setNotice({ kind: 'error', msg: 'That conversation got too long. Start a new chat and ask again.' });
          } else {
            setNotice({ kind: 'error', msg: 'AI request failed. Try again.' });
          }
          dropEmptyAnswer();
        }
      }
    } catch (e) {
      // Aborted on unmount/context-switch — benign. Surface anything else.
      if ((e as { name?: string })?.name !== 'AbortError') {
        setNotice({ kind: 'error', msg: 'AI request failed. Try again.' });
        dropEmptyAnswer();
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  const placeholder = !userId
    ? 'Set up your account first'
    : transcript
      ? 'Ask about this call…'
      : 'Ask about your calls…';

  return (
    <div className="flex h-full flex-col">
      <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto px-3 py-2">
        {turns.length === 0 && (
          <div className="mt-2 space-y-1.5">
            {(suggestions ?? []).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => ask(s)}
                disabled={!userId || streaming}
                className="block w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-left text-xs text-gray-700 transition hover:border-brand-200 hover:bg-brand-50 disabled:opacity-50"
              >
                {s}
              </button>
            ))}
            {!suggestions?.length && (
              <p className="mt-4 text-center text-xs text-gray-400">
                {transcript
                  ? 'Ask about this call — “Why didn’t they commit?”, “What should I say next time?”'
                  : 'Ask anything about selling on the phone.'}
              </p>
            )}
          </div>
        )}
        {turns.map((t, i) => (
          <div
            key={i}
            className={`max-w-[90%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
              t.role === 'user' ? 'ml-auto bg-brand-600 text-white' : 'bg-gray-100 text-gray-900'
            }`}
          >
            {t.role === 'assistant' ? (
              t.content ? (
                <Answer text={t.content} refs={refs} onOpenCall={onOpenCall} />
              ) : streaming ? (
                <span className="text-gray-400">Thinking…</span>
              ) : (
                ''
              )
            ) : (
              t.content
            )}
          </div>
        ))}
      </div>

      {notice && (
        <div
          className={`mx-3 mb-2 rounded px-3 py-2 text-xs ${
            notice.kind === 'error' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-800'
          }`}
        >
          <p>{notice.msg}</p>
          {notice.kind === 'credits' && userId && (
            <div className="mt-1 flex gap-3">
              <button
                type="button"
                onClick={() => startTopUp(userId, TOPUP_PACKS[0])}
                className="font-medium text-brand-700 hover:underline"
              >
                Top up (${TOPUP_PACKS[0] / 100})
              </button>
              <button
                type="button"
                onClick={() => setView('pro')}
                className="font-medium text-brand-700 hover:underline"
              >
                See Pro
              </button>
            </div>
          )}
        </div>
      )}

      <div className="flex gap-2 border-t border-gray-200 p-3">
        {turns.length > 0 && (
          <button
            type="button"
            onClick={reset}
            title="Start a new chat"
            aria-label="Start a new chat"
            className="rounded px-2 text-sm text-gray-500 hover:bg-gray-100"
          >
            ↺
          </button>
        )}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && ask()}
          placeholder={placeholder}
          disabled={!userId || streaming}
          className="min-w-0 flex-1 rounded border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50"
        />
        <button
          type="button"
          onClick={() => ask()}
          disabled={!userId || streaming || !draft.trim()}
          className="rounded bg-brand-600 px-3 py-2 text-sm text-white disabled:opacity-40"
        >
          {streaming ? '…' : 'Ask'}
        </button>
      </div>
    </div>
  );
}

/** Answer text with `[C#]` citations turned into chips that open the cited call. */
function Answer({
  text,
  refs,
  onOpenCall,
}: {
  text: string;
  refs: Record<string, CallRef>;
  onOpenCall?: (callSid: string) => void;
}) {
  return (
    <>
      {splitCitations(text).map((part, i) => {
        if (part.type === 'text') return <span key={i}>{part.text}</span>;
        const ref = refs[part.ref];
        // Unknown reference (still streaming, or the model made one up) — drop it.
        if (!ref) return null;
        const label = `${ref.contactName ?? formatForDisplay(ref.number)} · ${new Date(
          ref.startedAt,
        ).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
        const sid = ref.sid;
        if (!sid || !onOpenCall) {
          return (
            <span key={i} className="mx-0.5 rounded bg-gray-200 px-1.5 py-0.5 text-[11px] text-gray-700">
              {label}
            </span>
          );
        }
        return (
          <button
            key={i}
            type="button"
            onClick={() => onOpenCall(sid)}
            title="Open this call"
            className="mx-0.5 rounded bg-brand-100 px-1.5 py-0.5 text-[11px] font-medium text-brand-800 hover:bg-brand-200"
          >
            {label}
          </button>
        );
      })}
    </>
  );
}
