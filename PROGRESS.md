# PROGRESS — Twilio Dialpad

> Current state only. History lives in git (`git log`) and merged PRs — don't re-grow a changelog here.
> **Plan of record:** [`docs/strategy/relaunch-plan.md`](docs/strategy/relaunch-plan.md) (AI assistant, pricing, growth, distribution, 2.0 roadmap).

_Last updated: 2026-10-04._

## Status
- **v1.3.0 submitted to the Chrome Web Store (2026-09-29)** — quiet fix release, no marketing. Built from `main` @ `881fa9e`.
- **Next: AI assistant v1** (item 1 in the relaunch plan) → quiet 1.4 → … → **2.0 relaunch**.

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
- Hidden via `src/shared/flags.ts`: in-extension AI chat (`AI_CHAT_ENABLED`), BYO Deepgram. SMS UI removed (backend routes dormant).
- Live: dialer, history, auto-dialer (CSV, 100 cap), recording, managed transcription, Claude MCP connector (`/api/mcp/[userId]`), Pro $9/mo + 7-day trial via Dodo (new pricing in the plan is not built yet).
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
