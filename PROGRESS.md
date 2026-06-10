# PROGRESS — Twilio Dialpad v1

> Canonical handoff. Source of truth = git history + [PR #3](https://github.com/Mohammad2460/twilio-dialpad/pull/3).
> To resume in a new session: read this file + `git log origin/main..HEAD` + the plan.
> Plan: `~/.claude/plans/generic-sauteeing-willow.md`

_Last updated: 2026-06-10 · branch `claude/musing-meninsky-d95614` · latest commit `783c0b7`_

## Status: v1 BUILT + REVIEWED + GREEN ON PR

All phases 0a→6 + tests shipped. Two code reviews (full-branch + Codex ×2 rounds) — every finding fixed. CI green.

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
