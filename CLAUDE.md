# CLAUDE.md — Twilio Dialpad

Guidance for Claude Code working in this repo. Source of truth = git history + `PROGRESS.md`.

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

## Hard invariants (security-critical — must always hold)
- Calls always BYO-Twilio. Twilio Auth Token is never persisted (verified in-memory, discarded).
- Backend is the source of truth for entitlements AND credit balance (row-locked ledger). Never trust the client for spend.
- Managed-AI settlement cost MUST come from the real vendor usage object, never an estimate.
- Our Anthropic / OpenAI / Deepgram keys never reach the client.
- At zero credit balance: stop AI/transcription gracefully (402) — NEVER drop the call.
- Marketing consent is separate and default-OFF.

## Managed AI + credits (v2 / Phase 8 — shipped)
- Multi-provider chatbox: model id `gpt-*` → OpenAI, else Anthropic. **Free tier = `gpt-5-mini` only** (default); all Claude models (haiku/sonnet/opus) are Pro-gated.
- `1 credit = $0.01` face. `credits = max(min_charge, ceil(vendor_usd × markup × 100))`, markup 3×. Knobs live in `pricing_config` (DB, versioned, hot-swappable).
- Transcription: BYO Deepgram (free) OR managed via temp-token JWTs (credits).
- Pricing/grant config: Supabase `pricing_config` (active row). Pro $9/mo + PWYW top-ups via Dodo.
- Provider keys set in Vercel (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `DEEPGRAM_API_KEY`). Anthropic account funding pending — Claude fails gracefully until funded; GPT-5 mini works.

## Workflow norms
- `main` is PR-protected — never push directly. Branch + PR.
- Keep `PROGRESS.md` current. Run code review before merge; fix Critical/Important findings.
