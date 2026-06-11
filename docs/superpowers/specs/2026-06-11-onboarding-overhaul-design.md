# Onboarding Overhaul (Batch 2) — Design Spec

_Date: 2026-06-11. Branch: `claude/romantic-feistel-5fb77a`._

## Problem

New users churn at setup. Four issues:

1. **Wizard wait** — the per-user Twilio Serverless Function takes ~60-90s (build ~30s + deploy ~30s) before the first call can connect. Competitors log users in and let them call within seconds. The build/deploy is inherent to Twilio Serverless and cannot be sped up *while each user deploys their own Function*.
2. **Soft email capture** — current `EmailCaptureSheet` has a Skip button and silently auto-skips when Resend isn't configured (503). Result: ~0% email capture.
3. **Invisible, over-broad trial** — every user already starts a 7-day trial (`subscription_status='trialing'`, `trial_ends_at = now()+7d`), and during trial `user_has_access=TRUE` unlocks ALL Pro features. Users never *see* the trial, and it gives away too much (no upgrade incentive).
4. **No expiry warning** — nothing tells a user the trial is ending or offers to buy.

## Decisions (locked with user)

- **#1:** Move the voice webhook + token mint to our Vercel backend. Store the user's Twilio **API Key secret** encrypted. Setup becomes ~3-5s with no build. This is the standard browser-dialer architecture.
- **#2:** Mandatory email at the setup screen, no Skip, no 6-digit verification.
- **#3:** Light trial — trial unlocks managed transcription + gpt-5-mini only; SMS/recording/Claude/cloud-history are Pro-only (paid). Add a one-time trial-start popup.
- **#4:** Trial-expiry banner in the last 3 days + upgrade CTA → existing Dodo checkout.

## Security invariants (must hold)

- Twilio **Auth Token is never persisted** — used in-memory once during setup, then discarded. (Unchanged.)
- We now store the user's **Twilio API Key secret** encrypted at rest (AES-256-GCM via existing `CONFIG_ENC_KEY` / `crypto.ts`). It is scoped and revocable, and is NOT the Auth Token.
- Our Anthropic/OpenAI/Deepgram keys never reach the client. (Unchanged.)
- Backend remains the source of truth for entitlements + credit balance.
- At zero balance: 402, never drop the call. (Unchanged.)
- Voice/SMS webhooks are authenticated by a high-entropy per-user **capability secret** embedded in the URL Twilio calls (we configure that URL during setup). This replaces X-Twilio-Signature verification, which is impossible without the Auth Token. Same trust model as the existing `configSecret`.

---

## #1 — Instant setup (backend-hosted voice)

### New setup flow — provisioning folds into `/api/devices/register`

There is NO separate `/api/provision` endpoint and NO device-auth chicken-and-egg. `/api/devices/register` already accepts `{ accountSid, authToken }`, verifies Twilio ownership with the Auth Token in-memory (then discards it), dedups the user on the verified SID, and mints the device secret. Backend provisioning piggybacks on that same request — the Auth Token is already in scope there.

1. Setup screen collects: Account SID, Auth Token (in-memory only), email (required), client identity, selected phone number (`numberSid` + `callerId`), optional marketing opt-in.
2. Extension → `POST /api/devices/register` with `{ accountSid, authToken, numberSid, callerId, clientIdentity, email, marketingConsent?, provision: true }`. (No `functionUrl`/`configSecret` — that signals the backend-voice path.) Backend, after the existing ownership-verify + user/device creation:
   - `createApiKey` (Twilio REST, Basic auth = SID:authToken) → `{ sid, secret }`. Encrypt `secret` → store `api_key_secret_enc` + `api_key_sid`.
   - Generate `voice_capability_secret` (32 bytes hex).
   - `createTwimlApp` with `VoiceUrl = {BASE_URL}/api/voice/twiml/{userId}?k={voice_capability_secret}`, `VoiceMethod=POST`. Store `twiml_app_sid`.
   - Wire the number (`POST /Accounts/{sid}/IncomingPhoneNumbers/{numberSid}.json`): `VoiceApplicationSid = twiml_app_sid`, `SmsUrl = {BASE_URL}/api/sms/inbound?u={userId}&k={voice_capability_secret}`, `SmsMethod=POST`.
   - Store `caller_id`, `client_identity`, `account_sid`, and the email (see #2, no-verify).
   - Free-grant (existing logic). Discard the Auth Token.
   - Return `{ userId, deviceId, deviceSecret, mcpUrl }` (unchanged shape).
3. Extension writes `Settings { accountSid, clientIdentity, callerId, backendVoice: true }` + caches `cloudUserId`/`cloudDeviceId`/device secret (as `registerDevice` already does). No `functionUrl` for new installs — the token URL is derived as `{BASE_URL}/api/voice/token/{userId}`. Calls work immediately.

**Idempotency / partial-failure:** before creating, check whether the user row already has `api_key_sid`/`twiml_app_sid` (re-run setup) and reuse them rather than orphaning Twilio resources. On any provisioning step failure, return a clear error code (`provision_failed`, with the failing step) and HTTP 502; the extension shows "Setup failed — try again". A re-run reuses stored SIDs. (Acceptable orphan risk at current scale; a stray API key is revocable in the Twilio console.)

**Runtime config (forward / incoming / record):** today these live as Function env vars (`INCOMING_ENABLED`/`FORWARD_ENABLED`/`FORWARD_NUMBER`/`RECORD_OUTGOING`) updated via the `/config` Function (`CONFIG_JS`). In the backend model they become columns on the voice-config row, read at TwiML-render time. The settings-update path writes the DB directly — NO Twilio call, NO redeploy. The `/voice/twiml` handler reads these columns to build the inbound cascade + recording flag.

### New backend routes

- `POST /api/voice/token/{userId}` — device-auth'd. Decrypts `api_key_secret_enc`, mints a Twilio `AccessToken` with a `VoiceGrant({ outgoingApplicationSid: twiml_app_sid, incomingAllow: true })`, identity = `client_identity`. Returns `{ token, identity }`. Mirrors the current `/token` Function (`function-code.ts` lines 4-26).
- `POST /api/voice/twiml/{userId}` — public, gated on `?k=` capability secret (constant-time compare). Reads `caller_id` + forward settings from the user row. Returns the same Dial TwiML the Function produces (`function-code.ts` lines 30-120): outbound `Dial` with `callerId`, inbound routing / forward, self-dial guard, recording flag when entitled. Port the logic verbatim.
- SMS send: extend existing `/api/sms/{userId}` send path to send via the Twilio Messages API using the decrypted API key secret (today `SMS_JS` does this with `API_KEY_SID:API_KEY_SECRET`). Gate on **paid** (see #3 — `user_is_paid`).
- Recording callback: `recordingStatusCallback` (set in the `/voice/twiml` Dial opts) points at existing `/api/recordings/ingest`; backend downloads the media itself using the decrypted API key secret (today `RECORDING_STATUS_JS` downloads `recordingUrl + '.mp3'` with Basic auth then PUTs to the signed URL). Adjust ingest to perform the download → upload inline. Recording delete (`/api/recordings/{userId}` DELETE + retention purge) deletes via Twilio REST with the stored API key secret (today `DELETE_RECORDING_JS`).
- Inbound SMS: number `SmsUrl` points directly at `/api/sms/inbound?u={userId}&k={secret}` (today `INCOMING_SMS_JS` forwards to the same route with `secret` in the body). Backend validates `?k` capability secret (constant-time). NOTE: existing-user Functions still POST `{ secret }` in the body — `/api/sms/inbound` must accept BOTH the body-`secret` (legacy) and the `?k` query (new) auth shapes.

### Extension changes

- `SetupForm` → after verifying creds + loading numbers (existing `twilio.verifyAccount`/`listPhoneNumbers` client-side), calls `registerDevice({ ..., numberSid, callerId, clientIdentity, email, marketingConsent, provision: true })` instead of `autoProvisionAll`. Replaces the multi-step `AutoSetupProgress` with a single ~3s spinner ("Connecting your Twilio account…"). `cloud.ts` `registerDevice` signature extended with the provisioning + email fields.
- `offscreen/twilio-device.ts` `fetchToken`: when `settings.backendVoice`, POST to `/api/voice/token/{userId}` with device-secret auth; else keep the legacy `functionUrl/token` GET (existing users).
- Delete/retire `ProvisioningWizard` multi-step UI, `AutoSetupProgress`. Keep `autoProvisionAll` in `twilio-rest.ts` only if any legacy path needs it; otherwise remove.

### Migration

- No forced migration. Existing users (have a deployed Function, `backendVoice` falsy) keep the legacy token + voice path unchanged.
- New installs use the backend path.
- Two voice paths coexist; both already proven (the Function code is the reference port).

### DB migration (`scripts/migration-backend-voice.sql`)

Add to `users` (or a dedicated `voice_config` table, keyed by user_id):
- `api_key_sid TEXT`
- `api_key_secret_enc TEXT` (AES-256-GCM ciphertext)
- `twiml_app_sid TEXT`
- `voice_capability_secret TEXT`
- `caller_id TEXT`
- `client_identity TEXT`
- `account_sid TEXT` (if not already present)
- `incoming_enabled BOOLEAN DEFAULT true`
- `forward_enabled BOOLEAN DEFAULT false`
- `forward_number TEXT`
- `record_outgoing BOOLEAN DEFAULT false`

RLS: service-role only (same as devices/device_functions). The API key secret is encrypted at rest with `CONFIG_ENC_KEY` (existing `crypto.ts` `encryptSecret`/`decryptSecret`).

---

## #2 — Mandatory email at setup

- Add a required `email` field to `SetupForm`, validated client-side (existing regex). Submit is disabled until a valid email is present. Keep an optional marketing checkbox (default OFF — separate consent, invariant).
- Email is captured in the SAME `/api/devices/register` call (no separate request, no second round trip). Register writes `email` + `product_email_consent_at = now()` (transactional/mandatory) and `marketing_consent_at = now()` only when `marketingConsent === true`. No verification code, no Resend dependency, no 503 path.
- The standalone `/api/email/{userId}` POST/PATCH (code + Resend) is left intact for future use but is unused by setup. `EmailCaptureSheet`, the `showEmailCapture` state in `App.tsx`, and the `emailCaptured`/`emailPromptSkipped` storage keys are removed.
- Edge case: existing users (already registered, re-running nothing) won't hit setup again, so they won't be force-prompted for email. Acceptable — mandatory email targets NEW installs (the churn problem). A future in-app prompt for legacy users is out of scope.

---

## #3 — Light trial + trial-start popup

### Entitlements split

Current: `isPro = hasAccess`, and trial → `hasAccess` → all `PRO_FEATURES`. Change so trial does NOT grant the paid-only features.

- Add a `paid` notion distinct from `hasAccess`:
  - `paid` = `status ∈ {active, past_due}` with `periodEnd > now`, OR `status === 'cancelled'` with `periodEnd > now`. (NOT trialing.)
  - `trialing` = `status === 'trialing' && trialEnds > now`.
- Feature gating:
  - `managed_transcription` (new Feature) → granted when `paid || trialing`.
  - `ai_analysis` (Claude), `sms`, `recording`, `cloud_history`, `autodial_unlimited` → `paid` only.
  - gpt-5-mini chat → always available (free), unchanged.
- `Entitlements` gains a `paid: boolean` field. `can(f)` returns `true` for `managed_transcription` when `paid || trialing`; for all other (paid-only) features it requires `paid`. `trialing`/`daysLeft` already exist (drive popup + banner). `isPro` retained for display ("has elevated access") but is NOT the gate for paid-only features — `can()` is.
- The backend `Subscription` shape already carries `status` + `hasAccess` + `daysLeft`; derive `paid` client-side from `status` + `currentPeriodEnd` (mirror `user_is_paid`).

### Backend gating

New SQL function `user_is_paid(uid)` — mirrors `user_has_access` but EXCLUDES trialing:
```
active|past_due with current_period_end > now  → true
cancelled with current_period_end > now        → true
trialing                                        → FALSE
else                                            → false
```
Replace `user_has_access` with `user_is_paid` in exactly three call sites (all currently grant during trial):
- `app/api/sms/[userId]/route.ts` `requireAccess` (lines 18-19)
- `app/api/recordings/[userId]/route.ts` `requireAccess` (lines 17-18)
- `app/api/ai/chat/route.ts` `hasPro` (line 40) — keeps Claude paid-only; `FREE_MODELS`/gpt-5-mini path unchanged → trial + free users get gpt-5-mini, get 402 on Claude.

`user_has_access` itself stays (still used by `/api/subscription` mirror + entitlements meaning "has elevated access incl. trial"). Do NOT delete it.

**Managed transcription free during trial.** Transcription is credit-metered, NOT subscription-gated today (`/api/transcribe/token` reserves; `/api/transcribe/settle` debits). Add a trialing short-circuit: when `user_is_trialing(uid)` (or reuse: `user_has_access && !user_is_paid`), the token mint succeeds WITHOUT a credit reserve, and settle is a no-op debit (optionally write a 0-credit ledger row for observability). Paid users keep normal credit metering. Free (no trial / expired) users: managed transcription falls back to the existing credit path (free_grant taste → 402), BYO Deepgram always available. Call audio is never affected by a 402.

### Trial-start popup

- One-time modal shown on first side-panel open after setup completes (guard via `chrome.storage.local` key `trialPopupSeen`).
- Copy: "🎉 You're on a 7-day free trial — managed call transcription + AI analysis unlocked. Calling is always free." + "Got it" dismiss.
- No backend change — trial already starts at user creation (`trial_ends_at` default). The popup surfaces it.

---

## #4 — Trial-expiry banner + buy

- New `TrialBanner` component rendered at the top of the side panel when `entitlements.trialing && daysLeft != null && daysLeft <= 3`.
- Copy: "Trial ends in {N} day(s) — upgrade to keep transcription and unlock Claude, SMS & recording." + **Upgrade** button → `createCheckout(userId)` → open hosted Dodo URL (existing flow in `cloud.ts`).
- Expired state: when not `paid` and trial is over (`status==='expired'` or trialEnds < now), side panel shows free tier with a persistent upgrade CTA (reuse `ProTab`/`UpgradeSheet`). Managed transcription stops gracefully (falls back to BYO Deepgram or off); calls never affected.
- `daysLeft` already returned by `/api/subscription/{userId}` and surfaced via `getEntitlements`.

---

## Components / files touched

**Backend (new):** `app/api/voice/token/[userId]/route.ts`, `app/api/voice/twiml/[userId]/route.ts`. **(modified):** `app/api/devices/register/route.ts` (fold in provisioning + email when `provision:true`), `app/api/sms/[userId]/route.ts` (send via stored API key; gate `user_is_paid`), `app/api/sms/inbound/route.ts` (accept `?k` query auth alongside legacy body `secret`), `app/api/recordings/[userId]/route.ts` (gate `user_is_paid`; delete via API key), `app/api/recordings/ingest/route.ts` (download + upload media inline), `app/api/ai/chat/route.ts` (`hasPro` → `user_is_paid`), `app/api/transcribe/token/route.ts` + `app/api/transcribe/settle/route.ts` (trialing → free, no debit). **(new SQL):** `scripts/migration-backend-voice.sql` (voice-config columns + `user_is_paid` / `user_is_trialing` functions).

**Extension (modified):** `options/SetupForm.tsx` (email field + single register-with-provision call), `options/ProvisioningWizard.tsx` + `options/AutoSetupProgress.tsx` (collapse to single fast spinner / retire the multi-step UI), `offscreen/twilio-device.ts` (backend token path when `backendVoice`), `shared/cloud.ts` (`registerDevice` extended with `numberSid`/`callerId`/`clientIdentity`/`email`/`marketingConsent`/`provision` fields), `shared/types.ts` (`Settings.backendVoice`), `shared/entitlements.ts` (paid vs trial split + `managed_transcription` feature), `sidepanel/App.tsx` (remove email sheet; mount trial popup + banner). **(new):** `sidepanel/components/TrialStartPopup.tsx`, `sidepanel/components/TrialBanner.tsx`. **(removed):** `sidepanel/components/EmailCaptureSheet.tsx`.

## Testing

- Unit: entitlements paid-vs-trial matrix (trial grants transcription, denies SMS/recording/Claude; paid grants all; expired grants none). daysLeft banner threshold (<=3 shows, >3 hidden, expired hidden→expired state).
- Backend: provision happy path mocked (createApiKey/TwimlApp/wire); voice TwiML capability-secret accept/reject; token mint decrypt; transcription no-charge while trialing.
- Manual: fresh install → setup in seconds → first call connects → trial popup → (simulate daysLeft<=3) banner → checkout opens.

## Out of scope

- Migrating existing 6 users off their Functions (they keep working).
- Configuring Resend (verification dropped from setup).
- Reworking credit packs / pricing_config.
