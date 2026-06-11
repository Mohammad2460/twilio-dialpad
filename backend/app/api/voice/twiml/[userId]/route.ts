import { NextRequest, NextResponse } from 'next/server';
import twilio from 'twilio';
import { timingSafeEqual } from 'node:crypto';
import { supabase } from '@/lib/supabase';

export const runtime = 'nodejs';

function safeEq(a: string, b: string): boolean {
  const ab = Buffer.from(a), bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
function xml(twimlStr: string) {
  return new NextResponse(twimlStr, { status: 200, headers: { 'Content-Type': 'text/xml' } });
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
    return xml(t.toString());
  }

  const body = await req.formData();
  const from = (body.get('From') ?? '').toString();
  const to = (body.get('To') ?? '').toString().trim();
  const eventCallerId = (body.get('CallerId') ?? '').toString().trim();
  const isClientOutbound = from.toLowerCase().startsWith('client:');
  const twiml = new VoiceResponse();

  // ── PSTN inbound — cascade routing.
  if (!isClientOutbound) {
    const identity = u.client_identity || 'default';
    const forwardRaw = (u.forward_number ?? '').toString().trim();
    const forwardTo = /^\+\d{6,}$/.test(forwardRaw) ? forwardRaw : '';
    if (u.incoming_enabled) {
      twiml.dial({ answerOnBridge: true, timeout: 20 }).client(identity);
      if (u.forward_enabled && forwardTo) twiml.dial({ answerOnBridge: true, timeout: 25 }).number(forwardTo);
    } else if (u.forward_enabled && forwardTo) {
      twiml.dial({ answerOnBridge: true, timeout: 25 }).number(forwardTo);
    } else {
      twiml.reject({ reason: 'busy' });
    }
    return xml(twiml.toString());
  }

  // ── Outbound (Device.connect from extension).
  if (!to) {
    twiml.say({ voice: 'alice' }, 'No destination provided.');
    return xml(twiml.toString());
  }
  const callerId = eventCallerId || (u.caller_id ?? '').toString().trim();
  if (!callerId) {
    twiml.say({ voice: 'alice' }, 'Configuration error. The caller ID is missing. Please re-run setup.');
    return xml(twiml.toString());
  }
  if (callerId === to) {
    twiml.say({ voice: 'alice' }, 'You cannot dial your own Twilio number from this device. Please dial a different number.');
    return xml(twiml.toString());
  }

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
  return xml(twiml.toString());
}
