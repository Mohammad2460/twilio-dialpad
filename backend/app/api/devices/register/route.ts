import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { supabase } from '@/lib/supabase';
import { corsHeaders } from '@/lib/cors';
import { generateSecret, hashSecret, encryptSecret } from '@/lib/crypto';
import { grant, getActivePricing } from '@/lib/credits';
import { createApiKey, createTwimlApp, wireNumber } from '@/lib/twilio-server';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

const SID_RE = /^AC[a-zA-Z0-9]{32}$/;

function j(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: corsHeaders });
}

/**
 * POST /api/devices/register
 *
 * Genuine Twilio ownership proof (Option B): verify the Auth Token against the
 * Account SID via Twilio, dedup the user on the *verified* SID, and mint a
 * per-device secret. The Auth Token is used once, in-memory, and is NEVER
 * stored, logged, or cached.
 *
 * Body: { accountSid, authToken, functionUrl?, configSecret?, label? }
 * Returns ONCE: { userId, deviceId, deviceSecret, mcpUrl }
 */
export async function POST(req: NextRequest) {
  let body: {
    accountSid?: unknown;
    authToken?: unknown;
    functionUrl?: unknown;
    configSecret?: unknown;
    label?: unknown;
    numberSid?: unknown;
    callerId?: unknown;
    clientIdentity?: unknown;
    name?: unknown;
    email?: unknown;
    marketingConsent?: unknown;
    provision?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return j({ error: 'bad_json' }, 400);
  }

  const accountSid = typeof body.accountSid === 'string' ? body.accountSid : '';
  const authToken = typeof body.authToken === 'string' ? body.authToken : '';
  if (!SID_RE.test(accountSid) || authToken.length < 10) {
    return j({ error: 'invalid_credentials' }, 400);
  }

  const provision = body.provision === true;
  const numberSid = typeof body.numberSid === 'string' ? body.numberSid : '';
  const callerId = typeof body.callerId === 'string' ? body.callerId : '';
  const clientIdentity = typeof body.clientIdentity === 'string' ? body.clientIdentity : 'dialpad';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : '';
  const marketingConsent = body.marketingConsent === true;

  // ── Ownership proof: token must authenticate against this SID at Twilio.
  // Token is used here only, in memory, then dropped. Never persisted.
  let verifyRes: Response;
  try {
    verifyRes = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}.json`, {
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
      },
    });
  } catch {
    return j({ error: 'twilio_unreachable' }, 502);
  }
  if (!verifyRes.ok) {
    return j({ error: 'ownership_verification_failed', status: verifyRes.status }, 401);
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://dialler-mcp.vercel.app';

  // ── Dedup on the VERIFIED SID (prevents trial-bypass; no SID-only claiming).
  const { data: existing, error: lookupErr } = await supabase
    .from('users')
    .select('id')
    .eq('twilio_account_sid', accountSid)
    .maybeSingle();
  if (lookupErr) {
    console.error('[devices/register] user lookup failed', lookupErr);
    return j({ error: 'lookup_failed' }, 500);
  }

  let userId: string;
  if (existing?.id) {
    userId = existing.id;
    // Trial fairness: the 7-day clock starts at SETUP, not install. If this
    // user row predates setup (no device ever registered, still trialing,
    // never subscribed), restart the trial window now — exactly once. Revoked
    // devices count too, so revoke-and-re-register can't farm fresh trials.
    try {
      const { count } = await supabase
        .from('devices')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId);
      if ((count ?? 0) === 0) {
        const { data: u } = await supabase
          .from('users')
          .select('subscription_status, subscription_id')
          .eq('id', userId)
          .single();
        if (u?.subscription_status === 'trialing' && !u.subscription_id) {
          await supabase
            .from('users')
            .update({ trial_ends_at: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString() })
            .eq('id', userId);
        }
      }
    } catch (e) {
      console.error('[devices/register] trial restart check failed (non-fatal)', e);
    }
  } else {
    const { data: created, error: createErr } = await supabase
      .from('users')
      .insert({ twilio_account_sid: accountSid })
      .select('id')
      .single();
    if (createErr || !created) {
      console.error('[devices/register] user create failed', createErr);
      return j({ error: 'create_failed' }, 500);
    }
    userId = created.id;
  }

  // ── Free managed-AI taste grant (v2). Idempotent per user (key freegrant:<id>),
  // so re-registration and existing v1 users get it exactly once. Non-fatal.
  try {
    const pricing = await getActivePricing();
    if (pricing.free_grant > 0) {
      await grant(userId, pricing.free_grant, 'grant', null, `freegrant:${userId}`, pricing.version);
    }
  } catch (e) {
    console.error('[devices/register] free grant failed (non-fatal)', e);
  }

  // ── Mint a device secret (store only the hash).
  const secret = generateSecret();
  const { hash, salt } = hashSecret(secret);
  const label = typeof body.label === 'string' ? body.label.slice(0, 80) : null;
  const { data: device, error: devErr } = await supabase
    .from('devices')
    .insert({ user_id: userId, secret_hash: hash, secret_salt: salt, label })
    .select('id')
    .single();
  if (devErr || !device) {
    console.error('[devices/register] device create failed', devErr);
    return j({ error: 'device_create_failed' }, 500);
  }

  // ── Optionally register the Twilio Function (configSecret encrypted at rest).
  const functionUrl = typeof body.functionUrl === 'string' ? body.functionUrl : '';
  const configSecret = typeof body.configSecret === 'string' ? body.configSecret : '';
  if (functionUrl && configSecret) {
    try {
      const { error: fnErr } = await supabase.from('device_functions').upsert({
        device_id: device.id,
        user_id: userId,
        function_url: functionUrl,
        config_secret_enc: encryptSecret(configSecret),
        updated_at: new Date().toISOString(),
      });
      if (fnErr) console.error('[devices/register] function registry upsert failed', fnErr);
    } catch (e) {
      console.error('[devices/register] configSecret encrypt failed', e);
    }
  }

  // ── Backend-voice provisioning (new installs). Auth Token still in-memory here.
  if (provision) {
    if (!numberSid || !callerId) return j({ error: 'missing_provision_fields' }, 400);
    try {
      // Reuse existing resources on re-run (idempotent — avoid orphaning Twilio resources).
      const { data: cur } = await supabase
        .from('users')
        .select('api_key_sid, api_key_secret_enc, twiml_app_sid, voice_capability_secret')
        .eq('id', userId)
        .single();

      const capSecret = cur?.voice_capability_secret ?? randomBytes(32).toString('hex');
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
        ? {
            email,
            product_email_consent_at: new Date().toISOString(),
            ...(marketingConsent ? { marketing_consent_at: new Date().toISOString() } : {}),
          }
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
          ...(name ? { name } : {}),
          ...emailCols,
        })
        .eq('id', userId);
      if (upErr) {
        console.error('[register] voice config save failed', upErr);
        return j({ error: 'provision_failed', step: 'persist' }, 500);
      }
    } catch (e) {
      console.error('[register] provisioning failed', e);
      return j(
        { error: 'provision_failed', detail: e instanceof Error ? e.message.slice(0, 120) : 'error' },
        502,
      );
    }
  }

  return j(
    { userId, deviceId: device.id, deviceSecret: secret, mcpUrl: `${baseUrl}/api/mcp/${userId}` },
    201,
  );
}
