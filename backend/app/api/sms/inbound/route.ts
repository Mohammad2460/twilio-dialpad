import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { supabase } from '@/lib/supabase';
import { corsHeaders } from '@/lib/cors';
import { getUserAndFunctionBySid } from '@/lib/device-functions';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

function eq(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

// Twilio standard opt-out / opt-in keywords (case-insensitive, whole body).
const STOP_KEYWORDS = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT']);
const START_KEYWORDS = new Set(['START', 'YES', 'UNSTOP']);

/** Normalize to loose E.164 so the opt-out key matches the send-path `to`. */
function normNumber(raw: string): string {
  const t = raw.replace(/[\s()\-.]/g, '');
  return t.startsWith('+') ? t : `+${t.replace(/^\+?/, '')}`;
}

/** Store the inbound message + honor STOP/START. Shared by both auth paths. */
async function processInbound(
  userId: string,
  from: string,
  to: string,
  text: string,
  messageSid: string | null,
): Promise<boolean> {
  const keyword = text.trim().toUpperCase();
  const peer = normNumber(from);
  if (STOP_KEYWORDS.has(keyword)) {
    await supabase
      .from('sms_opt_outs')
      .upsert({ user_id: userId, number: peer }, { onConflict: 'user_id,number' });
  } else if (START_KEYWORDS.has(keyword)) {
    await supabase.from('sms_opt_outs').delete().eq('user_id', userId).eq('number', peer);
  }

  const { error } = await supabase.from('messages').upsert(
    {
      user_id: userId,
      direction: 'in',
      from_number: from,
      to_number: to,
      body: text,
      status: 'received',
      twilio_message_sid: messageSid,
      thread_key: peer,
    },
    { onConflict: 'twilio_message_sid' },
  );
  if (error) {
    console.error('[sms/inbound] store failed', error);
    return false;
  }
  return true;
}

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

/**
 * POST /api/sms/inbound
 *
 * Two callers:
 *  - Backend-voice (new): the number's SmsUrl points here directly as
 *    `?u=<userId>&k=<capabilitySecret>`. Twilio POSTs form-urlencoded
 *    (From/To/Body/MessageSid). We validate `?k` and reply with empty TwiML.
 *  - Legacy: the user's Protected `/incoming-sms` Function forwards JSON
 *    { accountSid, from, to, body, messageSid, secret }, auth via stored
 *    configSecret resolved by Account SID. Idempotent on MessageSid.
 */
export async function POST(req: NextRequest) {
  const uParam = req.nextUrl.searchParams.get('u');
  const kParam = req.nextUrl.searchParams.get('k');

  // ── Backend-voice path: direct Twilio webhook, form-urlencoded, ?u/?k auth.
  if (uParam && kParam) {
    const { data: u } = await supabase
      .from('users')
      .select('voice_capability_secret, backend_voice')
      .eq('id', uParam)
      .single();
    if (!u || !u.backend_voice || !u.voice_capability_secret || !eq(kParam, u.voice_capability_secret)) {
      return new NextResponse(EMPTY_TWIML, { status: 401, headers: { 'Content-Type': 'text/xml' } });
    }
    const form = await req.formData();
    const from = (form.get('From') ?? '').toString();
    const to = (form.get('To') ?? '').toString();
    const text = (form.get('Body') ?? '').toString();
    const messageSid = ((form.get('MessageSid') ?? form.get('SmsSid')) ?? '').toString() || null;
    if (from && to) await processInbound(uParam, from, to, text, messageSid);
    return new NextResponse(EMPTY_TWIML, { status: 200, headers: { 'Content-Type': 'text/xml' } });
  }

  // ── Legacy Function path (JSON body).
  let p: {
    accountSid?: unknown;
    from?: unknown;
    to?: unknown;
    body?: unknown;
    messageSid?: unknown;
    secret?: unknown;
  };
  try {
    p = (await req.json()) as typeof p;
  } catch {
    return NextResponse.json({ error: 'bad_json' }, { status: 400, headers: corsHeaders });
  }

  const accountSid = typeof p.accountSid === 'string' ? p.accountSid : '';
  const secret = typeof p.secret === 'string' ? p.secret : '';
  const from = typeof p.from === 'string' ? p.from : '';
  const to = typeof p.to === 'string' ? p.to : '';
  const text = typeof p.body === 'string' ? p.body : '';
  const messageSid = typeof p.messageSid === 'string' ? p.messageSid : null;
  if (!accountSid || !secret || !from || !to) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400, headers: corsHeaders });
  }

  const resolved = await getUserAndFunctionBySid(accountSid);
  if (!resolved || !eq(secret, resolved.configSecret)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: corsHeaders });
  }

  if (!(await processInbound(resolved.userId, from, to, text, messageSid))) {
    return NextResponse.json({ error: 'store_failed' }, { status: 500, headers: corsHeaders });
  }
  return NextResponse.json({ ok: true }, { headers: corsHeaders });
}
