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
- Backend is the source of truth for entitlements AND credit balance (row-locked ledger). Never trust the client for spend.
- Managed-AI settlement cost MUST come from the real vendor usage object, never an estimate.
- Our Anthropic / OpenAI / Deepgram keys never reach the client.
- At zero credit balance: stop AI/transcription gracefully (402) — NEVER drop the call.
- Marketing consent is separate and default-OFF.

## Managed AI + credits (v2 / Phase 8 — shipped)
- Multi-provider chatbox: model id `gpt-*` → OpenAI, else Anthropic. **Free tier = `gpt-5-mini` only** (default); all Claude models (haiku/sonnet/opus) require a PAID sub (`user_is_paid`). The in-extension AI assistant is on from 1.4.0 (`AI_CHAT_ENABLED` in `src/shared/flags.ts`) and offers `gpt-5-mini` only — no model picker until Anthropic is funded. Call summaries: `POST /api/ai/summarize`; chat over calls: `/api/ai/chat` `mode: 'calls'`.
- Entitlements: 7-day trial unlocks every feature (client `entitlements.can()` + backend `user_has_access`). Only the Claude-model gate is paid-only.
- Auth: per-device bearer `<deviceId>.<secret>`. The bare-`<userId>` legacy fallback closes at `LEGACY_AUTH_UNTIL` (env, default 2026-07-31); ≤1.2.0 installs migrate via `ReconnectBanner`.
- `1 credit = $0.01` face. `credits = max(min_charge, ceil(vendor_usd × markup × 100))`, markup 3×. Knobs live in `pricing_config` (DB, versioned, hot-swappable).
- Transcription: BYO Deepgram (free) OR managed via temp-token JWTs (credits).
- Pricing/grant config: Supabase `pricing_config` (active row). Pro $9/mo + PWYW top-ups via Dodo.
- Provider keys set in Vercel (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `DEEPGRAM_API_KEY`). Anthropic account funding pending — Claude fails gracefully until funded; GPT-5 mini works.

## Workflow norms
- `main` is PR-protected — never push directly. Branch + PR.
- Keep `PROGRESS.md` current. Run code review before merge; fix Critical/Important findings.
