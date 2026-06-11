import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { supabase } from '@/lib/supabase';
import { corsHeaders } from '@/lib/cors';
import { getUserAndFunctionBySid } from '@/lib/device-functions';
import { downloadRecording } from '@/lib/twilio-server';
import { decryptSecret } from '@/lib/crypto';

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

async function upsertRecordingRow(
  userId: string,
  recordingSid: string,
  callSid: string | null,
  durationSec: number | null,
): Promise<{ path: string } | null> {
  const path = `${userId}/${recordingSid}.mp3`;
  const deleteAfter = new Date(Date.now() + RETENTION_DAYS * 86_400_000).toISOString();
  const { error } = await supabase.from('recordings').upsert(
    {
      user_id: userId,
      call_sid: callSid,
      recording_sid: recordingSid,
      storage_path: path,
      duration_sec: durationSec,
      delete_after: deleteAfter,
    },
    { onConflict: 'recording_sid' },
  );
  if (error) {
    console.error('[recordings/ingest] row upsert failed', error);
    return null;
  }
  return { path };
}

/**
 * Backend-voice path: Twilio's recordingStatusCallback posts STANDARD form
 * params to `/api/recordings/ingest?u=<userId>&k=<capabilitySecret>`. We hold the
 * API-Key secret, so we download the media and upload it ourselves (no Function).
 */
async function ingestBackendVoice(req: NextRequest, userId: string, k: string): Promise<NextResponse> {
  const { data: u } = await supabase
    .from('users')
    .select('voice_capability_secret, api_key_sid, api_key_secret_enc, backend_voice')
    .eq('id', userId)
    .single();
  if (!u || !u.backend_voice || !u.voice_capability_secret || !eq(k, u.voice_capability_secret)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: corsHeaders });
  }

  const form = await req.formData();
  const recordingSid = (form.get('RecordingSid') ?? '').toString();
  const recordingUrl = (form.get('RecordingUrl') ?? '').toString();
  const callSid = (form.get('CallSid') ?? '').toString() || null;
  const durationSec = parseInt((form.get('RecordingDuration') ?? '0').toString(), 10) || null;
  if (!recordingSid || !recordingUrl || !u.api_key_sid || !u.api_key_secret_enc) {
    // Twilio ignores the body; ack so it doesn't retry forever.
    return new NextResponse('', { status: 200 });
  }

  const row = await upsertRecordingRow(userId, recordingSid, callSid, durationSec);
  if (!row) return new NextResponse('', { status: 200 });

  const { data: up, error: upErr } = await supabase.storage
    .from('recordings')
    .createSignedUploadUrl(row.path);
  if (upErr || !up) {
    console.error('[recordings/ingest] signed upload url failed', upErr);
    return new NextResponse('', { status: 200 });
  }

  try {
    const buf = Buffer.from(
      await downloadRecording(u.api_key_sid, decryptSecret(u.api_key_secret_enc), recordingUrl),
    );
    const put = await fetch(up.signedUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'audio/mpeg' },
      body: buf,
    });
    if (!put.ok) console.error('[recordings/ingest] inline upload failed', put.status);
  } catch (e) {
    console.error('[recordings/ingest] media download/upload failed', e);
  }
  return new NextResponse('', { status: 200 });
}

/**
 * POST /api/recordings/ingest
 *
 * Two callers:
 *  - Backend-voice (new): Twilio recordingStatusCallback with `?u`&`?k` query +
 *    standard form params. We download + upload the media inline.
 *  - Legacy: the user's `/recording-status` Function posts JSON
 *    { accountSid, secret, callSid, recordingSid, durationSec } and PUTs the media
 *    itself to the returned signed upload URL.
 */
export async function POST(req: NextRequest) {
  const u = req.nextUrl.searchParams.get('u');
  const k = req.nextUrl.searchParams.get('k');
  if (u && k) return ingestBackendVoice(req, u, k);

  // ── Legacy Function path (JSON body).
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

  const row = await upsertRecordingRow(resolved.userId, recordingSid, callSid, durationSec);
  if (!row) return NextResponse.json({ error: 'row_failed' }, { status: 500, headers: corsHeaders });

  const { data: up, error: upErr } = await supabase.storage
    .from('recordings')
    .createSignedUploadUrl(row.path);
  if (upErr || !up) {
    console.error('[recordings/ingest] signed upload url failed', upErr);
    return NextResponse.json({ error: 'upload_url_failed' }, { status: 500, headers: corsHeaders });
  }

  return NextResponse.json({ ok: true, uploadUrl: up.signedUrl, path: up.path }, { headers: corsHeaders });
}
