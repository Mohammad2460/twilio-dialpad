import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { supabase } from '@/lib/supabase';
import { corsHeaders } from '@/lib/cors';
import { getUserAndFunctionBySid } from '@/lib/device-functions';

export const runtime = 'nodejs';

const RETENTION_DAYS = 90;

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

function eq(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/**
 * POST /api/recordings/ingest — called by the user's `/recording-status`
 * Twilio Function (which holds API-Key creds). Auth = shared configSecret
 * resolved by Account SID. Creates a metadata row + returns a signed upload URL;
 * the Function downloads the Twilio media and PUTs it to that URL.
 *
 * Body: { accountSid, secret, callSid, recordingSid, durationSec }
 */
export async function POST(req: NextRequest) {
  let p: Record<string, unknown>;
  try {
    p = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'bad_json' }, { status: 400, headers: corsHeaders });
  }
  const accountSid = typeof p.accountSid === 'string' ? p.accountSid : '';
  const secret = typeof p.secret === 'string' ? p.secret : '';
  const recordingSid = typeof p.recordingSid === 'string' ? p.recordingSid : '';
  const callSid = typeof p.callSid === 'string' ? p.callSid : null;
  const durationSec = typeof p.durationSec === 'number' ? p.durationSec : null;
  if (!accountSid || !secret || !recordingSid) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400, headers: corsHeaders });
  }

  const resolved = await getUserAndFunctionBySid(accountSid);
  if (!resolved || !eq(secret, resolved.configSecret)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: corsHeaders });
  }

  const path = `${resolved.userId}/${recordingSid}.mp3`;
  const deleteAfter = new Date(Date.now() + RETENTION_DAYS * 86_400_000).toISOString();

  // Metadata row (idempotent on recording_sid).
  const { error: rowErr } = await supabase.from('recordings').upsert(
    {
      user_id: resolved.userId,
      call_sid: callSid,
      recording_sid: recordingSid,
      storage_path: path,
      duration_sec: durationSec,
      delete_after: deleteAfter,
    },
    { onConflict: 'recording_sid' },
  );
  if (rowErr) {
    console.error('[recordings/ingest] row upsert failed', rowErr);
    return NextResponse.json({ error: 'row_failed' }, { status: 500, headers: corsHeaders });
  }

  // Signed upload URL — the Function streams the Twilio media here.
  const { data: up, error: upErr } = await supabase.storage
    .from('recordings')
    .createSignedUploadUrl(path);
  if (upErr || !up) {
    console.error('[recordings/ingest] signed upload url failed', upErr);
    return NextResponse.json({ error: 'upload_url_failed' }, { status: 500, headers: corsHeaders });
  }

  return NextResponse.json({ ok: true, uploadUrl: up.signedUrl, path: up.path }, { headers: corsHeaders });
}
