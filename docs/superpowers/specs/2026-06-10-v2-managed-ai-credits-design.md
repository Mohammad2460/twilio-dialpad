# V2 Design — Managed AI + Credits (Phase 8)

_Date: 2026-06-10 · Branch: `claude/v2-managed-ai` · Base: `1ab3d24` (v1 shipped)_
_Source of truth: `~/.claude/plans/generic-sauteeing-willow.md` Phase 8. This doc restates that locked plan in implementable form, grounded in actual v1 code._

## Locked decisions (this session)

- **Build per plan.** Any earlier divergence discarded.
- **Managed AI provider = Claude family.** Default model **Haiku**; offer **Sonnet + Opus** too (credit price shown per model). OpenRouter = future, out of scope.
- **Full managed scope:** proxy Deepgram (managed transcription) **and** in-extension AI chatbox.
- **No real usage data yet (6 users).** P8.0 = pick safe conservative defaults + hard caps, tune post-launch. NOT a data-analysis gate.
- Safe defaults to seed: N (Pro monthly grant) ≈ **1,000 credits**, **mono** transcription default (½ COGS), tight free-taste grant, `max_tokens` + context caps per request. All live in versioned `pricing_config` — tunable, never hardcoded.

## Hard invariants (carried from v1 — non-negotiable)

1. **Calls always run on the user's OWN Twilio (BYO).** We never resell minutes. Credits meter AI/transcription usage only — calling logs a 0-credit event.
2. **Twilio Auth Token never persisted** anywhere.
3. **Backend is the source of truth** for entitlements AND credit balance. The ledger (row-locked) is authoritative; the client shows a cache only.
4. **Marketing consent stays separate + default-OFF** (unchanged from v1).
5. **At zero balance, stop AI/transcription gracefully — never drop the call.** Calling is free/BYO and must continue.

## Two AI modes (both kept)

- **(a) BYO / power mode** — user's own Deepgram key + Claude MCP URL. Free, zero credits, zero COGS to us. Unchanged from v1. For power users.
- **(b) Managed mode (NEW)** — we proxy Deepgram (our key) + host an in-extension Claude chatbox. Metered by credits. Removes ALL key setup — the activation fix for non-technical SDRs.

---

## Architecture

### Credit unit + formula
- 1 credit = $0.01 face value.
- Per metered request: `credits = max(MIN_CHARGE, ceil(actual_vendor_cost_usd × 3 × 100))`.
- `actual_vendor_cost_usd` = summed from the **real API usage object** (input + output + cache-write + cache-read + tool tokens, retries, regional multipliers). Never estimated for settlement.
- `×3` = 3× markup (~66% gross margin pre-fees). `MIN_CHARGE` (e.g. 1 cr) covers sub-cent ledger overhead.

### Pricing as versioned config (not constants)
- `pricing_config` table: one row per version, `effective_at`, JSON of per-vendor/per-model rates + `MIN_CHARGE` + caps + N + free-grant size + transcription mono/stereo flag.
- Billing engine reads the active version at request time. Every `credit_ledger` row stores the `pricing_version` used → historical charges auditable when prices change.

### Ledger (atomic source of truth)
Append-only `credit_ledger(id, user_id, kind, credits_delta, balance_after, request_id, idempotency_key UNIQUE, model, vendor_cost_usd, pricing_version, status, created_at, expires_at)`
where `kind ∈ {grant, topup, reservation, settlement, refund, expiry}`.

- **Balance** derived from ledger, cached in row-locked `credit_balances(user_id, balance, updated_at)` updated in the same transaction.
- **Reservation:** `SELECT … FOR UPDATE` the balance row → insert negative `reservation` hold atomically → reject if insufficient → return `request_id`. Concurrency-safe: parallel requests can't both spend the last credits (no oversell).
- **Settlement:** after the response, insert `settlement` adjusting the hold to actual-token cost (release surplus or charge small extra).
- **Refund:** on failure/timeout, insert `refund` reversing the reservation — **minus any vendor cost actually incurred** on a partial generation (a partial still costs us). Not a blanket full refund.
- **Consumption order:** spend **soonest-expiring credits first** — monthly grant (expires cycle end) before top-up (longer/never). Reservations draw from the earliest-expiring non-zero bucket so users never lose top-ups while grant credits sit unused.
- **Idempotency:** every mutation carries `idempotency_key` (UNIQUE) → client/Dodo retries can't double-charge or double-grant.

### Provider abstraction
Cost engine is **provider-agnostic** from day one: a `VendorUsage → usd` adapter per provider (Deepgram billed-minutes; Anthropic token usage object). Adding OpenRouter later = new adapter + `pricing_config` rows, no engine change.

---

## Phases (build order)

### v2a — Credit core (foundation, no user-facing feature)

**P8.0 — Economics (safe defaults, no code beyond config seed)**
- Seed `pricing_config` v1: Anthropic Haiku ~$1/$5, Sonnet ~$3/$15, Opus ~$5/$25 per M tokens (VERIFY live at build); Deepgram Nova-3 ~$0.0077/min/channel, mono default; `MIN_CHARGE`=1; N=1000; free-taste grant small (e.g. 50 cr); `max_tokens` + max-context caps.
- Document that these are conservative placeholders to tune from real burn data post-launch.

**P8.1 — Ledger + schema**
- Supabase migration: `credit_ledger`, `credit_balances`, `pricing_config` + RLS (user reads own ledger; service role writes).
- Balance-read + ledger-append helpers in `backend/lib/credits.ts`.

**P8.2 — Reserve→settle engine**
- `backend/lib/billing.ts`: `reserve(userId, estimate, idemKey)`, `settle(requestId, vendorUsage)`, `refund(requestId, incurredUsage)`.
- Vendor-cost adapters: `costFromAnthropicUsage(usage, model, pricing)`, `costFromDeepgramMinutes(min, channels, model, pricing)`.
- Hard caps enforced here (reject over-cap requests before vendor call).

### v2b — Managed AI (the product)

**P8.3 — Managed Deepgram proxy (transcription)**
- New `backend/app/api/transcribe/stream` (device-secret auth + balance check): backend holds the Deepgram key, relays audio ⇄ transcript to the extension.
- Continuous metering: reserve a short window (30–60s) → settle against actual billed minutes as the stream proceeds → reserve next window.
- **Zero balance → stop the stream gracefully, never drop the call.** UI: "transcription paused — out of credits / upgrade." Resume if topped up mid-call.
- Extension: `src/shared/managed-transcription.ts` — chooses managed vs BYO-Deepgram path based on settings; reuses existing transcript segment shape (`TranscriptSegment`, talk-ratio unaffected).

**P8.4 — Claude chatbox (managed)**
- `backend/app/api/ai/chat` (device-secret auth + Pro + balance): streams Claude completion over the call's transcripts (auto-loaded server-side from synced transcripts). Reserve→settle per message on real token usage. Model param ∈ {haiku, sonnet, opus}, default haiku.
- Extension: new `src/sidepanel/components/AiChatbox.tsx` — model picker with per-model credit price shown, streamed answers, transcript auto-context (no trip to Claude desktop). BYO Claude-MCP stays as the free power-mode path.

**P8.6 — Credit UI surface**
- `src/sidepanel/components/CreditBalance.tsx` + `entitlements`-adjacent `src/shared/credits.ts` client cache (balance, low-balance threshold).
- Balance + burn-down in StatusBar/ProTab; low-balance warning; out-of-credits → upsell/top-up; per-model price transparency in chatbox.

### v2c — Monetization

**P8.5 — Dodo grants + top-ups**
- Extend `backend/app/api/webhook/dodo/route.ts`:
  - `subscription.renewed` (and first `subscription.active`) → insert `grant` ledger row, `expires_at` = `current_period_end` (no roll-over). Idempotent on `idempotency_key` = `webhook-id`.
  - one-time purchase event → `topup` row at flat $0.01/credit, longer/explicit expiry (e.g. 12 mo).
- New top-up checkout: reuse Dodo one-time product via `getCheckoutUrl`-style helper.
- Scheduled **expiry job** (`backend/app/api/credits/expire` + `vercel.json` cron, reuse `CRON_SECRET`): insert `expiry` rows zeroing unspent grant credits past `expires_at`.

### Cross-cutting

**P8.7 — Tests (per slice)**
- Ledger: concurrent reserve can't oversell; idempotent grant/topup/settle; reserve→settle→refund math; partial-failure charges incurred + refunds surplus; expiry-order (grant before topup); fail-closed at zero balance.
- Transcription: window reserve/settle; zero-balance stops stream but **call continues** (invariant test).
- Webhook: `subscription.renewed` grants once on retry; topup idempotent.
- Cost adapters: Anthropic usage → usd, Deepgram minutes → usd, mono vs stereo channel cost.

**P8.8 — Verification**
- `pnpm build` clean; `pnpm test` green; backend deploys; load unpacked.
- Manual: managed transcription on a real BYO-Twilio call (no Deepgram key set) → credits burn down → at zero, transcription pauses, **call stays up**; chatbox answers over transcript, Haiku default, model switch reprices; top-up restores; monthly grant on renewal; grant expires at cycle end; ledger has no oversell under parallel requests.

---

## Data-handling / margin notes
- Per-Pro infra overhead (Supabase egress, Vercel invocations, retried/refunded-but-paid vendor calls, free-grant abuse) must stay in the margin model. Levers: 3× formula floor on every request incl. retries/cache/tools; reserve-then-settle; `max_tokens`+context caps; premium models (Sonnet/Opus) cost more credits so naturally gated; heavy transcribers steered to free BYO-Deepgram-key mode.
- N and free-grant size are the main tunables — both in `pricing_config`, adjusted from real burn after launch.

## Out of scope (v2)
- OpenRouter / non-Anthropic managed models (future).
- Stereo transcription default (mono ships; stereo is a config flip later).
- Bulk-discount top-up tiers (flat $0.01/cr only — discounts erode the 3× floor; model against COGS before ever adding).
- Voicemail (still deferred).
