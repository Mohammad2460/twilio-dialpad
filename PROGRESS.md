# PROGRESS — Twilio Dialpad

> Current state only. History lives in git (`git log`) and merged PRs — don't re-grow a changelog here.
> **Plan of record:** [`docs/strategy/relaunch-plan.md`](docs/strategy/relaunch-plan.md) (AI assistant, pricing, growth, distribution, 2.0 roadmap).

_Last updated: 2026-10-04._

## Status
- **v1.3.0 submitted to the Chrome Web Store (2026-09-29)** — quiet fix release, no marketing. Built from `main` @ `881fa9e`.
- **AI assistant v1 merged and live-tested (2026-10-04)** — item 1 of the relaunch plan. `package.json` is at **1.4.0**. **Not uploaded to the store** — the owner is holding store uploads.
- **Next: pricing — Free vs Pro limits + demo tour** (item 2) → … → **2.0 relaunch**.

## AI assistant v1 (1.4.0)
Spec: `docs/superpowers/specs/2026-10-04-ai-assistant-v1-design.md`.
- **Call notes** — after each transcribed call the extension asks the backend (`POST /api/ai/summarize`, `gpt-5-mini`, credit-metered) for a summary, objections, promises and a next step. Stored on the transcript record in IndexedDB (`Transcript.insight`), local only. Backfills up to 5 recent calls when the panel opens. Settings toggle: "Automatic call summaries" (default on), but nothing is sent automatically until the user answers the one-time app-wide notice (`AiNotice`). Each request leaves a marker on the transcript (`Transcript.insightAttempt`) so a call is not requested twice automatically; after an unknown or unusable result only the manual "Summarize" button retries.
- **AI tab** — Today (promises due, missed calls not returned) + open promises (check-off) + chat. Today/promises/brief are computed locally from the notes — no AI call.
- **Chat** — `POST /api/ai/chat` with `mode: 'calls'`; the extension sends a call digest (`src/shared/ai-context.ts`, ~40k-token budget, newest first). Answers cite `[C#]`, rendered as chips that open the call.
- **Pre-call brief** — keypad (typed number has history) and incoming-call screen.
- Single model, no picker. `AI_CHAT_ENABLED = true`; the Claude connector is reachable from the bottom of the AI tab.

**Live test (2026-10-04, production, `gpt-5-mini`)**
- The OpenAI key in Vercel was invalid (every AI call failed and was refunded); the owner replaced it. Both routes now log why a vendor call failed (`vendor call failed` in the Vercel logs — status, code, short message only).
- `POST /api/ai/summarize` on a short call: correct summary, objections, promises with the right owner, relative dates resolved to real dates. **1 credit.**
- `POST /api/ai/chat` `mode: 'calls'` with one small call as context: grounded answer citing `[C1]`. **1 credit.** A full-size digest (~40k tokens) costs more — estimated 3–4 credits, **not measured yet**.
- Ledger debits matched; failed runs were refunded in full.
- The owner loaded the 1.4.0 build unpacked with seeded calls and checked the opt-in notice, AI tab, call detail, pre-call brief and Settings toggle.

**Before uploading 1.4.0 to the store**
- [ ] Real call test: one real transcribed call end to end → summary appears on its own. Needs a working Twilio account (the owner's is suspended).
- [ ] Privacy gist: the public policy lives in the owner's gist. Add the "Built-in AI assistant" section from `docs/PRIVACY_POLICY.md` to it.
- [ ] Store listing data-use answers: transcript text is sent to an AI provider to provide the feature; not sold, not used for advertising.
- [ ] Fresh `pnpm build` from `main` → zip `dist/` → upload. No store zip exists yet.

**Owner decisions still open (do not change without them)**
- Trial/free credit grant (50) versus real AI cost; whether summaries should be free during the trial.
- "Credits" wording and balance display — belongs to item 2 (pricing: show hours and questions).

## Why the product "died" (2026-09-28 audit)
- The store build was v1.2.0 (2026-06-06), built before device auth; `package.json` was never bumped, so later `main` work never reached users.
- v1.2.0 authenticates with `Bearer <userId>`; the backend stopped accepting that at `LEGACY_AUTH_UNTIL` (2026-07-31) → every store install 401'd on subscription/credits/sync/Pro since 2026-08-01.

## What 1.3.0 contains
- **`ReconnectBanner`** — app-wide banner for installs without a device secret; inline Auth Token → `registerDevice()` → reload. Backend dedups by Account SID, so user/trial/subscription carry over.
- **Trial = every feature end to end** — backend `recordings` + `sms` gates use `user_has_access`. The Claude-model AI gate stays paid-only.
- **Trial transcription cap** — ~4 h/day of free managed transcription per user (`backend/lib/trial-cap.ts`, env `TRIAL_TRANSCRIBE_MINTS_PER_DAY`, table `trial_transcribe_mints`, pruned by the daily cron).
- **Readable device errors** — `src/shared/device-error.ts` maps Twilio errors to plain English (was the literal "undefined").
- **Permissions** — removed unused `identity`/`identity.email` (would have disabled the extension on update). Only `scripting` (no warning) + optional site access added vs 1.2.0.
- `@twilio/voice-sdk` 2.18.5.

## Release status
- [x] Store package built, audited (manifest, permissions diff, no secrets/dev URLs/remote code), submitted.
- [ ] **Privacy policy page** — PR #19 serves it at `https://dialler-mcp.vercel.app/privacy`; must be merged for the store listing link to work.
- [ ] After approval: install from the store on a clean profile; check setup screen + side panel.
- [ ] **Owner: run `scripts/migration-credits-settle-hardening.sql`** in the Supabase SQL editor (function-only, idempotent, safe before or after the backend deploy). Ships with the transcription metering change below.
- [ ] Real call test needs a working Twilio account (owner's Twilio account is suspended; a free Twilio trial on another email works).

## Owner dev access (no Twilio needed)
Owner logs in to their real account via a manually created device row (label `dev-login (manual)`) + a console snippet setting `settings`/`cloudUserId`/`cloudDeviceId`/`cloudDeviceSecret`. Owner's own user row set to `trialing` for 90 days (their row only; not Dodo). Revoke: `update public.devices set revoked_at = now() where label = 'dev-login (manual)';`. The red "Error" status is expected while the Twilio account is suspended.

## Product state
- Calls: BYO-Twilio. New installs = backend-hosted voice (`/api/voice/token`, `/api/voice/twiml`); ≤1.2.0 installs = legacy per-user Twilio Function (Twilio's Node 22 default applies to any rebuild; deployed Functions keep running).
- Hidden via `src/shared/flags.ts`: BYO Deepgram. SMS UI removed (backend routes dormant).
- Live: dialer, history, auto-dialer (CSV, 100 cap), recording, managed transcription, AI assistant (1.4.0, see above), Claude MCP connector (`/api/mcp/[userId]`), Pro $9/mo + 7-day trial via Dodo (new pricing in the plan is not built yet).
- Managed transcription metering: each window's reservation is created and settled from backend-held state (`backend/lib/transcribe-metering.ts`, `transcribe-settle.ts`); works with 1.3.0/1.4.0 clients unchanged.
- Prod DB: `anon`/`authenticated` roles have no grants (only the backend's service role touches the DB); telemetry views are `security_invoker`.

## Known follow-ups (not blocking)
- Claude connector URL uses the userId as its only credential — consider a separate, rotatable MCP token.
- Consider migrating legacy (Twilio Function) users to backend voice on reconnect — needs a real call test first.
- 13 DB functions still have a mutable `search_path` (low-priority Supabase advisor warning).
- Backend SMS routes dormant; `/api/users` is a deprecated anonymous-user endpoint kept for old builds.
- Backend `npm audit`: postcss inside `next@15.5.x` (build-time only; fix = Next 16).
- Managed transcription: reconcile billed windows against Deepgram usage (design item for 2.0).
- Future client build: settle a window right away when its Deepgram connect fails, so the hold is released instead of waiting for the reaper.
- Owner action: fund the Anthropic account before offering Claude models.

## Working rules
- **Never touch Dodo or customer-payment code/data.** Owner creates Dodo products/prices.
- **The repo is public** — keep security specifics and user data out of commits, PRs and docs.
- Prod DB changes: Claude writes the SQL; the owner runs it in the Supabase SQL editor.
