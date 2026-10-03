# AI assistant v1 (in-extension) — design

_2026-10-04. Item 1 of `docs/strategy/relaunch-plan.md`. Ships quietly as 1.4.0._

## Goal

Make the built-in AI the reason to pay: it should show up **before the user asks**. Read-only — the
assistant never calls, texts, emails or changes anything outside the extension.

Success looks like:

- After a transcribed call, a summary with objections, promises and a next step appears on its own.
- Typing or receiving a number with history shows what happened last time, before the call connects.
- Opening the AI tab shows what is owed today without typing a question.
- "What did Acme object to?" gets a grounded answer that links to the calls it came from.

## Decisions

| Topic | Decision | Why |
|---|---|---|
| Context assembly | Client-side, from IndexedDB transcripts + local history | Post-trial Free users never sync calls to the backend; the local store has everything. History is capped at 20 records, so transcripts are the primary source. |
| Summaries | Automatic after every transcribed call, plus backfill | Pre-call brief, Today and the promises list all feed on them. Cost is ~1 credit per call. |
| Model | `gpt-5-mini` only, no picker | OpenAI is funded; Claude models return once the Anthropic account is funded (item 2). |
| Today / brief / promises | Deterministic, computed locally from stored insights | Instant, free, and cannot hallucinate. Only chat and summarisation call the model. |
| Metering | Unchanged credit ledger | Free/Pro "questions per month" is item 2. |
| MCP connector | Kept, reachable from the AI tab | Zero cost to us. |
| Live in-call cues | Deferred | Real-time cost and distraction risk. |

## Data model

One record per transcribed call, stored on the existing `Transcript` object in IndexedDB (optional
field — no schema version bump, old records keep working):

```ts
interface CallPromise { id: string; text: string; who: 'me' | 'them'; due?: string /* YYYY-MM-DD */; ts?: number /* sec into call */; done?: boolean }
interface CallInsight { summary: string; objections: string[]; promises: CallPromise[]; nextStep?: string; model: string; createdAt: number; v: 1 }
```

`done` is the user's own check-off. Insights are local only in v1 (not synced to the backend).

New setting `aiAutoSummary?: boolean` — treated as ON when undefined.

## Backend (additive — old store builds are unaffected)

**`POST /api/ai/summarize`** (new, JSON in / JSON out, non-streaming)

- Auth: device bearer. Model is fixed server-side.
- Body: `{ transcript, callDate, direction?, contactName? }`.
- OpenAI structured output (strict JSON schema) → validated with zod → `{ insight, credits, balance }`.
- Relative dates ("Thursday") are resolved against `callDate` by the model; anything that is not a
  valid `YYYY-MM-DD` is dropped.
- Reserve → settle from the real vendor usage object → refund if the vendor call throws.
- `402 insufficient_credits` at zero balance; the call itself is never affected.
- Nothing from the transcript is stored or logged server-side.

**`POST /api/ai/chat`** (existing)

- New `mode: 'calls'` with a `context` string (the call digest). `call` and `general` unchanged.
- Turns validated and capped to the last 12.
- Reservation keys are always generated server-side, one per vendor call.
- Prompts move to `backend/lib/ai-prompts.ts` (pure, unit-tested). Transcript text is framed as
  data, never as instructions.

No new tables, no SQL for the owner to run.

## Extension

**Pure modules (unit-tested)**

- `src/shared/ai-context.ts` — `mergeCalls()` unifies transcripts + history newest-first;
  `buildCallDigest()` emits `[C1]…[Cn]` blocks inside a ~40k-token budget: full transcript while it
  fits (8k cap per call) → stored insight → header only. Returns `refs` (C-number → call) for
  citation chips. Starts with today's date so "call back today" works.
- `src/shared/insights.ts` — `normalizeInsight()`, `collectPromises()`, `todayBrief()`,
  `briefForNumber()`, plus the IO: `summarizeTranscript()`, `backfillInsights()`,
  `setPromiseDone()`.

**Triggers**

- Call ends with a transcript → summarise in the background (fire-and-forget).
- Side panel opens → backfill up to 5 recent calls without an insight; stops on the first 402.
- Skipped when `aiAutoSummary` is off or the transcript is too short to be a conversation.

**Surfaces**

- **AI tab** — Today (promises due, people to call back) → open promises (check-off) → chat with
  suggestion chips. Empty state points to turning on transcription. Link to the Claude connector.
- **Pre-call brief** — card on the keypad when the typed number has history, and on the incoming
  call screen. Local read only.
- **Call detail** — insight card above the transcript; promise timestamps jump to the line.
  "Summarize" button when no insight exists.
- **Chat** — `[C3]` citations render as chips that open the call.

## Privacy

Auto-summary sends transcript text to our backend and on to the model provider. Mitigations:
Settings toggle, a one-time notice in the AI tab, and a privacy-policy update (release blocker).

## Error handling

- No credits → notice with upgrade/top-up; summaries stop quietly; calling is untouched.
- Summary fails → call detail shows "Summarize" to retry; nothing else breaks.
- Not signed in / offline → AI tab still renders Today and promises from local data.

## Testing

- Extension (vitest): digest budget, fallback order, per-call cap, ordering, refs; today brief
  (due/overdue, returned vs unreturned missed calls); number matching; insight normalisation.
- Backend (vitest): prompt builders, insight parsing/validation, reservation-key helper.
- Typecheck both projects; `pnpm build`.
- Not covered automatically: live model output quality and a real call — needs a manual pass.

## Out of scope

Drafting emails/SMS, building dialer lists, autonomous actions (v2/v3), Free/Pro question limits
(item 2), syncing insights to the backend / MCP, live in-call cues.
