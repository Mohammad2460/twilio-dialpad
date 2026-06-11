import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { corsHeaders } from '@/lib/cors';
import { generateSecret, hashSecret, encryptSecret } from '@/lib/crypto';
import { grant, getActivePricing } from '@/lib/credits';

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

  return j(
    { userId, deviceId: device.id, deviceSecret: secret, mcpUrl: `${baseUrl}/api/mcp/${userId}` },
    201,
  );
}
