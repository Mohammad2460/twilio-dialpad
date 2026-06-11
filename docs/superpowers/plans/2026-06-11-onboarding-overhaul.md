# Onboarding Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make first-call setup near-instant (no Twilio Serverless build), force email at setup, narrow the 7-day trial to managed-transcription + gpt-5-mini, and surface the trial with a start popup + expiry banner.

**Architecture:** Move the per-user Twilio voice webhook + token mint off the deployed Serverless Function and onto our Vercel backend; provisioning folds into the existing `/api/devices/register` call (Auth Token already in-memory there). Store the user's Twilio API Key secret encrypted at rest. Trial gating splits from paid gating via a new `user_is_paid` SQL function. Existing users keep their deployed Functions (no forced migration).

**Tech Stack:** Next.js 15 (App Router, route handlers), Supabase Postgres (plpgsql/sql functions), Chrome MV3 extension (React + Vite), Twilio REST + Voice SDK, vitest.

**Spec:** `docs/superpowers/specs/2026-06-11-onboarding-overhaul-design.md`

**Conventions to follow:**
- Backend routes return JSON via the local `j(body, status)` helper + `corsHeaders`; `export const runtime = 'nodejs'`; always export `OPTIONS`.
- Auth: `authenticate(req)` → `{ userId, deviceId, legacy }` or null; `authenticateUser(req, userId)`.
- Encryption: `encryptSecret(plain): string` / `decryptSecret(enc): string` from `backend/lib/crypto.ts` (AES-256-GCM via `CONFIG_ENC_KEY`).
- Backend typecheck: `cd backend && npx tsc --noEmit`. Extension typecheck: `npx tsc --noEmit` (repo root). Backend tests: `cd backend && npx vitest run`. Extension tests: `npx vitest run`.
- Build: `pnpm build` (~75s; `transforming (1) @crx/manifest` static line is normal). If `^C`'d: `pkill -9 -f 'vite build'` first.
- `main` is PR-protected — branch + PR. Commit frequently.

---

## File Structure

**Backend — new:**
- `backend/app/api/voice/token/[userId]/route.ts` — mint Twilio Voice AccessToken from stored API key secret.
- `backend/app/api/voice/twiml/[userId]/route.ts` — TwiML voice webhook (capability-secret gated); ports `VOICE_JS`.

**Backend — modified:**
- `backend/app/api/devices/register/route.ts` — when `provision: true`, create API key + TwiML app + wire number + store voice config + email.
- `backend/app/api/sms/[userId]/route.ts` — send via stored API key; gate `user_is_paid`.
- `backend/app/api/sms/inbound/route.ts` — accept `?k` query auth alongside legacy body `secret`.
- `backend/app/api/recordings/[userId]/route.ts` — gate `user_is_paid`; delete via stored API key.
- `backend/app/api/recordings/ingest/route.ts` — download Twilio media + upload to bucket inline (no Function).
- `backend/app/api/ai/chat/route.ts` — `hasPro` uses `user_is_paid`.
- `backend/app/api/transcribe/token/route.ts` + `backend/app/api/transcribe/settle/route.ts` — trialing → free (no reserve/debit).
- `backend/lib/twilio-server.ts` — **new** small server-side Twilio REST helper (Basic auth) for provisioning + send + media (backend has no `twilio-rest.ts`).

**Backend — new SQL:**
- `scripts/migration-backend-voice.sql` — voice-config columns + `user_is_paid` + `user_is_trialing`.

**Extension — modified:**
- `src/shared/types.ts` — `Settings.backendVoice?: boolean`.
- `src/shared/cloud.ts` — extend `registerDevice` opts; add `getVoiceConfig`/settings-update helper if needed.
- `src/offscreen/twilio-device.ts` — backend token path when `backendVoice`.
- `src/options/SetupForm.tsx` — required email field + marketing checkbox + single register-with-provision call.
- `src/options/ProvisioningWizard.tsx` + `src/options/AutoSetupProgress.tsx` — collapse to one fast spinner.
- `src/shared/entitlements.ts` — `paid` + `managed_transcription`.
- `src/sidepanel/App.tsx` — remove email sheet; mount popup + banner.

**Extension — new:**
- `src/sidepanel/components/TrialStartPopup.tsx`, `src/sidepanel/components/TrialBanner.tsx`.

**Extension — removed:**
- `src/sidepanel/components/EmailCaptureSheet.tsx`.

---

## Phase A — Database

### Task A1: Voice-config columns + paid/trialing SQL functions

**Files:**
- Create: `scripts/migration-backend-voice.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- Backend-hosted voice: per-user Twilio voice config + paid/trialing predicates.
-- Idempotent. Apply to prod Supabase via MCP apply_migration.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS api_key_sid           TEXT,
  ADD COLUMN IF NOT EXISTS api_key_secret_enc    TEXT,   -- AES-256-GCM (CONFIG_ENC_KEY)
  ADD COLUMN IF NOT EXISTS twiml_app_sid         TEXT,
  ADD COLUMN IF NOT EXISTS voice_capability_secret TEXT,
  ADD COLUMN IF NOT EXISTS caller_id             TEXT,
  ADD COLUMN IF NOT EXISTS client_identity       TEXT,
  ADD COLUMN IF NOT EXISTS incoming_enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS forward_enabled       BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS forward_number        TEXT,
  ADD COLUMN IF NOT EXISTS record_outgoing       BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS backend_voice         BOOLEAN NOT NULL DEFAULT FALSE;
-- account_sid already exists as twilio_account_sid (migration-identity.sql).

-- Paid = elevated access EXCLUDING trial.
CREATE OR REPLACE FUNCTION user_is_paid(uid UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN subscription_status IN ('active', 'past_due') AND current_period_end > now() THEN TRUE
    WHEN subscription_status = 'cancelled' AND current_period_end > now() THEN TRUE
    ELSE FALSE
  END
  FROM users WHERE id = uid;
$$;

-- Trialing = trial window still open (used to make transcription free during trial).
CREATE OR REPLACE FUNCTION user_is_trialing(uid UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
  SELECT (subscription_status = 'trialing' AND trial_ends_at > now())
  FROM users WHERE id = uid;
$$;
```

- [ ] **Step 2: Apply via Supabase MCP**

Apply `migration-backend-voice.sql` to prod project `xyhkklqnbxoucnjlckaz` using the Supabase MCP `apply_migration` tool (name: `backend_voice`). Confirm no error.

- [ ] **Step 3: Verify functions exist**

Run via MCP `execute_sql`: `SELECT user_is_paid(id), user_is_trialing(id) FROM users LIMIT 1;`
Expected: returns booleans, no error.

- [ ] **Step 4: Commit**

```bash
git add scripts/migration-backend-voice.sql
git commit -m "feat(db): voice-config columns + user_is_paid/user_is_trialing"
```

---

## Phase B — Backend voice (token + TwiML + provisioning)

### Task B1: Server-side Twilio REST helper

The backend has no Twilio helper (the extension's `twilio-rest.ts` is client-only). Create a minimal one.

**Files:**
- Create: `backend/lib/twilio-server.ts`

- [ ] **Step 1: Write the helper**

```typescript
// Minimal server-side Twilio REST (Basic auth). Used for provisioning, SMS send,
// recording media/delete. Credentials are passed per-call (Auth Token during
// provisioning; API Key SID:Secret thereafter) — never module-global.

const API = 'https://api.twilio.com/2010-04-01';

function basic(user: string, pass: string): string {
  return 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
}

async function form<T>(url: string, auth: string, body?: Record<string, string>): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body ? new URLSearchParams(body).toString() : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (!res.ok) throw new Error(`twilio ${res.status}: ${json?.message ?? 'error'}`);
  return json;
}

/** Provisioning (Auth Token). */
export async function createApiKey(sid: string, token: string) {
  return form<{ sid: string; secret: string }>(`${API}/Accounts/${sid}/Keys.json`, basic(sid, token), {
    FriendlyName: 'TwilioDialpad',
  });
}
export async function createTwimlApp(sid: string, token: string, voiceUrl: string) {
  return form<{ sid: string }>(`${API}/Accounts/${sid}/Applications.json`, basic(sid, token), {
    FriendlyName: 'TwilioDialpad', VoiceUrl: voiceUrl, VoiceMethod: 'POST',
  });
}
export async function updateTwimlAppVoiceUrl(sid: string, token: string, appSid: string, voiceUrl: string) {
  return form(`${API}/Accounts/${sid}/Applications/${appSid}.json`, basic(sid, token), {
    VoiceUrl: voiceUrl, VoiceMethod: 'POST',
  });
}
export async function wireNumber(
  sid: string, token: string, numberSid: string, appSid: string, smsUrl: string,
) {
  return form(`${API}/Accounts/${sid}/IncomingPhoneNumbers/${numberSid}.json`, basic(sid, token), {
    VoiceApplicationSid: appSid, SmsUrl: smsUrl, SmsMethod: 'POST',
  });
}

/** Runtime (API Key). */
export async function sendSms(
  apiKeySid: string, apiKeySecret: string, accountSid: string, to: string, from: string, body: string,
) {
  return form<{ sid: string }>(`${API}/Accounts/${accountSid}/Messages.json`, basic(apiKeySid, apiKeySecret), {
    To: to, From: from, Body: body,
  });
}
export async function downloadRecording(
  apiKeySid: string, apiKeySecret: string, recordingUrl: string,
): Promise<ArrayBuffer> {
  const res = await fetch(recordingUrl + '.mp3', { headers: { Authorization: basic(apiKeySid, apiKeySecret) } });
  if (!res.ok) throw new Error(`recording download ${res.status}`);
  return res.arrayBuffer();
}
export async function deleteRecording(
  apiKeySid: string, apiKeySecret: string, accountSid: string, recordingSid: string,
): Promise<void> {
  const res = await fetch(`${API}/Accounts/${accountSid}/Recordings/${recordingSid}.json`, {
    method: 'DELETE', headers: { Authorization: basic(apiKeySid, apiKeySecret) },
  });
  if (res.status !== 204 && res.status !== 404) throw new Error(`recording delete ${res.status}`);
}
```

- [ ] **Step 2: Typecheck**

Run: `cd backend && npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add backend/lib/twilio-server.ts
git commit -m "feat(backend): server-side Twilio REST helper"
```

### Task B2: Voice token mint route

The Voice SDK token grant requires `@twilio/voice-sdk` server libs. Twilio's `twilio` npm package provides `jwt.AccessToken`. Confirm it's a backend dep; if absent, `npm i twilio` in `backend/`.

**Files:**
- Create: `backend/app/api/voice/token/[userId]/route.ts`

- [ ] **Step 1: Ensure `twilio` package present**

Run: `cd backend && node -e "require('twilio')" 2>&1 | head -1`
If it prints a MODULE_NOT_FOUND error: `cd backend && npm i twilio`. Else continue.

- [ ] **Step 2: Write the route**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import twilio from 'twilio';
import { corsHeaders } from '@/lib/cors';
import { authenticateUser } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { decryptSecret } from '@/lib/crypto';

export const runtime = 'nodejs';

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}
function j(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: corsHeaders });
}

/**
 * POST /api/voice/token/[userId] — mint a Twilio Voice AccessToken from the
 * user's stored API Key secret. Device-auth. Mirrors the legacy TOKEN_JS.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  if (!(await authenticateUser(req, userId))) return j({ error: 'Unauthorized' }, 401);

  const { data: u, error } = await supabase
    .from('users')
    .select('twilio_account_sid, api_key_sid, api_key_secret_enc, twiml_app_sid, client_identity')
    .eq('id', userId)
    .single();
  if (error || !u || !u.api_key_secret_enc || !u.api_key_sid || !u.twiml_app_sid) {
    return j({ error: 'voice_not_provisioned' }, 409);
  }

  const secret = decryptSecret(u.api_key_secret_enc);
  const identity = (u.client_identity ?? 'dialpad').toString().slice(0, 121);

  const AccessToken = twilio.jwt.AccessToken;
  const token = new AccessToken(u.twilio_account_sid, u.api_key_sid, secret, { identity, ttl: 3600 });
  token.addGrant(new AccessToken.VoiceGrant({ outgoingApplicationSid: u.twiml_app_sid, incomingAllow: true }));

  return j({ token: token.toJwt(), identity });
}
```

- [ ] **Step 3: Typecheck**

Run: `cd backend && npx tsc --noEmit`
Expected: 0 errors. (If `twilio` types missing: `npm i -D @types/...` is not needed — `twilio` ships its own types.)

- [ ] **Step 4: Commit**

```bash
git add backend/app/api/voice/token backend/package.json backend/package-lock.json
git commit -m "feat(backend): voice token mint route"
```

### Task B3: TwiML voice webhook route

Ports `VOICE_JS` (`src/shared/function-code.ts:28-114`) to the backend. Auth = capability secret in `?k`.

**Files:**
- Create: `backend/app/api/voice/twiml/[userId]/route.ts`

- [ ] **Step 1: Write the route**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import twilio from 'twilio';
import { timingSafeEqual } from 'node:crypto';
import { supabase } from '@/lib/supabase';

export const runtime = 'nodejs';

function safeEq(a: string, b: string): boolean {
  const ab = Buffer.from(a), bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
function xml(twiml: { toString(): string }) {
  return new NextResponse(twiml.toString(), { status: 200, headers: { 'Content-Type': 'text/xml' } });
}

/**
 * POST /api/voice/twiml/[userId]?k=<capability secret>
 * Wired as the TwiML App VoiceUrl. Handles outbound (From=client:) + inbound PSTN.
 * Ports function-code.ts VOICE_JS. Twilio sends form-urlencoded.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  const k = req.nextUrl.searchParams.get('k') ?? '';

  const { data: u } = await supabase
    .from('users')
    .select('voice_capability_secret, caller_id, client_identity, incoming_enabled, forward_enabled, forward_number, record_outgoing')
    .eq('id', userId)
    .single();

  const VoiceResponse = twilio.twiml.VoiceResponse;
  if (!u || !u.voice_capability_secret || !safeEq(k, u.voice_capability_secret)) {
    const t = new VoiceResponse();
    t.reject({ reason: 'rejected' });
    return xml(t);
  }

  const form = await req.formData();
  const from = (form.get('From') ?? '').toString();
  const to = (form.get('To') ?? '').toString().trim();
  const eventCallerId = (form.get('CallerId') ?? '').toString().trim();
  const isClientOutbound = from.toLowerCase().startsWith('client:');
  const twiml = new VoiceResponse();

  // ── PSTN inbound — cascade routing.
  if (!isClientOutbound) {
    const identity = u.client_identity || 'default';
    const forwardTo = /^\+\d{6,}$/.test((u.forward_number ?? '').trim()) ? (u.forward_number as string).trim() : '';
    if (u.incoming_enabled) {
      twiml.dial({ answerOnBridge: true, timeout: 20 }).client(identity);
      if (u.forward_enabled && forwardTo) twiml.dial({ answerOnBridge: true, timeout: 25 }).number(forwardTo);
    } else if (u.forward_enabled && forwardTo) {
      twiml.dial({ answerOnBridge: true, timeout: 25 }).number(forwardTo);
    } else {
      twiml.reject({ reason: 'busy' });
    }
    return xml(twiml);
  }

  // ── Outbound.
  if (!to) { twiml.say({ voice: 'alice' }, 'No destination provided.'); return xml(twiml); }
  const callerId = eventCallerId || (u.caller_id ?? '').toString().trim();
  if (!callerId) { twiml.say({ voice: 'alice' }, 'Configuration error. The caller ID is missing. Please re-run setup.'); return xml(twiml); }
  if (callerId === to) { twiml.say({ voice: 'alice' }, 'You cannot dial your own Twilio number from this device. Please dial a different number.'); return xml(twiml); }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://dialler-mcp.vercel.app';
  const dialOpts: Record<string, unknown> = { callerId, answerOnBridge: true, timeout: 30 };
  if (u.record_outgoing) {
    twiml.say({ voice: 'alice' }, 'This call may be recorded.');
    dialOpts.record = 'record-from-answer-dual';
    dialOpts.recordingStatusCallback = `${baseUrl}/api/recordings/ingest?u=${userId}&k=${u.voice_capability_secret}`;
  }
  const dial = twiml.dial(dialOpts);
  if (/^\+?\d{6,}$/.test(to.replace(/[\s\-()]/g, ''))) dial.number(to);
  else dial.client(to);
  return xml(twiml);
}
```

- [ ] **Step 2: Typecheck**

Run: `cd backend && npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Manual verify (capability secret gate)**

Run (reject path — wrong secret):
```bash
curl -s -X POST "http://localhost:3000/api/voice/twiml/<anyUserId>?k=wrong" -d "From=client:dialpad&To=+15555550123" | head
```
Expected: `<Reject reason="rejected"/>` TwiML. (Start backend with `cd backend && npm run dev` first.)

- [ ] **Step 4: Commit**

```bash
git add backend/app/api/voice/twiml
git commit -m "feat(backend): TwiML voice webhook (capability-secret gated)"
```

### Task B4: Fold provisioning + email into device register

**Files:**
- Modify: `backend/app/api/devices/register/route.ts`

- [ ] **Step 1: Add imports + provisioning after device creation**

After the existing free-grant block and BEFORE the final `return j(...)` in `backend/app/api/devices/register/route.ts`, the device row already exists (`device.id`). Add provisioning. Add these imports at top:

```typescript
import { encryptSecret } from '@/lib/crypto'; // already imported alongside generateSecret/hashSecret — verify
import { randomBytes } from 'node:crypto';
import { createApiKey, createTwimlApp, wireNumber } from '@/lib/twilio-server';
```

Extend the body type + reads near the top of `POST` (alongside `accountSid`/`authToken`):

```typescript
// in the body type:
//   numberSid?: unknown; callerId?: unknown; clientIdentity?: unknown;
//   email?: unknown; marketingConsent?: unknown; provision?: unknown;
const provision = body.provision === true;
const numberSid = typeof body.numberSid === 'string' ? body.numberSid : '';
const callerId = typeof body.callerId === 'string' ? body.callerId : '';
const clientIdentity = typeof body.clientIdentity === 'string' ? body.clientIdentity : 'dialpad';
const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
const marketingConsent = body.marketingConsent === true;
```

Insert this block just before the final `return j({ userId, deviceId: device.id, ... }, 201)`:

```typescript
  // ── Backend-voice provisioning (new installs). Auth Token still in-memory here.
  if (provision) {
    if (!numberSid || !callerId) return j({ error: 'missing_provision_fields' }, 400);
    try {
      // Reuse existing resources on re-run (idempotent).
      const { data: cur } = await supabase
        .from('users')
        .select('api_key_sid, api_key_secret_enc, twiml_app_sid, voice_capability_secret')
        .eq('id', userId)
        .single();

      const capSecret = cur?.voice_capability_secret ?? randomBytes(32).toString('hex');
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://dialler-mcp.vercel.app';
      const voiceUrl = `${baseUrl}/api/voice/twiml/${userId}?k=${capSecret}`;
      const smsUrl = `${baseUrl}/api/sms/inbound?u=${userId}&k=${capSecret}`;

      let apiKeySid = cur?.api_key_sid ?? '';
      let apiKeySecretEnc = cur?.api_key_secret_enc ?? '';
      if (!apiKeySid || !apiKeySecretEnc) {
        const key = await createApiKey(accountSid, authToken);
        apiKeySid = key.sid;
        apiKeySecretEnc = encryptSecret(key.secret);
      }
      let twimlAppSid = cur?.twiml_app_sid ?? '';
      if (!twimlAppSid) {
        const app = await createTwimlApp(accountSid, authToken, voiceUrl);
        twimlAppSid = app.sid;
      }
      await wireNumber(accountSid, authToken, numberSid, twimlAppSid, smsUrl);

      const emailCols = email
        ? { email, product_email_consent_at: new Date().toISOString(), ...(marketingConsent ? { marketing_consent_at: new Date().toISOString() } : {}) }
        : {};
      const { error: upErr } = await supabase
        .from('users')
        .update({
          api_key_sid: apiKeySid,
          api_key_secret_enc: apiKeySecretEnc,
          twiml_app_sid: twimlAppSid,
          voice_capability_secret: capSecret,
          caller_id: callerId,
          client_identity: clientIdentity,
          backend_voice: true,
          ...emailCols,
        })
        .eq('id', userId);
      if (upErr) { console.error('[register] voice config save failed', upErr); return j({ error: 'provision_failed', step: 'persist' }, 500); }
    } catch (e) {
      console.error('[register] provisioning failed', e);
      return j({ error: 'provision_failed', detail: e instanceof Error ? e.message.slice(0, 120) : 'error' }, 502);
    }
  }
```

- [ ] **Step 2: Verify `encryptSecret` import not duplicated**

Open `backend/app/api/devices/register/route.ts` — line 4 already imports `{ generateSecret, hashSecret, encryptSecret }`. If so, DELETE the duplicate `import { encryptSecret }` you added in Step 1 and keep only `randomBytes` + the `twilio-server` imports.

- [ ] **Step 3: Typecheck**

Run: `cd backend && npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add backend/app/api/devices/register/route.ts
git commit -m "feat(backend): fold voice provisioning + email into device register"
```

---

## Phase C — Backend gating (trial vs paid) + transcription-free trial

### Task C1: SMS + recordings + AI gate on paid

**Files:**
- Modify: `backend/app/api/sms/[userId]/route.ts:18-19`
- Modify: `backend/app/api/recordings/[userId]/route.ts:17-18`
- Modify: `backend/app/api/ai/chat/route.ts:40`

- [ ] **Step 1: Swap RPC in sms route**

In `backend/app/api/sms/[userId]/route.ts`, inside `requireAccess`, change:
```typescript
  const { data } = await supabase.rpc('user_has_access', { uid: userId });
```
to:
```typescript
  const { data } = await supabase.rpc('user_is_paid', { uid: userId });
```

- [ ] **Step 2: Swap RPC in recordings route**

Same change in `backend/app/api/recordings/[userId]/route.ts` `requireAccess`: `user_has_access` → `user_is_paid`.

- [ ] **Step 3: Swap RPC in ai/chat route**

In `backend/app/api/ai/chat/route.ts` `hasPro` (line 40): `user_has_access` → `user_is_paid`. (gpt-5-mini stays free via `FREE_MODELS`; Claude now requires paid, not trial.)

- [ ] **Step 4: Typecheck**

Run: `cd backend && npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/sms backend/app/api/recordings backend/app/api/ai
git commit -m "feat(backend): gate SMS/recording/Claude on paid (not trial)"
```

### Task C2: Free managed transcription during trial

**Files:**
- Modify: `backend/app/api/transcribe/token/route.ts`
- Modify: `backend/app/api/transcribe/settle/route.ts`

- [ ] **Step 1: Add trialing check + skip reserve in token route**

In `backend/app/api/transcribe/token/route.ts`, after `const userId = auth.userId;`, add:
```typescript
  const { data: trialing } = await supabase.rpc('user_is_trialing', { uid: userId });
```
(Add `import { supabase } from '@/lib/supabase';` at top.)

Then wrap the reserve block so trial users skip it. Replace the reserve try/catch + the success response's `requestId` with: when `trialing` is truthy, set `requestId = ''` and skip `reserve`; otherwise keep existing reserve logic. Concretely, change:
```typescript
  const estCredits = estimateTranscriptionCredits(WINDOW_SECONDS / 60, model, pricing);
  const idemKey = body.windowKey ?? crypto.randomUUID();
  let requestId: string;
  try {
    requestId = await reserve(userId, estCredits, idemKey, `deepgram:${model}`, pricing.version);
  } catch (e) {
    if (e instanceof InsufficientCreditsError) { /* ...402... */ }
    throw e;
  }
```
to:
```typescript
  const estCredits = estimateTranscriptionCredits(WINDOW_SECONDS / 60, model, pricing);
  const idemKey = body.windowKey ?? crypto.randomUUID();
  let requestId = '';
  if (!trialing) {
    try {
      requestId = await reserve(userId, estCredits, idemKey, `deepgram:${model}`, pricing.version);
    } catch (e) {
      if (e instanceof InsufficientCreditsError) {
        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://dialler-mcp.vercel.app';
        return j({ error: 'insufficient_credits', need: estCredits, topUpUrl: `${baseUrl}/api/checkout/${userId}` }, 402);
      }
      throw e;
    }
  }
```

- [ ] **Step 2: Skip prev-window settle for trial in token route**

The prev-window settle block calls `settle(body.prevRequestId, ...)`. A trial window has `requestId=''`, so the client sends `prevRequestId=''` → guard already requires `body.prevRequestId` truthy, so empty is skipped. No change needed, but confirm the `if (body.prevRequestId && ...)` guard remains.

- [ ] **Step 3: Guard the standalone settle route**

In `backend/app/api/transcribe/settle/route.ts`, settle is keyed by `requestId`. Trial windows have no `requestId`, so the client won't call settle for them. Add a defensive no-op: if `requestId` is empty/missing, return `{ ok: true, skipped: true }` 200. Locate the request-id parse and add at the top of the handler after parsing body:
```typescript
  if (!requestId) return j({ ok: true, skipped: true });
```
(Match the existing `j`/response helper + variable name in that file.)

- [ ] **Step 4: Typecheck**

Run: `cd backend && npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/transcribe
git commit -m "feat(backend): managed transcription free during trial (no credit debit)"
```

### Task C3: Recording ingest downloads media inline; SMS send + delete via API key

**Files:**
- Modify: `backend/app/api/recordings/ingest/route.ts`
- Modify: `backend/app/api/sms/[userId]/route.ts`
- Modify: `backend/app/api/recordings/[userId]/route.ts`

- [ ] **Step 1: Inspect current ingest + SMS-send + delete flows**

Read `backend/app/api/recordings/ingest/route.ts`, the send branch of `backend/app/api/sms/[userId]/route.ts`, and the DELETE branch of `backend/app/api/recordings/[userId]/route.ts`. Today these forward to the user's Twilio Function (`function_url` from `device_functions`) with the `config_secret`. For backend-voice users (`backend_voice = true`), there is no Function — do the Twilio call inline with the stored API key.

- [ ] **Step 2: Branch ingest on backend_voice**

In `backend/app/api/recordings/ingest/route.ts`: after resolving the user, load `backend_voice, api_key_sid, api_key_secret_enc, twilio_account_sid`. For the legacy path (`backend_voice` false) keep returning the signed `uploadUrl` (the Function PUTs). For backend-voice, additionally accept `?u`/`?k` capability auth (the `/voice/twiml` callback passes them), then download + upload inline:

```typescript
import { downloadRecording } from '@/lib/twilio-server';
import { decryptSecret } from '@/lib/crypto';
// ...after computing uploadUrl + having recordingUrl from the callback body...
if (user.backend_voice && user.api_key_secret_enc) {
  const buf = Buffer.from(await downloadRecording(user.api_key_sid, decryptSecret(user.api_key_secret_enc), recordingUrl));
  const put = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'audio/mpeg' }, body: buf });
  if (!put.ok) console.error('[ingest] inline upload failed', put.status);
  return j({ ok: true }, 200);
}
```
NOTE: the `/voice/twiml` `recordingStatusCallback` posts Twilio's standard params (`RecordingUrl`, `RecordingSid`, `CallSid`, `RecordingDuration`) as form-urlencoded; parse them with `await req.formData()` when `?u`/`?k` are present, mirroring `RECORDING_STATUS_JS`.

- [ ] **Step 3: Branch SMS send on backend_voice**

In the send branch of `backend/app/api/sms/[userId]/route.ts`: load the user's `backend_voice, api_key_sid, api_key_secret_enc, twilio_account_sid, caller_id`. For backend-voice, send inline:
```typescript
import { sendSms } from '@/lib/twilio-server';
import { decryptSecret } from '@/lib/crypto';
// ...inside POST send branch, for backend_voice users...
const r = await sendSms(user.api_key_sid, decryptSecret(user.api_key_secret_enc), user.twilio_account_sid, to, user.caller_id, msgBody);
// persist sent message as today; r.sid is the Twilio SID
```
Keep the legacy Function-forward path for `backend_voice` false.

- [ ] **Step 4: Branch recording delete on backend_voice**

In the DELETE branch of `backend/app/api/recordings/[userId]/route.ts`: for backend-voice users delete via `deleteRecording(api_key_sid, decryptSecret(secret), accountSid, recordingSid)` instead of forwarding to the Function. Keep legacy path otherwise.

- [ ] **Step 5: Typecheck + commit**

Run: `cd backend && npx tsc --noEmit` → 0 errors.
```bash
git add backend/app/api/recordings backend/app/api/sms
git commit -m "feat(backend): inline media/SMS/delete via stored API key for backend-voice users"
```

### Task C4: SMS inbound accepts query-param auth

**Files:**
- Modify: `backend/app/api/sms/inbound/route.ts`

- [ ] **Step 1: Accept `?k` alongside legacy body secret**

Read the route. Today it authenticates via `body.secret === <config secret>`. Add: if `req.nextUrl.searchParams.get('k')` is present, resolve the user from `?u`, compare `k` (constant-time) against that user's `voice_capability_secret`, and accept. Twilio posts inbound SMS as form-urlencoded for the new direct path, so parse `await req.formData()` for `From`/`To`/`Body`/`MessageSid` when `?u`/`?k` present; keep JSON-body parsing for the legacy Function-forward path. Return TwiML `<Response/>` (empty) — STOP/HELP is handled account-side.

- [ ] **Step 2: Typecheck + commit**

Run: `cd backend && npx tsc --noEmit` → 0 errors.
```bash
git add backend/app/api/sms/inbound/route.ts
git commit -m "feat(backend): SMS inbound accepts capability-secret query auth"
```

---

## Phase D — Extension setup flow

### Task D1: Settings type + cloud.registerDevice extension

**Files:**
- Modify: `src/shared/types.ts:81` (Settings)
- Modify: `src/shared/cloud.ts` (registerDevice)

- [ ] **Step 1: Add `backendVoice` to Settings**

In `src/shared/types.ts`, inside `interface Settings`, add after `functionUrl: string;`:
```typescript
  /** True for installs provisioned on the backend (no Twilio Function). */
  backendVoice?: boolean;
```

- [ ] **Step 2: Extend registerDevice opts + body**

In `src/shared/cloud.ts`, change the `registerDevice` opts type + request body to include the provisioning + email fields:
```typescript
export async function registerDevice(opts: {
  accountSid: string;
  authToken: string;
  functionUrl?: string;
  configSecret?: string;
  label?: string;
  numberSid?: string;
  callerId?: string;
  clientIdentity?: string;
  email?: string;
  marketingConsent?: boolean;
  provision?: boolean;
}): Promise<CloudAccount> {
```
The body already serializes `opts` via `JSON.stringify(opts)` — no further change to the fetch.

- [ ] **Step 3: Typecheck + commit**

Run: `npx tsc --noEmit` → 0 errors.
```bash
git add src/shared/types.ts src/shared/cloud.ts
git commit -m "feat(ext): Settings.backendVoice + registerDevice provisioning fields"
```

### Task D2: Offscreen backend token path

**Files:**
- Modify: `src/offscreen/twilio-device.ts:18-25,306,435`

- [ ] **Step 1: Add backend token fetch**

`fetchToken(functionUrl, identity)` currently GETs `functionUrl/token`. Add a backend variant. Add an import for the auth header + base URL (mirror how other shared modules read `BASE_URL`; `cloud.ts` exposes `authHeader(userId)`). Replace `fetchToken` with a branch:

```typescript
import { authHeader } from '@shared/cloud';

const BASE_URL = 'https://dialler-mcp.vercel.app'; // match cloud.ts BASE_URL

async function fetchToken(settings: Settings): Promise<string> {
  if (settings.backendVoice) {
    const { cloudUserId } = await chrome.storage.local.get('cloudUserId');
    if (typeof cloudUserId !== 'string') throw new Error('Not registered');
    const res = await fetch(`${BASE_URL}/api/voice/token/${cloudUserId}`, {
      method: 'POST',
      headers: { Authorization: await authHeader(cloudUserId), 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (!res.ok) throw new Error(`Token fetch failed: ${res.status}`);
    const json = (await res.json()) as { token?: string };
    if (!json.token) throw new Error('Token response missing token field');
    return json.token;
  }
  const url = new URL('/token', settings.functionUrl);
  url.searchParams.set('identity', settings.clientIdentity);
  const res = await fetch(url.toString(), { method: 'GET' });
  const json = (await res.json()) as { token?: string };
  if (!json.token) throw new Error('Token response missing token field');
  return json.token;
}
```

- [ ] **Step 2: Update call sites**

The two call sites (≈ lines 306 and 435) call `fetchToken(settings.functionUrl, settings.clientIdentity)` / `fetchToken(this.settings.functionUrl, this.settings.clientIdentity)`. Change both to `fetchToken(settings)` / `fetchToken(this.settings)`.

- [ ] **Step 3: Typecheck + commit**

Run: `npx tsc --noEmit` → 0 errors.
```bash
git add src/offscreen/twilio-device.ts
git commit -m "feat(ext): offscreen mints voice token from backend when backendVoice"
```

### Task D3: SetupForm — required email + single provision call; collapse wizard

**Files:**
- Modify: `src/options/SetupForm.tsx`
- Modify: `src/options/ProvisioningWizard.tsx`
- Modify: `src/options/AutoSetupProgress.tsx`

- [ ] **Step 1: Add email + marketing state + required gating to SetupForm**

In `src/options/SetupForm.tsx`, add state:
```typescript
  const [email, setEmail] = useState('');
  const [marketing, setMarketing] = useState(false);
```
Add validity: `const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());`
Add an email `<Field>` after the Auth Token field:
```tsx
        <Field label="Email (for trial reminders + account recovery)">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value.trim())}
            placeholder="you@example.com" autoComplete="email" />
          {email && !emailOk && <Hint error>Enter a valid email.</Hint>}
        </Field>
        <label className="flex items-start gap-2 text-xs text-gray-600">
          <input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} className="mt-0.5" />
          <span>Also send product tips &amp; offers (optional)</span>
        </label>
```
Gate submit: change `canSubmit` to also require `emailOk`:
```typescript
  const canSubmit = !!selectedNumber && identityOk && emailOk && !loading;
```
Pass email through `onSubmit`: extend the `SetupInput`/`onSubmit` payload with `email` + `marketing` (update the `submit()` call):
```typescript
    onSubmit({ accountSid, authToken, clientIdentity, callerId: selectedNumber.phone_number, numberSid: selectedNumber.sid, email, marketing });
```

- [ ] **Step 2: Extend SetupInput**

In `src/options/ProvisioningWizard.tsx`, add to `SetupInput`:
```typescript
  email: string;
  marketing: boolean;
```

- [ ] **Step 3: Replace multi-step provisioning with a single register-with-provision call**

In `src/options/ProvisioningWizard.tsx`, the wizard currently sets `input` then renders `AutoSetupProgress` (which runs `autoProvisionAll` → deploys the Function). Replace that with a single fast call. Change the `ProvisioningWizard` so that on submit it calls a new `runBackendSetup(inp)`:

```typescript
import { registerDevice } from '@shared/cloud';
// ...
async function runBackendSetup(inp: SetupInput) {
  // Verifies ownership + provisions API key/TwiML app/number + stores email — all server-side.
  await registerDevice({
    accountSid: inp.accountSid,
    authToken: inp.authToken,
    clientIdentity: inp.clientIdentity,
    numberSid: inp.numberSid,
    callerId: inp.callerId,
    email: inp.email,
    marketingConsent: inp.marketing,
    provision: true,
  });
  const settings: Settings = {
    accountSid: inp.accountSid,
    apiKeySid: '',            // owned server-side now
    twimlAppSid: '',          // owned server-side now
    functionUrl: '',          // unused for backendVoice
    clientIdentity: inp.clientIdentity,
    defaultCallerId: inp.callerId,
    configuredAt: Date.now(),
    backendVoice: true,
    incomingEnabled: true,
    forwardEnabled: false,
    forwardNumber: '',
    hubspotToken: initial?.hubspotToken,
    hubspotPortalId: initial?.hubspotPortalId,
  };
  await storage.setSettings(settings);
  chrome.runtime.sendMessage({ type: 'device.init' }).catch(() => {});
  onDone(settings);
}
```
Render a simple busy/spinner + error state while `runBackendSetup` runs instead of `AutoSetupProgress`. Keep `track('twilio_creds_submitted', ...)` and add `track('autodeploy_succeeded')` after success (preserve funnel metrics). On error, show the message + a retry button.

- [ ] **Step 4: Retire AutoSetupProgress (and unused autoProvisionAll path)**

`AutoSetupProgress.tsx` is no longer rendered for new setups. Either delete the file and remove its import from `ProvisioningWizard.tsx`, or leave it unused. Prefer deletion to avoid dead code; remove the now-unused `autoProvisionAll` import in `ProvisioningWizard`. (Leave `autoProvisionAll` in `twilio-rest.ts` — harmless, and a fallback reference.)

- [ ] **Step 5: Typecheck + build + commit**

Run: `npx tsc --noEmit` → 0 errors. Then `pnpm build` → `✓ built`.
```bash
git add src/options
git commit -m "feat(ext): instant backend setup — required email, single provision call, retire multi-step wizard"
```

---

## Phase E — Entitlements split (TDD)

### Task E1: paid vs trial in entitlements

**Files:**
- Modify: `src/shared/entitlements.ts`
- Test: `src/shared/entitlements.test.ts` (create if absent; check `ls src/shared/*.test.ts`)

- [ ] **Step 1: Write failing tests**

Create/extend `src/shared/entitlements.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { entitlementsFromSubscription } from './entitlements';
import type { Subscription } from './cloud';

const future = new Date(Date.now() + 5 * 86_400_000).toISOString();

describe('entitlements paid vs trial', () => {
  it('trial grants managed_transcription but not paid features', () => {
    const sub: Subscription = { status: 'trialing', hasAccess: true, daysLeft: 5, trialEndsAt: future };
    const e = entitlementsFromSubscription(sub);
    expect(e.trialing).toBe(true);
    expect(e.paid).toBe(false);
    expect(e.can('managed_transcription')).toBe(true);
    expect(e.can('sms')).toBe(false);
    expect(e.can('recording')).toBe(false);
    expect(e.can('ai_analysis')).toBe(false);
  });
  it('active grants all features', () => {
    const sub: Subscription = { status: 'active', hasAccess: true, currentPeriodEnd: future };
    const e = entitlementsFromSubscription(sub);
    expect(e.paid).toBe(true);
    expect(e.can('sms')).toBe(true);
    expect(e.can('managed_transcription')).toBe(true);
  });
  it('expired grants nothing', () => {
    const sub: Subscription = { status: 'expired', hasAccess: false };
    const e = entitlementsFromSubscription(sub);
    expect(e.paid).toBe(false);
    expect(e.trialing).toBe(false);
    expect(e.can('managed_transcription')).toBe(false);
    expect(e.can('sms')).toBe(false);
  });
});
```

- [ ] **Step 2: Run — verify fails**

Run: `npx vitest run src/shared/entitlements.test.ts`
Expected: FAIL (`paid` undefined, `managed_transcription` not a Feature).

- [ ] **Step 3: Implement the split**

In `src/shared/entitlements.ts`:
- Add `'managed_transcription'` to the `Feature` union.
- Define `PAID_FEATURES = ['autodial_unlimited','ai_analysis','cloud_history','sms','recording']` (all current `PRO_FEATURES`).
- Add `paid: boolean` to the `Entitlements` interface.
- Rewrite `build`:
```typescript
function build(sub: Subscription | null, fromCache: boolean, stale: boolean): Entitlements {
  const now = Date.now();
  const periodEnd = sub?.currentPeriodEnd ? new Date(sub.currentPeriodEnd).getTime() : 0;
  const paid = !!sub && (
    ((sub.status === 'active' || sub.status === 'past_due' || sub.status === 'cancelled') && periodEnd > now)
  );
  const trialing = sub?.status === 'trialing' && !!sub?.hasAccess;
  const isPro = paid || trialing;
  return {
    tier: isPro ? 'pro' : 'free',
    isPro,
    paid,
    trialing,
    daysLeft: sub?.daysLeft,
    fromCache,
    stale,
    can: (f) => f === 'managed_transcription' ? (paid || trialing) : (paid && PAID_FEATURES.includes(f)),
  };
}
```
- Update `FREE` constant + any place building `Entitlements` to include `paid: false` (the `build(null,...)` path already produces it).

- [ ] **Step 4: Run — verify passes**

Run: `npx vitest run src/shared/entitlements.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit` → 0 errors (fix any consumer reading `.can(...)` for transcription, or referencing the removed `PRO_FEATURES` name — grep `PRO_FEATURES`).
```bash
git add src/shared/entitlements.ts src/shared/entitlements.test.ts
git commit -m "feat(ext): split entitlements into paid vs trial; managed_transcription feature"
```

---

## Phase F — Trial popup, expiry banner, remove email sheet

### Task F1: TrialStartPopup

**Files:**
- Create: `src/sidepanel/components/TrialStartPopup.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { useEffect, useState } from 'react';

const SEEN_KEY = 'trialPopupSeen';

/** One-time popup surfacing the 7-day trial right after setup. */
export function TrialStartPopup() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    chrome.storage.local.get(SEEN_KEY).then(({ trialPopupSeen }) => {
      if (!trialPopupSeen) setShow(true);
    });
  }, []);
  if (!show) return null;
  function dismiss() {
    void chrome.storage.local.set({ [SEEN_KEY]: true });
    setShow(false);
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl">
        <h2 className="text-lg font-semibold text-gray-900">🎉 You're on a 7-day free trial</h2>
        <p className="mt-2 text-sm text-gray-600">
          Managed call transcription + AI call analysis are unlocked. Calling is always free.
        </p>
        <button type="button" onClick={dismiss}
          className="mt-4 w-full rounded-md bg-brand-600 py-2 text-sm font-medium text-white hover:bg-brand-700">
          Got it
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `npx tsc --noEmit` → 0 errors.
```bash
git add src/sidepanel/components/TrialStartPopup.tsx
git commit -m "feat(ext): trial-start popup"
```

### Task F2: TrialBanner

**Files:**
- Create: `src/sidepanel/components/TrialBanner.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { useState } from 'react';
import { getCheckoutUrl } from '@shared/cloud';

interface Props {
  userId: string;
  daysLeft: number;
}

/** Shown in the last 3 days of trial. Upgrade → Dodo checkout. */
export function TrialBanner({ userId, daysLeft }: Props) {
  const [loading, setLoading] = useState(false);
  async function upgrade() {
    setLoading(true);
    try {
      const url = await getCheckoutUrl(userId);
      window.open(url, '_blank', 'noopener');
    } catch {
      /* surface nothing fatal; user can retry */
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className="flex items-center justify-between gap-2 bg-amber-50 px-3 py-2 text-xs text-amber-900">
      <span>
        Trial ends in {daysLeft} day{daysLeft === 1 ? '' : 's'} — upgrade to keep transcription and unlock Claude, SMS &amp; recording.
      </span>
      <button type="button" onClick={() => void upgrade()} disabled={loading}
        className="shrink-0 rounded-md bg-amber-600 px-3 py-1 font-medium text-white hover:bg-amber-700 disabled:opacity-60">
        {loading ? '…' : 'Upgrade'}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `npx tsc --noEmit` → 0 errors.
```bash
git add src/sidepanel/components/TrialBanner.tsx
git commit -m "feat(ext): trial-expiry banner (last 3 days) with upgrade CTA"
```

### Task F3: Wire popup + banner into App; remove EmailCaptureSheet

**Files:**
- Modify: `src/sidepanel/App.tsx`
- Delete: `src/sidepanel/components/EmailCaptureSheet.tsx`

- [ ] **Step 1: Read App.tsx to find entitlements + userId access**

Read `src/sidepanel/App.tsx`. Determine how the side panel obtains `entitlements` + `cloudUserId` (check for an existing entitlements hook / `getEntitlements` call; if none, add a small `useEffect` that reads `cloudUserId` from storage and calls `getEntitlements(cloudUserId)` into state).

- [ ] **Step 2: Remove email-capture block**

Delete: the `EmailCaptureSheet` import (line ~17), the `showEmailCapture` state (line ~26), the `useEffect` that reads `emailCaptured`/`emailPromptSkipped` (lines ~34-45), and the `{showEmailCapture && (...)}` render block (lines ~54-57).

- [ ] **Step 3: Mount popup + banner**

Add imports:
```tsx
import { TrialStartPopup } from './components/TrialStartPopup';
import { TrialBanner } from './components/TrialBanner';
```
After the `if (!settings) return <NotConfigured />;` guard, render the popup unconditionally (it self-guards on storage) and the banner when trialing + `daysLeft <= 3`:
```tsx
      <TrialStartPopup />
      {ent?.trialing && ent.daysLeft != null && ent.daysLeft <= 3 && cloudUserId && (
        <TrialBanner userId={cloudUserId} daysLeft={ent.daysLeft} />
      )}
```
(Use whatever the entitlements state var is named — `ent` here is illustrative.)

- [ ] **Step 4: Delete EmailCaptureSheet**

```bash
git rm src/sidepanel/components/EmailCaptureSheet.tsx
```
Grep for stray imports: `grep -rn EmailCaptureSheet src/` → expect no results.

- [ ] **Step 5: Typecheck + build + commit**

Run: `npx tsc --noEmit` → 0 errors. Then `pnpm build` → `✓ built`.
```bash
git add src/sidepanel/App.tsx
git commit -m "feat(ext): mount trial popup + expiry banner; remove soft email capture"
```

---

## Phase G — Integration verification

### Task G1: Full typecheck + tests + build

- [ ] **Step 1: Backend typecheck + tests**

Run: `cd backend && npx tsc --noEmit && npx vitest run`
Expected: 0 type errors; existing credits-math tests pass.

- [ ] **Step 2: Extension typecheck + tests + build**

Run: `npx tsc --noEmit && npx vitest run && pnpm build`
Expected: 0 type errors; entitlements + existing tests pass; `✓ built`.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A && git commit -m "chore: fix typecheck/test fallout from onboarding overhaul" || echo "nothing to commit"
```

### Task G2: Manual end-to-end (load unpacked)

- [ ] **Step 1: Load + fresh setup**

Load `dist/` unpacked at `chrome://extensions`. Open options → enter a TEST Twilio Account SID + Auth Token + email, load numbers, pick one, submit. Expected: setup completes in a few seconds (no 30-60s build), no "Building Functions" step.

- [ ] **Step 2: First call**

Open side panel → dial a number → call connects (token minted from backend `/api/voice/token`). Verify in Twilio Console the TwiML App VoiceUrl points at `…/api/voice/twiml/<userId>?k=…` and the number's Voice = that app.

- [ ] **Step 3: Trial popup + transcription**

On first side-panel open: trial popup shows once, dismiss persists (`trialPopupSeen`). Make a call → managed transcription appears with NO credit decrement (trialing → free). gpt-5-mini chat works; selecting a Claude model shows the upgrade path (402 → UpgradeModal).

- [ ] **Step 4: Expiry banner**

Temporarily set the user's `trial_ends_at` to ~2 days out via Supabase MCP `execute_sql`, reload the panel → amber banner shows "Trial ends in 2 days" + Upgrade opens Dodo checkout. Restore `trial_ends_at` after.

- [ ] **Step 5: Update PROGRESS.md + open PR**

Update `PROGRESS.md` with the batch-2 summary. Then:
```bash
git add PROGRESS.md && git commit -m "docs: PROGRESS — onboarding overhaul (batch 2)"
git push -u origin claude/romantic-feistel-5fb77a
gh pr create --fill --base main
```
Run `/code-review` on the branch; fix Critical/Important findings before merge.

---

## Notes / risks carried from spec

- **Security:** we now store the user's Twilio **API Key secret** encrypted (`CONFIG_ENC_KEY`); the **Auth Token is still never persisted** (used in-memory during register/provision only). Voice/SMS webhooks are gated by the per-user `voice_capability_secret` in the URL (replaces X-Twilio-Signature, which needs the Auth Token we don't hold).
- **Existing users** keep their deployed Functions (`backend_voice = false`) — every modified backend route branches on `backend_voice` and preserves the legacy path. No forced migration.
- **Founder cost:** managed transcription is free during trial (founder eats Deepgram ~$0.0043/min). Intended.
- **Anthropic funding:** Claude still fails gracefully until the account is funded; now also paid-gated, so trial users never hit Claude vendor cost.
