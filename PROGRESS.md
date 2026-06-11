# PROGRESS — Twilio Dialpad

> Canonical handoff. Source of truth = git history + `CLAUDE.md`.
> To resume in a new session: read this file + `CLAUDE.md` + `git log origin/main..HEAD`.

_Last updated: 2026-06-11._

## Status: Batch 2 onboarding overhaul SHIPPED — merged to `main` via [PR #8](https://github.com/Mohammad2460/twilio-dialpad/pull/8). Prod Supabase migration applied; Vercel auto-deploys on merge. Batch 1 via [PR #6](https://github.com/Mohammad2460/twilio-dialpad/pull/6); v2 via [PR #4](https://github.com/Mohammad2460/twilio-dialpad/pull/4).

### Batch 2 — onboarding overhaul ([PR #8](https://github.com/Mohammad2460/twilio-dialpad/pull/8), SHIPPED)
_Spec: `docs/superpowers/specs/2026-06-11-onboarding-overhaul-design.md` · Plan: `docs/superpowers/plans/2026-06-11-onboarding-overhaul.md`._

What changed (all typechecks 0 errors; 34 ext + 11 backend tests pass; `npx vite build` ✓):
- **Instant setup (wizard killed).** Per-user Twilio Serverless build/deploy (~60-90s) removed for NEW installs. Voice now backend-hosted: `/api/voice/token/[userId]` (mints AccessToken from stored API key secret, device-auth) + `/api/voice/twiml/[userId]` (TwiML webhook, capability-secret in URL). Provisioning folds into `/api/devices/register` (`provision:true`): create API key → store secret **encrypted** (AES-256-GCM) → create TwiML app (VoiceUrl→backend) → wire number Voice+SMS. Setup is now ~3-5s, single call. **Auth Token still never persisted.**
- **Existing users unaffected** — they keep their deployed Functions (`backend_voice=false`); every modified route branches on `backend_voice` and preserves the legacy Function path. No forced migration.
- **Mandatory email at setup** (no Skip, no 6-digit verify). Captured in the register call → `email` + `product_email_consent_at`. `EmailCaptureSheet` + soft-prompt removed. Marketing checkbox stays optional/default-OFF.
- **Light trial.** Trial no longer unlocks all Pro. New `user_is_paid` SQL gates SMS/recording/Claude (paid only); `user_is_trialing` makes managed transcription FREE during trial (no credit debit in `/api/transcribe/token`+`settle`). gpt-5-mini stays free. Client `entitlements.ts` split into `paid` vs `trialing` + new `managed_transcription` feature.
- **Trial-start popup** (one-time, `trialPopupSeen`) + **expiry banner** (last 3 days, `daysLeft<=3`) with Upgrade → Dodo checkout.
- **SMS send / recording media+delete / inbound SMS** moved to backend for backend-voice users (use stored API key; inbound SMS accepts `?u`/`?k` capability auth alongside legacy body `secret`).
- **Fixed `npm test`** (broken by the crx 2.5.0 upgrade): dedicated `vitest.config.ts` (no crx plugin, `node` env — happy-dom hung vitest 2.x).

**DONE:**
- [x] Prod Supabase migration `scripts/migration-backend-voice.sql` applied + verified (11 cols, `user_is_paid`/`user_is_trialing`; `user_has_access` preserved).
- [x] Backend deployed to Vercel via merge (git-integration auto-deploy of `main`).
- [x] Code review: 1 Important finding (SSRF/credential-leak in recording ingest — API-key secret could be exfiltrated by a forged callback) fixed by pinning the download host to `*.twilio.com`.

**OUTSTANDING (user action):**
- [ ] Manual e2e on prod: fresh install → setup in seconds → first call connects → trial popup → (simulate `trial_ends_at` ~2d) banner → checkout. Verify the TwiML App VoiceUrl = `…/api/voice/twiml/<uid>?k=…` and the number's Voice = that app.
- [ ] Existing trial users now lose SMS/recording/Claude (light-trial gating) + gain free managed transcription — expected; watch for confusion.
- [ ] `pnpm build` uses bare `tsc` (fails in worktree PATH); `npx tsc --noEmit && npx vite build` works. Non-blocking cleanup.

### Batch 1 status (shipped)

### v2 — Phase 8: managed AI + credits (DONE)
- Credit ledger (append-only `credit_ledger` + spendable `credit_buckets` + versioned `pricing_config`); atomic oversell-safe plpgsql; reserve→settle→refund w/ idempotency. Applied to prod Supabase `xyhkklqnbxoucnjlckaz`.
- Managed AI chatbox, **multi-provider**: `gpt-*` → OpenAI, else Anthropic. **Free tier = `gpt-5-mini` only**; all Claude models Pro-gated (Claude vendor cost only fires for paying users).
- Managed Deepgram transcription via temp-token JWTs (BYO free OR managed credits).
- Dodo: Pro $9/mo monthly grant + PWYW one-time top-ups; webhook grants gated on `payment.succeeded`, idempotent.
- Pricing: `1 cr = $0.01`, `credits = max(min_charge, ceil(vendor_usd × 3 × 100))`. Conservative defaults (markup 3, min_charge 1, monthly_grant 1000, free_grant 50) — tune from real burn data in `pricing_config`.
- Vercel keys set: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `DEEPGRAM_API_KEY`. **Anthropic account not yet funded** → Claude fails gracefully (refund + "AI request failed"); GPT-5 mini works.
- Reviews closed: superpowers (C1 OpenAI no-usage settle) + Codex (P1 seed gpt-5-mini, P1 gate top-up on payment success). Backend + extension tsc 0 errors.

### Build fix (2026-06-11)
- `@crxjs/vite-plugin` `2.0.0-beta.28` hung `vite build` indefinitely → upgraded to **2.5.0**; deduped rollup inputs (sidepanel/options come from the manifest); disabled sourcemaps. Build now completes (~75s). Note: `transforming (1) @crx/manifest` line is static in crx mode — not a hang.

### Outstanding (user actions, not code)
- Fund Anthropic account → Claude models go live for Pro users.
- One live test-mode Dodo top-up before promoting.

---

## UX Overhaul + Monetization (Batch 1) — [PR #6](https://github.com/Mohammad2460/twilio-dialpad/pull/6)

_Spec: `docs/superpowers/specs/2026-06-11-ux-overhaul-monetization-design.md` · Plan: `docs/superpowers/plans/2026-06-11-ux-overhaul-monetization.md`. Batch 2 to follow in a new session._

Shipped (both typechecks 0 errors, `pnpm build` ✓; full-branch code review passed, one Important finding fixed):
- **Standalone AI tab** — new bottom-nav "AI" tab. `AiChatbox` made context-optional (general chat OR pick a recent transcribed call). Backend `/api/ai/chat` gained additive `mode: 'call' | 'general'` (general system prompt when no transcript). `streamChat` transcript now optional + `mode`.
- **PRO-locked models** — model picker shows a PRO badge; tapping a Claude model as a free user opens `UpgradeModal` (benefits + checkout) instead of failing. Backend 402 stays the source of truth.
- **AI promo** — "✨ Ask AI about your calls" button below the dialpad → AI tab.
- **Pro tab = sales surface** — Free vs Pro tier comparison + credit-system explainer + top-up packs (1000/2500/5000) in upsell + trialing states.
- **Credits** — header credits chip in `StatusBar` (cached→live, taps → Pro).
- **Dialpad caret** — number display is now a focusable `<input>` with a visible caret (click-to-position, type, paste); global keydown guarded so the field owns typing.
- **Options tab → setup-only** — stripped to the Twilio provisioning wizard + mic-permission card; all duplicated controls removed (they live in the side-panel `SettingsTab`). `options_page` kept (mic grant needs a full tab).
- **Dup settings removed** — killed the `StatusBar` gear ⚙ and the `Dialpad` "Settings" pill; footer Settings tab is the sole entry.
- **Bug: recurring mic banner** — new `useMicPermission()` (Permissions API); banner gated on REAL mic state (`prompt`/`denied`), decoupled from device registration. Once granted it never recurs.
- **Bug: transcript sometimes doesn't start** — the managed path (`managed-transcription.ts`) now retries the INITIAL window once on a transient (network/503/socket-open) failure; terminal 402 never retries. BYO path already self-retries internally. `AiChatbox` aborts the AI stream on unmount. Call audio never affected.

### Batch 2 (next session) — deferred minors from review
- ProTab "expired" view shows the credit explainer + CreditsSection (cosmetic dedupe).
- Locked-model upgrade popup can trigger via two paths (harmless, modal idempotent).
- Chat input Enter has no shift-guard (single-line — only matters if it becomes multi-line).

---

## v1 (shipped earlier — [PR #3](https://github.com/Mohammad2460/twilio-dialpad/pull/3))

## Status: v1 COMPLETE — session closed. Working tree clean, branch in sync, CI green.

All phases 0a→6 + tests shipped. Two code reviews (full-branch + Codex ×3 rounds) — every finding fixed. CI green. **Only remaining action: merge PR #3 to main when you decide to ship.**

## What shipped (phase → result)

- **0a** transcription stream-race fix; Deepgram model dropdown.
- **0b** per-device secret auth replaces `token===userId`; Twilio ownership verify (Auth Token discarded in-memory); configSecret AES-256-GCM at rest.
- **0** entitlements module (72h grace, fail-closed for expired); transcript segment timing for talk-ratio.
- **1** side-panel nav + Settings home.
- **2 / 2b** Pro paywall surface + soft email capture (marketing consent separate, default-OFF, verified before send).
- **3 / 4** AI showcase (talk-ratio local+free, Claude insight gated); dialpad redial + 15/day auto-dial cap.
- **5 / 5b** SMS (Pro): backend→Function send (API-key creds in Function env), Protected inbound webhook, configSecret HMAC, idempotent, STOP/opt-out enforced.
- **5c** call recording (Pro): media through Function via signed upload URL → private Supabase bucket; signed playback; user delete + retention purge cron + Twilio-side delete Function.
- **6** click-to-call bubble: runtime `optional_host_permissions` + `chrome.scripting.registerContentScripts` (NOT static broad match); static asset `public/content/bubble.js`.
- **9** tests: 34 passing (entitlements, talk-ratio, daily-cap, storage, phone, messaging).

## Review fixes applied

Full-branch: C1 bubble perms · C2 SMS opt-out · I1 device_functions revocation scoping · I2 email double-write · I3 RLS on devices/device_functions · I4 recording retention+Twilio delete.
Codex: P1 bounded legacy auth (cutoff + migrated-device check) · P2 Resend email delivery + 503 degrade · P2 recording gated on `messagingProvisioned` · P1 fail-closed on device-count query error.

## Infra (all done)

- Supabase prod `xyhkklqnbxoucnjlckaz`: all 5 migrations applied incl. RLS on devices/device_functions + sms_opt_outs. Migration SQL in `scripts/`.
- Vercel prod env set: `CONFIG_ENC_KEY`, `CRON_SECRET`. Daily purge cron in `backend/vercel.json`.

## Outstanding / deferred (intentional)

- [ ] Optional Vercel env `RESEND_API_KEY` + `EMAIL_FROM` for live email delivery (without them email capture returns 503, not a crash).
- [ ] Merge PR #3 to main when ready.
- [ ] **Phase 8** (managed-AI + credits) = v2, deferred until v1 validates paid demand.
- [ ] No backend test runner (vitest is `src/`-only) — backend SMS opt-out unit test deferred.
- [ ] Minor: country-code picker, inbound-call recording, SMS first-call re-prompt, configSecret/MCP rotation endpoints, Phase 7 dedicated polish.

## How to resume (new session)

```
git checkout claude/musing-meninsky-d95614
git log origin/main..HEAD --oneline   # every commit, the real record
cat PROGRESS.md                        # this file
gh pr view 3                           # PR state + review threads
```
