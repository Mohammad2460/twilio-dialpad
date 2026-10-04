# CLAUDE.md — Twilio Dialpad

Guidance for Claude Code working in this repo. Source of truth = git history + `PROGRESS.md` (current state only).

## What this is
Chrome MV3 side-panel extension: browser-based Twilio dialer (BYO-Twilio — users bring their own Twilio account). React + Tailwind + Vite (`@crxjs/vite-plugin`). Backend = Next.js 15 on Vercel (serverless, no persistent WebSocket) + Supabase Postgres.

- Extension code: `src/` (sidepanel, offscreen, background, shared, options)
- Backend: `backend/` (Next.js API routes, `lib/`)
- DB migrations / SQL: `scripts/`

## Build / run
- `pnpm build` → `dist/` (load unpacked at `chrome://extensions`). Build takes ~75s; the line `transforming (1) @crx/manifest` does NOT update in crx mode — that stillness is normal, not a hang. Wait for `✓ built`.
- Backend typecheck: `cd backend && npx tsc --noEmit`. Extension typecheck: `npx tsc --noEmit`.
- If a build is `^C`'d, run `pkill -9 -f 'vite build'` before retrying so orphaned esbuild/tsc don't stack and starve the next run.
- `@crxjs/vite-plugin` must stay on **2.x stable** (≥2.5.0). The old `2.0.0-beta.28` hangs the build indefinitely.
- Tests: `pnpm test` (extension, vitest) · `cd backend && npx vitest run`. Backend uses **pnpm** — don't commit a `package-lock.json`.

## Releasing (read this — skipping it is what killed v1.2.0)
- Shipping to `main` does NOT ship to users. Store users only get what's uploaded to the Chrome Web Store.
- Every store release: bump `version` in root `package.json` (manifest reads it) → `pnpm build` → zip `dist/` → upload.
- Backend auto-deploys to Vercel on merge to `main` — so backend changes hit old store builds immediately. Keep backend changes backward-compatible with the version live in the store.

## Hard invariants (security-critical — must always hold)
- Calls always BYO-Twilio. Twilio Auth Token is never persisted (verified in-memory, discarded).
- Backend is the source of truth for the plan, the usage counters AND credit balance (row-locked). Never trust the client for spend.
- Recorded / settled vendor cost MUST come from the real vendor usage object, never an estimate.
- Our Anthropic / OpenAI / Deepgram keys never reach the client.
- At a limit: stop AI/transcription gracefully (402) — NEVER drop or block a call.
- Marketing consent is separate and default-OFF.

## Plans, limits and managed AI
- **Free vs Pro:** Pro = active paid subscription (any Dodo product) or open 7-day trial; otherwise Free (`backend/lib/plan.ts`, mirrors SQL `user_has_access`). Never build a product-to-plan table; existing $9 subscribers are full Pro.
- **Counters:** transcription seconds + AI questions per calendar month (reset on the 1st, UTC), summaries per day. Atomic in SQL (`usage_take`, `transcribe_window_open`); wrappers in `backend/lib/usage.ts`. Check the counter before minting a transcription token and before every AI question.
- **Limits, prices and checkout product names** are in `pricing_config` (`plans`, `checkout`) with code defaults — changeable without a store release. A price change = new product name + price there; existing products are never edited.
- **Spend order:** monthly allowance → existing ledger balance ("Extra balance") → `402` with `error: 'insufficient_credits'` (keep that code: store builds stop gracefully on it). Users see hours, minutes and questions — never "credits".
- **Ledger:** no new credit grants (`free_grant` / `monthly_grant` = 0). It still holds existing balances, and records real vendor cost of allowance usage as zero-credit rows. `1 credit = $0.01`; balance-paid usage settles as `max(min_charge, ceil(vendor_usd × markup × 100))`.
- Multi-provider chatbox: model id `gpt-*` → OpenAI, else Anthropic. The in-extension AI assistant (`AI_CHAT_ENABLED`) offers `gpt-5-mini` only; Claude models require a paid sub (`user_is_paid`) and a funded Anthropic account. Call summaries: `POST /api/ai/summarize`; chat over calls: `/api/ai/chat` `mode: 'calls'`.
- Auth: per-device bearer `<deviceId>.<secret>`. The bare-`<userId>` legacy fallback closes at `LEGACY_AUTH_UNTIL` (env, default 2026-07-31); ≤1.2.0 installs migrate via `ReconnectBanner`.
- Transcription: managed via temp-token JWTs (BYO Deepgram is hidden behind a flag).
- Provider keys set in Vercel (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `DEEPGRAM_API_KEY`). Anthropic account funding pending — Claude fails gracefully until funded. `gpt-5-mini` confirmed working in production on 2026-10-04. When an AI route returns `generation_failed`, the reason is in the Vercel logs: search `vendor call failed`.

## Privacy policy
- The public policy the store listing links to lives in the owner's **gist**, not in this repo. `docs/PRIVACY_POLICY.md` is the source text — when it changes, the gist must be updated by the owner to match.

## Workflow norms
- `main` is PR-protected — never push directly. Branch + PR.
- Keep `PROGRESS.md` current. Run code review before merge; fix Critical/Important findings.
