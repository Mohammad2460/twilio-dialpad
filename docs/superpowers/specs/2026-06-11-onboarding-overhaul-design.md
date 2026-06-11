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

### New setup flow

1. Setup screen collects: Account SID, Auth Token (in-memory only), email (required), client identity, selected phone number.
2. `POST /api/provision/{userId}` (device-auth'd) with `{ accountSid, authToken, callerId, numberSid, clientIdentity }`. Backend, using the Auth Token in-memory for this request only:
   - `createApiKey` → returns `{ sid, secret }`. Encrypt `secret` → store `api_key_secret_enc` + `api_key_sid`.
   - Generate a random `voice_capability_secret` (32 bytes hex).
   - `createTwimlApp` with `VoiceUrl = {BASE_URL}/api/voice/twiml/{userId}?k={voice_capability_secret}`, `VoiceMethod=POST`. Store `twiml_app_sid`.
   - Wire the number: set `VoiceApplicationSid = twiml_app_sid`, `SmsUrl = {BASE_URL}/api/sms/inbound?u={userId}&k={voice_capability_secret}`.
   - Store `caller_id`, `client_identity`, `account_sid`.
   - Discard the Auth Token.
   - Return `{ ok: true }`.
3. Extension writes `Settings` with a new marker `backendVoice: true` and `functionUrl` pointing at the backend token endpoint base. Calls work immediately.

### New backend routes

- `POST /api/voice/token/{userId}` — device-auth'd. Decrypts `api_key_secret_enc`, mints a Twilio `AccessToken` with a `VoiceGrant({ outgoingApplicationSid: twiml_app_sid, incomingAllow: true })`, identity = `client_identity`. Returns `{ token, identity }`. Mirrors the current `/token` Function (`function-code.ts` lines 4-26).
- `POST /api/voice/twiml/{userId}` — public, gated on `?k=` capability secret (constant-time compare). Reads `caller_id` + forward settings from the user row. Returns the same Dial TwiML the Function produces (`function-code.ts` lines 30-120): outbound `Dial` with `callerId`, inbound routing / forward, self-dial guard, recording flag when entitled. Port the logic verbatim.
- SMS send: extend existing `/api/sms/{userId}` send path to send via the Twilio Messages API using the decrypted API key secret (today the Function does this). Gate on Pro.
- Recording callback: `recordingStatusCallback` points at existing `/api/recordings/ingest`; backend downloads media using the decrypted API key secret (today the Function downloads then PUTs). Adjust ingest to perform the download itself.
- Inbound SMS: number `SmsUrl` points directly at `/api/sms/inbound` (today the Function forwards). Gate on `?u`/`?k`.

### Extension changes

- `SetupForm` → calls `provision()` (new `cloud.ts` helper) instead of `autoProvisionAll`. Replaces the multi-step `AutoSetupProgress` with a single ~3s spinner ("Connecting your Twilio account…").
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

RLS: service-role only (same as devices/device_functions).

---

## #2 — Mandatory email at setup

- Add a required `email` field to `SetupForm`, validated client-side (existing regex).
- On submit, before/with provisioning, `POST /api/email/{userId}` with `{ email, productConsent: true, verify: false }`. Keep the optional marketing checkbox (default OFF — separate consent, invariant).
- Backend `/api/email` POST: when body `verify === false`, store `email` + `product_email_consent_at` (+ `marketing_consent_at` if opted in) and return `{ ok: true }` WITHOUT generating a code or calling Resend (so no 503). When `verify` is absent/true, behavior is unchanged (generates + sends a code). Setup always passes `verify: false`. The PATCH verify route stays for future use but is unused by setup.
- Remove `EmailCaptureSheet`, the `showEmailCapture` state in `App.tsx`, and the `emailCaptured`/`emailPromptSkipped` storage keys.

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
- `tier` stays `pro` for display when `paid || trialing`? — show a distinct **"Trial"** label when trialing so the UI/banner can differ. Add `trialing` (already present) + keep `isPro` meaning "has any elevated access" but gate paid features on a new `can()` that checks `paid` for paid-only features.

### Backend gating

- `lib/auth` / per-endpoint access checks for SMS, recording, and Claude AI must gate on **paid**, not `user_has_access` (which is true during trial). Managed transcription token mint (`/api/transcribe/token`) stays available during trial WITHOUT charging credits (trial covers it) — settle at $0 / skip the ledger spend while `trialing`, or grant trial transcription from a dedicated free bucket. Implementation: while `trialing`, transcription mint succeeds and settlement does not debit credits.
- Claude models remain Pro-gated (already true via the 402 path); confirm trial users get 402 on Claude and gpt-5-mini works.

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

**Backend (new):** `app/api/provision/[userId]/route.ts`, `app/api/voice/token/[userId]/route.ts`, `app/api/voice/twiml/[userId]/route.ts`. **(modified):** `app/api/sms/[userId]/route.ts` (send via API key), `app/api/sms/inbound/route.ts` (direct, capability-gated), `app/api/recordings/ingest/route.ts` (download media), `app/api/email/[userId]/route.ts` (no-verify write), entitlement/access checks for SMS/recording/AI/transcription. **(new SQL):** `scripts/migration-backend-voice.sql`.

**Extension (modified):** `options/SetupForm.tsx` (email field + provision call), `options/ProvisioningWizard.tsx` + `options/AutoSetupProgress.tsx` (collapse to single fast spinner / retire), `offscreen/twilio-device.ts` (backend token path), `shared/cloud.ts` (`provision()` helper), `shared/entitlements.ts` (paid vs trial split + `managed_transcription` feature), `sidepanel/App.tsx` (remove email sheet; mount trial popup + banner). **(new):** `sidepanel/components/TrialStartPopup.tsx`, `sidepanel/components/TrialBanner.tsx`. **(removed):** `sidepanel/components/EmailCaptureSheet.tsx`.

## Testing

- Unit: entitlements paid-vs-trial matrix (trial grants transcription, denies SMS/recording/Claude; paid grants all; expired grants none). daysLeft banner threshold (<=3 shows, >3 hidden, expired hidden→expired state).
- Backend: provision happy path mocked (createApiKey/TwimlApp/wire); voice TwiML capability-secret accept/reject; token mint decrypt; transcription no-charge while trialing.
- Manual: fresh install → setup in seconds → first call connects → trial popup → (simulate daysLeft<=3) banner → checkout opens.

## Out of scope

- Migrating existing 6 users off their Functions (they keep working).
- Configuring Resend (verification dropped from setup).
- Reworking credit packs / pricing_config.
