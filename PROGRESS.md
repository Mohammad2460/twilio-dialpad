# PROGRESS — Twilio Dialpad

> Canonical handoff. Source of truth = git history + the plan.
> Plan: `~/.claude/plans/generic-sauteeing-willow.md`

---

## v2 — Managed AI + credits (Phase 8) — IN PROGRESS

_Branch `claude/v2-managed-ai` (off main `1ab3d24`). Spec: `docs/superpowers/specs/2026-06-10-v2-managed-ai-credits-design.md`._

**Locked:** managed AI = Claude family (Haiku default free; Sonnet/Opus Pro); OpenRouter deferred; managed transcription (P8.3) DEFERRED (Vercel serverless can't host an audio WS relay — transcription stays BYO-Deepgram); safe conservative pricing defaults (N=1000, mono, free-grant 50) pending real burn data.
**Invariants held:** calls always BYO-Twilio (credits meter AI only) · Auth Token never persisted · backend = source of truth (row-locked ledger) · marketing consent separate/default-OFF · zero balance never drops a call. **Additive only — existing v1 users: no re-login, no breakage, managed mode opt-in.**

| Phase | State |
|---|---|
| Spec | ✅ `3e64e68` |
| **P8.1** ledger schema + atomic plpgsql (reserve/settle/refund/grant/expire, oversell-safe) | ✅ code `d615ba8` — **NOT yet applied to prod** (awaiting explicit approval) |
| **P8.2** typed billing engine + cost adapters + caps | ✅ `a786998` |
| **P8.4** `/api/ai/chat` managed Claude chatbox (reserve→settle, Haiku free/Sonnet+Opus Pro) | ✅ code, backend typecheck pending |
| **P8.5** Dodo webhook grants (monthly+topup, idempotent) + `/api/credits/expire` cron | ✅ code |
| **P8.6** client `credits.ts` + `AiChatbox` + `CreditBalance` + `/api/credits/[userId]` | ✅ `1cf33df` (extension typecheck green) |
| **P8.3** managed Deepgram proxy | ⛔ DEFERRED (infra) |
| **P8.7** billing-math tests | ✅ written; ledger/concurrency tests = DB-level (Supabase branch) TODO |
| **P8.8** verification | ⏳ |

**Done since:**
- [x] Prod migration applied to Supabase `xyhkklqnbxoucnjlckaz` (3 tables, 6 functions, pricing v1). **Smoke test caught + fixed a real bug** (`grant_credits` wrote `expires_at` to the ledger — column lives on buckets). Full reserve/settle/refund/expire/idempotency/insufficient cycle verified green on a throwaway user.
- [x] Dodo top-up: `ensureTopUpProduct` (self-provisioning 1¢/unit one-time product) + `/api/checkout/topup/[userId]` (pack allowlist 1000/2500/5000) + client `startTopUp` + chatbox upsell.
- [x] Backend + extension typecheck both 0 errors.

**Code review fixes (all applied + verified):**
- [x] #1 free-tier grant on device registration (idempotent).
- [x] #2 `reap_stale_reservations` cron — refunds orphaned holds (prod + smoke-tested).
- [x] #3 Dodo top-up rewritten to **Pay-What-You-Want + exact `amount`** (cents=credits) per Dodo's dynamic-pricing API — removes the fragile quantity×unit-price assumption. Confirmed against Dodo docs (`pay_what_you_want`, `price` floor, `suggested_price`; checkout `product_cart[].amount`).

**Outstanding v2:**
- [ ] **Set `ANTHROPIC_API_KEY` in Vercel prod** — chat returns 503 without it (graceful). LAST blocker for live managed AI.
- [ ] First real top-up will self-provision the PWYW product; confirm one live $10 purchase charges correctly before promoting.
- [ ] Mount `CreditBalance` in ProTab/StatusBar (component ready; not yet placed).
- [ ] Backend unit tests (`credits-math.test.ts`) hang in THIS sandbox (vitest/esbuild stall) — run in CI; math hand-verified + DB smoke green.
- [ ] Open PR for `claude/v2-managed-ai`.

---

## v1 (shipped — `1ab3d24` on main)

_Last updated: 2026-06-10 · branch `claude/musing-meninsky-d95614` · latest commit `503c5de`_

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
