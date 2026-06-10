import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { deleteTwilioRecording } from '@/lib/twilio-recording';

export const runtime = 'nodejs';

/**
 * GET /api/recordings/purge — scheduled retention purge (Vercel Cron).
 *
 * Deletes recordings past their `delete_after` window: the Twilio-side copy
 * (through the user's Function), our Storage object, and the metadata row.
 * Auth: requires `Authorization: Bearer ${CRON_SECRET}` — Vercel Cron sends this
 * automatically when CRON_SECRET is set in the project env. Never public.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const nowIso = new Date().toISOString();
  const { data: rows, error } = await supabase
    .from('recordings')
    .select('id, user_id, recording_sid, storage_path')
    .lt('delete_after', nowIso)
    .limit(200);
  if (error) return NextResponse.json({ error: 'load_failed' }, { status: 500 });

  let purged = 0;
  for (const r of rows ?? []) {
    await deleteTwilioRecording(r.user_id, r.recording_sid);
    await supabase.storage.from('recordings').remove([r.storage_path]).catch?.(() => undefined);
    const { error: delErr } = await supabase.from('recordings').delete().eq('id', r.id);
    if (!delErr) purged++;
  }

  return NextResponse.json({ ok: true, purged, scanned: rows?.length ?? 0 });
}
