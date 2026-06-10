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

/**
 * POST /api/sms/inbound — called by the user's Twilio `/incoming-sms` Function
 * (which is Protected, so Twilio already validated the X-Twilio-Signature).
 * Auth here = the shared configSecret, verified against the user's stored
 * (encrypted) configSecret resolved by Account SID. Idempotent on MessageSid.
 *
 * Body: { accountSid, from, to, body, messageSid, secret }
 */
export async function POST(req: NextRequest) {
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

  // Compliance: honor STOP / START on the sender's number. The send path
  // (POST /api/sms/[userId]) refuses to text any number with an opt-out row.
  const keyword = text.trim().toUpperCase();
  const peer = normNumber(from);
  if (STOP_KEYWORDS.has(keyword)) {
    await supabase
      .from('sms_opt_outs')
      .upsert({ user_id: resolved.userId, number: peer }, { onConflict: 'user_id,number' });
  } else if (START_KEYWORDS.has(keyword)) {
    await supabase
      .from('sms_opt_outs')
      .delete()
      .eq('user_id', resolved.userId)
      .eq('number', peer);
  }

  // Store inbound (idempotent on MessageSid). thread_key = the remote sender.
  const { error } = await supabase.from('messages').upsert(
    {
      user_id: resolved.userId,
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
    return NextResponse.json({ error: 'store_failed' }, { status: 500, headers: corsHeaders });
  }

  return NextResponse.json({ ok: true }, { headers: corsHeaders });
}
