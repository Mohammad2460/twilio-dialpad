# UX Overhaul + Monetization (Batch 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task (inline, per project rules — no subagent swarm). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the side panel the product's single home, promote AI + Pro at every touch-point, kill duplicated/dead controls, and fix the recurring mic banner + intermittent transcript-start bugs.

**Architecture:** Pure additive changes to the existing CRXJS + React + Zustand side panel and the Next.js (Vercel) backend. New AI tab reuses the existing `AiChatbox` (made context-optional). Backend gains an additive `mode` flag. No DB/pricing changes. No mic-flow change (options tab stays the grant surface); the mic banner becomes permission-aware.

**Tech Stack:** TypeScript, React 18, Zustand, Tailwind, @crxjs/vite-plugin, Twilio Voice SDK, Deepgram, Next.js App Router, Anthropic + OpenAI SDKs, Supabase.

**No test runner is configured** (`pnpm build` = `tsc --noEmit && vite build`; backend `cd backend && npx tsc --noEmit`). Verification per task = typecheck/build + manual load of `dist/` at `chrome://extensions`. Build note: `transforming (1) @crx/manifest` sits static ~75s — NOT a hang; wait for `✓ built`. If a build is ^C'd, run `pkill -9 -f 'vite build'` before retrying.

---

## File map

- `src/sidepanel/stores/call-store.ts` — add `'ai'` to `view` union + `setView`.
- `backend/app/api/ai/chat/route.ts` — additive `mode` + general system prompt.
- `src/shared/credits.ts` — `streamChat` optional `transcript`, add `mode`.
- `src/sidepanel/components/AiChatbox.tsx` — optional transcript, `mode`, context picker, PRO-badge model picker, upgrade modal.
- `src/sidepanel/components/UpgradeModal.tsx` — NEW, overlay shell reusing `UpgradeSheet`.
- `src/sidepanel/components/AiTab.tsx` — NEW, standalone AI tab wrapper (context picker + AiChatbox).
- `src/sidepanel/App.tsx` — AI footer tab + route.
- `src/sidepanel/components/ProTab.tsx` — sales surface: tiers + credit explainer + top-ups.
- `src/sidepanel/hooks/use-mic-permission.ts` — NEW, Permissions-API mic state.
- `src/sidepanel/components/StatusBar.tsx` — remove gear; permission-aware mic banner; credits chip.
- `src/sidepanel/components/Dialpad.tsx` — caret input; remove settings pill; AI promo button.
- `src/offscreen/twilio-device.ts` — transcription start retry + non-fatal signal.
- `src/options/App.tsx` — strip to setup wizard + mic card only.

---

## Task 1: Add `'ai'` view to the call store

**Files:**
- Modify: `src/sidepanel/stores/call-store.ts:10`, `:19`

- [ ] **Step 1: Add `'ai'` to the `view` field type**

In `src/sidepanel/stores/call-store.ts`, change line 10 from:

```ts
  view: 'dialpad' | 'history' | 'autodial' | 'settings' | 'pro' | 'sms';
```
to:
```ts
  view: 'dialpad' | 'history' | 'autodial' | 'settings' | 'pro' | 'sms' | 'ai';
```

- [ ] **Step 2: Add `'ai'` to the `setView` signature**

Change line 19 from:
```ts
  setView: (v: 'dialpad' | 'history' | 'autodial' | 'settings' | 'pro' | 'sms') => void;
```
to:
```ts
  setView: (v: 'dialpad' | 'history' | 'autodial' | 'settings' | 'pro' | 'sms' | 'ai') => void;
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/sidepanel/stores/call-store.ts
git commit -m "feat(store): add 'ai' view"
```

---

## Task 2: Backend — general vs call chat mode

The AI tab supports general chat (no transcript). The current system prompt is
call-coach-only and `messages.length === 0` is rejected. Add an additive `mode`.

**Files:**
- Modify: `backend/app/api/ai/chat/route.ts:44-52` (ChatBody), `:90-103` (mode + system)
- Modify: `src/shared/credits.ts` (`streamChat` opts)

- [ ] **Step 1: Extend `ChatBody` with `mode`**

In `backend/app/api/ai/chat/route.ts`, replace the `ChatBody` interface (lines 44-52) with:

```ts
interface ChatBody {
  model?: string;
  /** Plain-text transcript of the call, assembled client-side. */
  transcript?: string;
  /** Prior chat turns in this thread (user/assistant). */
  messages?: { role: 'user' | 'assistant'; content: string }[];
  /** Per-message idempotency key from the client (dedupes reserve on retry). */
  idempotencyKey?: string;
  /** 'call' = coach over a transcript; 'general' = open dialer assistant. */
  mode?: 'call' | 'general';
}
```

- [ ] **Step 2: Derive mode and pick the system prompt**

In the same file, replace the `system` constant block (lines 99-103) with:

```ts
  const mode: 'call' | 'general' = body.mode ?? (transcript ? 'call' : 'general');
  const system =
    mode === 'call'
      ? 'You are a sales-call coach embedded in a dialer. Answer the user’s questions ' +
        'about THIS call using the transcript below. Be concise, specific, and tactical. ' +
        'If the transcript does not contain the answer, say so.\n\n' +
        `--- CALL TRANSCRIPT ---\n${transcript}\n--- END TRANSCRIPT ---`
      : 'You are a helpful sales assistant embedded in a Twilio dialer Chrome extension. ' +
        'Help the user with sales calls, scripts, objection handling, follow-ups, and ' +
        'general questions. Be concise, specific, and practical.';
```

Note: `transcript` is already defined just above (line 90) and `turns` (line 91); the `turns.length === 0` guard at line 92 stays (a chat always has at least one user message).

- [ ] **Step 3: Backend typecheck**

Run: `cd backend && npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 4: Make `streamChat` transcript optional + pass `mode`**

In `src/shared/credits.ts`, change the `streamChat` opts type (currently `model`, `transcript`, `messages`, `idempotencyKey`) to make `transcript` optional and add `mode`:

```ts
export async function* streamChat(
  userId: string,
  opts: {
    model: string;
    transcript?: string;
    messages: ChatTurn[];
    idempotencyKey?: string;
    mode?: 'call' | 'general';
  },
): AsyncGenerator<ChatEvent> {
```

The body already does `body: JSON.stringify(opts)` — `mode` and the optional `transcript` flow through automatically. No other change in this function.

- [ ] **Step 5: Typecheck extension**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add backend/app/api/ai/chat/route.ts src/shared/credits.ts
git commit -m "feat(ai): support general chat mode (no transcript)"
```

---

## Task 3: UpgradeModal — overlay shell for the Pro upsell popup

A dismissible modal that showcases Pro benefits, reused by the locked-model popup.

**Files:**
- Create: `src/sidepanel/components/UpgradeModal.tsx`

- [ ] **Step 1: Create the modal**

Create `src/sidepanel/components/UpgradeModal.tsx`:

```tsx
import { UpgradeSheet } from './UpgradeSheet';

/**
 * Dismissible overlay wrapping the UpgradeSheet upsell. Used when a free user
 * taps a Pro-locked affordance (e.g. a Claude model). UX only — the backend 402
 * remains the source of truth.
 */
export function UpgradeModal({
  open,
  onClose,
  onUpgrade,
  loading,
  error,
  ctaLabel = 'Start free trial — $9/mo',
}: {
  open: boolean;
  onClose: () => void;
  onUpgrade: () => void;
  loading?: boolean;
  error?: string | null;
  ctaLabel?: string;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="w-full max-h-[90%] overflow-y-auto rounded-t-2xl bg-white p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Unlock Claude models</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1 text-gray-400 hover:bg-gray-100"
            title="Close"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
        <UpgradeSheet onUpgrade={onUpgrade} loading={loading} error={error} ctaLabel={ctaLabel} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/sidepanel/components/UpgradeModal.tsx
git commit -m "feat(ui): UpgradeModal overlay for Pro upsell"
```

---

## Task 4: AiChatbox — context-optional, mode-aware, PRO-locked model picker + upgrade popup

Refactor the chatbox so it works with or without a transcript, sends `mode`,
shows a PRO badge on locked models, and opens the upgrade popup when a free user
taps a Claude model.

**Files:**
- Modify: `src/sidepanel/components/AiChatbox.tsx`
- Reference: `src/shared/cloud.ts` (`getSubscription`, `getCheckoutUrl`), `src/shared/credits.ts`

- [ ] **Step 1: Replace AiChatbox with the context-optional version**

Replace the entire contents of `src/sidepanel/components/AiChatbox.tsx` with:

```tsx
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
 * assistant prompt. `lockedToCall` hides any context UI (used by CallHistoryDetail).
 */
export function AiChatbox({
  transcript,
  lockedToCall,
}: {
  transcript?: string;
  lockedToCall?: boolean;
}) {
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
    let acc = '';
    try {
      for await (const ev of streamChat(userId, {
        model,
        transcript,
        mode: transcript ? 'call' : 'general',
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
    } finally {
      setStreaming(false);
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
```

Note: `lockedToCall` is accepted for forward-compat (CallHistoryDetail passes a
transcript already; the context picker lives in `AiTab`, not here, so `AiChatbox`
needs no picker). It is intentionally unused inside the component — keep the prop
so the public shape is explicit. If `tsc` flags the unused prop, prefix with `_`:
`lockedToCall: _lockedToCall`. (Verify in Step 2.)

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: 0 errors. If "unused variable lockedToCall", change the destructure to
`{ transcript, lockedToCall: _lockedToCall }` and reference nothing, OR simply drop
`lockedToCall` from the props entirely (CallHistoryDetail does not pass it yet).
Pick dropping it if unused: final props become `{ transcript?: string }`.

- [ ] **Step 3: Verify CallHistoryDetail still compiles**

Run: `grep -n "AiChatbox" src/sidepanel/components/CallHistoryDetail.tsx`
Confirm it passes `transcript={...}`. Since `transcript` is now optional, the call
still type-checks. No change needed.

- [ ] **Step 4: Commit**

```bash
git add src/sidepanel/components/AiChatbox.tsx
git commit -m "feat(ai): context-optional chatbox, PRO-badge model picker, upgrade popup"
```

---

## Task 5: AiTab — standalone tab with recent-call context picker

**Files:**
- Create: `src/sidepanel/components/AiTab.tsx`
- Reference: `src/shared/transcripts.ts` (`transcripts.get`, `buildTranscript`), `@shared/storage` (`getHistory`), `@shared/types` (`CallRecord`, `Transcript`)

- [ ] **Step 1: Inspect the transcript helpers' shapes**

Run: `grep -n "export" src/shared/transcripts.ts`
Confirm `transcripts.get(sid)` returns `Promise<Transcript | null>` and there is a
helper to flatten a `Transcript` to text. If a `transcriptToText`/`buildTranscript`
plain-text helper exists, use it; otherwise flatten segments inline as shown below
(`seg.speaker`/`seg.text`). Re-read `Transcript`/`TranscriptSegment` in
`src/shared/types.ts` to confirm field names (`segments`, each `{ speaker, text }`).

- [ ] **Step 2: Create AiTab**

Create `src/sidepanel/components/AiTab.tsx`:

```tsx
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
        const text = t.segments.map((s) => `${s.speaker}: ${s.text}`).join('\n');
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
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: 0 errors. Fix field-name mismatches if Step 1 revealed different names
(e.g. segment text field). Adjust the `.map(...)` accordingly.

- [ ] **Step 4: Commit**

```bash
git add src/sidepanel/components/AiTab.tsx
git commit -m "feat(ai): standalone AI tab with recent-call context picker"
```

---

## Task 6: Wire the AI tab into App nav

**Files:**
- Modify: `src/sidepanel/App.tsx:13-16` (import), `:62-74` (route), `:86-104` (Footer)

- [ ] **Step 1: Import AiTab**

In `src/sidepanel/App.tsx`, add after the `ProTab` import (line 14):

```tsx
import { AiTab } from './components/AiTab';
```

- [ ] **Step 2: Add the route branch**

In the `main` render chain, add an `ai` branch. Change:

```tsx
        ) : view === 'pro' ? (
          <ProTab />
        ) : (
          <Dialpad />
        )}
```
to:
```tsx
        ) : view === 'pro' ? (
          <ProTab />
        ) : view === 'ai' ? (
          <AiTab />
        ) : (
          <Dialpad />
        )}
```

- [ ] **Step 3: Add the AI footer tab**

In `Footer`, insert an AI tab between SMS and Recents (prominent, promotes AI):

```tsx
      <TabButton active={view === 'dialpad'} onClick={() => setView('dialpad')}>
        Keypad
      </TabButton>
      <TabButton active={view === 'ai'} onClick={() => setView('ai')}>
        AI
      </TabButton>
      <TabButton active={view === 'sms'} onClick={() => setView('sms')}>
        SMS
      </TabButton>
      <TabButton active={view === 'history'} onClick={() => setView('history')}>
        Recents
      </TabButton>
      <TabButton active={view === 'pro'} onClick={() => setView('pro')}>
        Pro
      </TabButton>
      <TabButton active={view === 'settings'} onClick={() => setView('settings')}>
        Settings
      </TabButton>
```

- [ ] **Step 4: Typecheck + build**

Run: `npx tsc --noEmit && pnpm build`
Expected: 0 errors; `✓ built`.

- [ ] **Step 5: Manual check**

Load `dist/` at `chrome://extensions` (Reload). Open side panel → AI tab appears in
footer → opens general chat → context dropdown lists transcribed calls → switching
to a call starts a fresh thread.

- [ ] **Step 6: Commit**

```bash
git add src/sidepanel/App.tsx
git commit -m "feat(ai): mount AI tab in side-panel nav"
```

---

## Task 7: ProTab — sales surface (tiers + credit explainer + top-ups)

Keep all subscription-state branches; add a tier-comparison + credit explainer to
the upsell states and ensure top-up packs are surfaced.

**Files:**
- Modify: `src/sidepanel/components/ProTab.tsx`
- Reference: existing `CreditsSection` (already renders top-up packs), `UpgradeSheet`

- [ ] **Step 1: Add a reusable `TierComparison` block at the bottom of ProTab.tsx**

Append this component to `src/sidepanel/components/ProTab.tsx` (after the `ProTab`
function, before EOF):

```tsx
/** Free vs Pro tier comparison + credit-system explainer. Shown in upsell states. */
function TierComparison() {
  return (
    <section className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <p className="text-sm font-semibold text-gray-900">Free</p>
          <p className="mt-0.5 text-[11px] text-gray-500">$0</p>
          <ul className="mt-2 space-y-1 text-[11px] text-gray-600">
            <li>✓ Calling (your Twilio)</li>
            <li>✓ GPT-5 mini AI</li>
            <li>✓ Bring-your-own Deepgram</li>
          </ul>
        </div>
        <div className="rounded-lg border-2 border-brand-300 bg-brand-50 p-3">
          <p className="text-sm font-semibold text-brand-900">Pro</p>
          <p className="mt-0.5 text-[11px] text-brand-700">$9/mo · 7-day trial</p>
          <ul className="mt-2 space-y-1 text-[11px] text-brand-800">
            <li>✓ All Claude models (Haiku/Sonnet/Opus)</li>
            <li>✓ 1000 AI credits / month</li>
            <li>✓ Managed transcription</li>
            <li>✓ SMS · recording · cloud + Claude MCP</li>
          </ul>
        </div>
      </div>
      <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-[11px] text-gray-600">
        <span className="font-medium text-gray-900">How credits work:</span> 1 credit = $0.01.
        AI is metered by real model usage. Pro includes 1000 credits/month; top up any time below.
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Show `TierComparison` in the upsell (expired/no-access) state**

In `ProTab`, replace the final return (the `// expired / no access / null` block,
lines 273-283) with:

```tsx
  return (
    <div className="space-y-4 p-4">
      <h1 className="text-lg font-semibold text-gray-900">Pro</h1>
      <TierComparison />
      <UpgradeSheet
        onUpgrade={handleUpgrade}
        loading={upgradeLoading}
        error={upgradeError}
        ctaLabel="Start free trial"
      />
      <CreditsSection />
    </div>
  );
```

- [ ] **Step 3: Add `TierComparison` to the trialing state too**

In the `trialing` branch, add `<TierComparison />` directly above the `<UpgradeSheet`
(after the trial-status card, before the UpgradeSheet around line 208) so trial users
see exactly what they keep. Insert:

```tsx
        <TierComparison />
```
immediately before the `<UpgradeSheet` in that branch.

- [ ] **Step 4: Typecheck + build**

Run: `npx tsc --noEmit && pnpm build`
Expected: 0 errors; `✓ built`.

- [ ] **Step 5: Manual check**

Pro tab (no active sub) → tier comparison + credit explainer + "Start free trial"
button (opens checkout tab) + top-up packs (1000/2500/5000 = $10/$25/$50) all visible.

- [ ] **Step 6: Commit**

```bash
git add src/sidepanel/components/ProTab.tsx
git commit -m "feat(pro): sales surface — tiers, credit explainer, top-ups"
```

---

## Task 8: mic-permission hook

**Files:**
- Create: `src/sidepanel/hooks/use-mic-permission.ts`

- [ ] **Step 1: Create the hook**

Create `src/sidepanel/hooks/use-mic-permission.ts`:

```ts
import { useEffect, useState } from 'react';

export type MicPermission = 'granted' | 'prompt' | 'denied' | 'unsupported';

/**
 * Live microphone permission state via the Permissions API. Decoupled from Twilio
 * device state — registration is token-based and never needs the mic. Fails open to
 * 'unsupported' (so we never nag) if the API is missing/throws (some Chromium forks).
 */
export function useMicPermission(): MicPermission {
  const [state, setState] = useState<MicPermission>('unsupported');

  useEffect(() => {
    let status: PermissionStatus | null = null;
    let cancelled = false;
    const onChange = () => {
      if (status && !cancelled) setState(status.state as MicPermission);
    };
    try {
      navigator.permissions
        .query({ name: 'microphone' as PermissionName })
        .then((s) => {
          if (cancelled) return;
          status = s;
          setState(s.state as MicPermission);
          s.addEventListener('change', onChange);
        })
        .catch(() => {
          if (!cancelled) setState('unsupported');
        });
    } catch {
      setState('unsupported');
    }
    return () => {
      cancelled = true;
      if (status) status.removeEventListener('change', onChange);
    };
  }, []);

  return state;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/sidepanel/hooks/use-mic-permission.ts
git commit -m "feat(mic): Permissions-API mic state hook"
```

---

## Task 9: StatusBar — remove gear, fix mic banner, add credits chip

**Files:**
- Modify: `src/sidepanel/components/StatusBar.tsx`

- [ ] **Step 1: Import the hook + credits + view setter**

At the top of `src/sidepanel/components/StatusBar.tsx`, add imports:

```tsx
import { useMicPermission } from '../hooks/use-mic-permission';
import { getCachedCreditState, getCreditBalance } from '@shared/credits';
import { ensureCloudAccount } from '@shared/cloud';
```

(`getSubscription`, `useCallStore`, `getManager`, `IncomingToggle` imports stay.)

- [ ] **Step 2: Remove the settings gear button**

Delete the gear `<button>` block (lines 56-63):

```tsx
          <button
            type="button"
            onClick={() => chrome.runtime.openOptionsPage()}
            title="Settings"
            className="rounded p-1 text-gray-400 hover:bg-gray-100 text-sm"
          >
            ⚙
          </button>
```

Replace it with a credits chip (tapping → Pro view):

```tsx
          <CreditsChip />
```

- [ ] **Step 3: Make the mic banner permission-aware**

In the `StatusBar` function body, add near the other hooks (after `const callCount = ...`):

```tsx
  const micPerm = useMicPermission();
  const micNeedsGrant = micPerm === 'prompt' || micPerm === 'denied';
```

Replace the mic banner block (lines 67-79) with:

```tsx
      {/* Mic banner — gated on REAL mic permission, not device state. Once granted
          it never reappears; transient connecting/offline states don't trigger it. */}
      {micNeedsGrant && settings && (
        <div className="bg-amber-50 px-3 py-2 text-xs text-amber-800 border-b border-amber-100 flex items-center justify-between gap-2">
          <span>{micPerm === 'denied' ? 'Microphone blocked — fix to make calls.' : 'Allow microphone to make calls.'}</span>
          <button
            type="button"
            onClick={() => chrome.runtime.openOptionsPage()}
            className="shrink-0 rounded bg-amber-600 px-2 py-1 text-white text-xs hover:bg-amber-700"
          >
            Grant mic →
          </button>
        </div>
      )}
```

- [ ] **Step 4: Add the `CreditsChip` component**

Append to `StatusBar.tsx` (after the existing helper hooks at EOF):

```tsx
/** Compact AI-credits chip in the header. Cached-first, then live. Taps → Pro. */
function CreditsChip() {
  const [balance, setBalance] = useState<number | null>(null);
  const setView = useCallStore((s) => s.setView);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cached = await getCachedCreditState();
      if (!cancelled && cached) setBalance(cached.balance);
      try {
        const acct = await ensureCloudAccount();
        const state = await getCreditBalance(acct.userId);
        if (!cancelled) setBalance(state.balance);
      } catch {
        /* not registered */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  if (balance === null) return null;
  const low = balance <= 50;
  return (
    <button
      type="button"
      onClick={() => setView('pro')}
      title="AI credits — tap to manage"
      className={[
        'rounded-full px-2 py-0.5 text-xs font-medium border',
        low ? 'bg-amber-50 text-amber-800 border-amber-200' : 'bg-gray-50 text-gray-700 border-gray-200',
      ].join(' ')}
    >
      {balance} cr
    </button>
  );
}
```

Ensure `useEffect`/`useState` are imported (the file already imports them at line 1).

- [ ] **Step 5: Typecheck + build**

Run: `npx tsc --noEmit && pnpm build`
Expected: 0 errors; `✓ built`.

- [ ] **Step 6: Manual check**

Reload `dist/`. Header shows a credits chip (when registered), no ⚙ gear. With mic
granted, NO mic banner appears even while device shows "Connecting…"/"Offline". Revoke
mic at `chrome://settings/content/microphone` → banner returns.

- [ ] **Step 7: Commit**

```bash
git add src/sidepanel/components/StatusBar.tsx
git commit -m "fix(ui): permission-aware mic banner; drop dup gear; add credits chip"
```

---

## Task 10: Dialpad — caret input, remove settings pill, AI promo button

**Files:**
- Modify: `src/sidepanel/components/Dialpad.tsx`

- [ ] **Step 1: Remove the settings pill from the top row**

Replace the top-row block (lines 161-185) with an Auto-dial-only row:

```tsx
      {/* ── Top row: auto-dial entry ── */}
      <div className="mb-1 flex items-center justify-end">
        <button
          type="button"
          onClick={() => setView('autodial')}
          className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium text-brand-600 hover:bg-brand-50"
          title="Open the auto-dialer"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
            <path d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" />
          </svg>
          Auto-dial
        </button>
      </div>
```

- [ ] **Step 2: Convert the number display to a caret input**

Replace the Number Display block (lines 370-378) with a focusable controlled input
that shows a caret while preserving formatting hint:

```tsx
      {/* ── Number Display (focusable, shows caret) ── */}
      <div className="flex flex-col items-center gap-1 py-3">
        <input
          type="tel"
          inputMode="tel"
          value={input}
          onChange={(e) => setInput(e.target.value.replace(/[^\d+*#]/g, '').slice(0, 32))}
          placeholder="Enter number"
          aria-label="Phone number"
          className="w-full bg-transparent text-center text-3xl font-light tracking-wider text-gray-900 caret-brand-600 outline-none placeholder:text-gray-300 min-h-[2.25rem]"
        />
        <div className="text-xs text-gray-500 min-h-[1rem]">
          {input && (norm.ok ? `${norm.country ?? ''} • ${norm.national}` : norm.reason ?? '')}
        </div>
      </div>
```

- [ ] **Step 3: Stop the global keydown handler fighting the input**

The window-level keydown (lines 137-153) would double-type when the input is focused.
Guard it: ignore keystrokes when the active element is an input/textarea. Change the
`onKey` function body's first guard from `if (pickerOpen) return;` to:

```tsx
    function onKey(ev: KeyboardEvent) {
      if (pickerOpen) return; // don't type while picker is open
      const ae = document.activeElement;
      if (ae instanceof HTMLInputElement || ae instanceof HTMLTextAreaElement) return; // field owns typing
      if (/^[0-9*#]$/.test(ev.key)) {
        press(ev.key);
      } else if (ev.key === 'Backspace') {
        backspace();
      } else if (ev.key === 'Enter') {
        call();
      } else if (ev.key === '+' && input.length === 0) {
        press('+');
      }
    }
```

(Keypad buttons still call `press()` directly, so tapping digits while the input is
blurred or focused both append via state. Enter inside the focused input is handled by
the global handler being skipped — add an `onKeyDown` to the input for Enter-to-call:
add `onKeyDown={(e) => { if (e.key === 'Enter') call(); }}` to the `<input>` in Step 2.)

Update the Step-2 `<input>` to include the Enter handler:

```tsx
          onKeyDown={(e) => { if (e.key === 'Enter') call(); }}
```

- [ ] **Step 4: Add the AI promo button below the call row**

After the Call/Backspace row's closing `</div>` (line 418) and before the component's
final closing `</div>`, add:

```tsx
      {/* ── AI promo — drive AI usage ── */}
      <button
        type="button"
        onClick={() => setView('ai')}
        className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2.5 text-sm font-semibold text-blue-700 transition hover:bg-blue-100"
      >
        <span>✨</span> Ask AI about your calls
      </button>
```

- [ ] **Step 5: Typecheck + build**

Run: `npx tsc --noEmit && pnpm build`
Expected: 0 errors; `✓ built`. If `formatForDisplay` import becomes unused after
removing the static number `<div>`, leave it — it's still used by the caller-ID picker
and redial chip.

- [ ] **Step 6: Manual check**

Reload `dist/`. Dialpad: number display has a blinking caret, accepts typing + paste +
keypad taps (no double-typing), Enter dials. No "Settings" pill (only Auto-dial top
right). AI promo button below the keypad → opens AI tab.

- [ ] **Step 7: Commit**

```bash
git add src/sidepanel/components/Dialpad.tsx
git commit -m "feat(dialpad): caret input, AI promo button; remove dup settings pill"
```

---

## Task 11: Strip the options tab to setup + mic only

**Files:**
- Modify: `src/options/App.tsx`

- [ ] **Step 1: Replace the configured-state render with mic-only**

In `src/options/App.tsx`, the configured branch (lines 27-101) renders many cards.
Replace the whole `if (settings && !reconfigure) { return ( ... ); }` block with:

```tsx
  if (settings && !reconfigure) {
    return (
      <div className="mx-auto max-w-2xl p-8 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Twilio Dialpad</h1>
          <p className="mt-1 text-sm text-green-700 font-medium">✓ Configured</p>
        </div>

        {/* Microphone permission — must be granted from a full tab, not the side panel. */}
        <MicPermissionCard />

        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
          Everything else — Twilio details, transcription, Claude connector, SMS,
          recordings, subscription &amp; credits — now lives in the <strong>side panel</strong>.
          Open the extension from the toolbar.
        </div>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setReconfigure(true)}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            Reconfigure Twilio
          </button>
        </div>
      </div>
    );
  }
```

- [ ] **Step 2: Delete now-unused card components + imports**

Remove these now-unused functions from `src/options/App.tsx`: `IncomingCallsCard`,
`HubSpotCard`, `ToggleRow`, `DeepgramCard`, `TranscriptStorageCard`,
`ClaudeConnectorCard`. Keep `MicPermissionCard` and the top-level `App` +
`ProvisioningWizard` usage.

Remove the imports that only those deleted components used. After deletion, the only
imports `App.tsx` needs are: `useEffect, useState` (react), `ProvisioningWizard`,
`storage`, and `Settings` type. Delete unused imports: `maskSid`, `pushConfig`,
`normalizeE164`, `testDeepgramKey`, `track`, `prefs`, `ensureCloudAccount`,
`getSubscription`, `getCheckoutUrl`, `cancelSubscription`, `Subscription`. (Verify by
typecheck — remove exactly what `tsc` flags as unused.)

`MicPermissionCard` uses only `useState` + `chrome.*` + `navigator.*` — no extra
imports. Confirm it stays intact.

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc --noEmit && pnpm build`
Expected: 0 errors; `✓ built`. Remove any remaining unused-import errors `tsc` reports.

- [ ] **Step 4: Manual check**

Reload `dist/`. Right-click extension icon → Options (or the in-panel "Grant mic" /
NotConfigured "Open setup"): when configured it shows ONLY the mic card + a "use the
side panel" note + "Reconfigure Twilio". No duplicated Deepgram/Claude/SMS/sub
controls. Unconfigured still shows the full provisioning wizard. Mic grant still works.

- [ ] **Step 5: Commit**

```bash
git add src/options/App.tsx
git commit -m "feat(options): strip tab to setup wizard + mic only (de-dup side panel)"
```

---

## Task 12: Fix intermittent transcript-start (retry + non-fatal signal)

**Files:**
- Modify: `src/offscreen/twilio-device.ts:348-388`

- [ ] **Step 1: Re-read the accept handler before editing**

Run: `sed -n '348,388p' src/offscreen/twilio-device.ts`
Confirm the structure: on `call.on('accept')` an async IIFE resolves managed creds
then calls `this.transcription!.start(...)` inside a `try/catch` that nulls the
controller on failure. Confirm `_transcriptErrorCb` exists (declared near line 40) and
how errors surface to the UI (`registerTranscriptionCallbacks` onError →
`setTranscriptError`).

- [ ] **Step 2: Add a one-retry + user-visible signal around `start`**

Replace the inner `try { await this.transcription!.start(...) } catch { ... }` block
(within the accept IIFE) with a retry wrapper:

```ts
          const startOnce = () =>
            this.transcription!.start(
              call,
              callSid,
              direction,
              remoteNumber,
              apiKey ?? '',
              managed ? (model ?? 'nova-3') : model,
              managed,
            );
          try {
            await startOnce();
          } catch (e1) {
            // Transient connect race (managed-token / Deepgram socket). Retry once.
            console.warn('[transcription] start failed, retrying once', e1);
            await sleep(600);
            try {
              if (!this.transcription) return; // call may have ended during the wait
              await startOnce();
            } catch (e2) {
              console.warn('[transcription] start failed after retry', e2);
              this.transcription = null;
              _transcriptErrorCb?.(
                e2 instanceof Error ? e2 : new Error('Transcription unavailable for this call'),
              );
            }
          }
```

`sleep` already exists in this file (top helper). `_transcriptErrorCb` is the
module-level transcription error callback wired by the side panel; calling it routes a
non-fatal message to `setTranscriptError` → visible in the transcript panel, while the
call audio is untouched.

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc --noEmit && pnpm build`
Expected: 0 errors; `✓ built`. If `_transcriptErrorCb` is named differently, use the
exact identifier found in Step 1.

- [ ] **Step 4: Manual check**

Reload `dist/`. Place a test call (gpt-5-mini path works without ANTHROPIC funds; BYO
Deepgram or managed). Transcript should start reliably; if it genuinely can't start,
the panel shows a non-fatal "transcription unavailable" note instead of silent
nothing, and the call continues normally.

- [ ] **Step 5: Commit**

```bash
git add src/offscreen/twilio-device.ts
git commit -m "fix(transcription): retry start once + surface non-fatal failure"
```

---

## Task 13: Final verification, review, PR

- [ ] **Step 1: Full typecheck + build (both projects)**

```bash
npx tsc --noEmit && (cd backend && npx tsc --noEmit) && pnpm build
```
Expected: 0 errors both projects; `✓ built`.

- [ ] **Step 2: Update PROGRESS.md**

Add a section under v2 noting batch-1 UX overhaul shipped (AI tab, options strip, Pro
sales surface, credits chip, dialpad caret, dup-settings removal, PRO upgrade popup, AI
promo, mic-banner fix, transcript-start retry). Commit:

```bash
git add PROGRESS.md && git commit -m "docs: PROGRESS — UX overhaul batch 1"
```

- [ ] **Step 3: Manual smoke of the full flow**

Load `dist/`. Verify each: AI tab (general + call context, PRO badge + upgrade popup),
Pro tab (tiers, sub checkout, top-up packs), header credits chip, dialpad caret + AI
promo, single settings entry (footer only), options tab setup/mic-only, mic banner no
longer recurs once granted.

- [ ] **Step 4: Code review**

Use superpowers:requesting-code-review (one reviewer subagent) on the branch diff vs
`main`. Fix Critical/Important findings; re-run Step 1 after fixes.

- [ ] **Step 5: Open ONE PR**

```bash
git push -u origin claude/pensive-bardeen-363b43
gh pr create --title "UX overhaul + monetization (batch 1)" --body "<summary + test notes>"
```

---

## Self-review notes (author)

- **Spec coverage:** Task 1 (store) → item 1; Task 2 → item 1 backend; Tasks 3-6 →
  items 1, 8, 9 (AI tab, PRO badge, upgrade popup, AI promo wiring); Task 7 → items 3, 4
  (Pro sales + top-ups); Tasks 8-9 → items 4, 7, 10 (credits chip, dup-gear removal, mic
  banner); Task 10 → items 5, 7, 9 (caret, pill removal, AI promo button); Task 11 →
  item 2 (options strip); Task 12 → item 11 (transcript bug); Task 6/10 → item 7 dup
  settings fully covered (gear in T9, pill in T10). Item 6 (polish/showcase) is satisfied
  across the AI tab + retained Settings AI section — no standalone task needed.
- **Credits chip duplication:** `StatusBar` defines its own `CreditsChip` rather than
  reusing `CreditBalance.tsx` (different shape — chip vs row). `CreditBalance` remains
  available for the Pro area if desired; `CreditsSection` already covers Pro balance, so
  `CreditBalance` mounting is optional and not required by any task. Item 4 is satisfied
  by `CreditsSection` (Pro) + `CreditsChip` (header).
- **Type consistency:** `streamChat` opts `transcript?` + `mode?` match AiChatbox call
  site and backend `ChatBody`. `view` union extended in store + used in App/Dialpad/
  StatusBar setView calls.
- **Verification realism:** no test runner; every task verifies via `tsc`/`pnpm build`
  + manual load, which is the honest gate for this repo.
```
