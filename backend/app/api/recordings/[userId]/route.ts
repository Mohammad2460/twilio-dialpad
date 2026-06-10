import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { corsHeaders } from '@/lib/cors';
import { authenticateUser } from '@/lib/auth';
import { deleteTwilioRecording } from '@/lib/twilio-recording';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

function j(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: corsHeaders });
}

async function requireAccess(userId: string): Promise<boolean> {
  const { data } = await supabase.rpc('user_has_access', { uid: userId });
  return !!data;
}

/**
 * GET /api/recordings/[userId] — list recordings with short-lived signed
 * playback URLs. Device-auth + Pro.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  if (!(await authenticateUser(req, userId))) return j({ error: 'Unauthorized' }, 401);
  if (!(await requireAccess(userId))) return j({ error: 'subscription_required' }, 402);

  const { data, error } = await supabase
    .from('recordings')
    .select('id, call_sid, recording_sid, storage_path, duration_sec, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) return j({ error: 'load_failed' }, 500);

  const recordings = await Promise.all(
    (data ?? []).map(async (r) => {
      const { data: signed } = await supabase.storage
        .from('recordings')
        .createSignedUrl(r.storage_path, 3600);
      return {
        id: r.id,
        callSid: r.call_sid,
        durationSec: r.duration_sec,
        createdAt: r.created_at,
        url: signed?.signedUrl ?? null,
      };
    }),
  );
  return j({ recordings });
}

/**
 * DELETE /api/recordings/[userId] — body { id }. Removes the storage object +
 * row. Device-auth. (Twilio-side recording delete is a follow-up via the
 * user's Function.)
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  if (!(await authenticateUser(req, userId))) return j({ error: 'Unauthorized' }, 401);

  let body: { id?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return j({ error: 'bad_json' }, 400);
  }
  const id = typeof body.id === 'string' ? body.id : '';
  if (!id) return j({ error: 'invalid_request' }, 400);

  const { data: row } = await supabase
    .from('recordings')
    .select('id, storage_path, recording_sid')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();
  if (!row) return j({ error: 'not_found' }, 404);

  // Delete the Twilio-side copy through the user's Function (best-effort), then
  // remove our storage object + row so media lives nowhere we control after this.
  await deleteTwilioRecording(userId, row.recording_sid);
  await supabase.storage.from('recordings').remove([row.storage_path]).catch?.(() => undefined);
  const { error } = await supabase.from('recordings').delete().eq('id', id).eq('user_id', userId);
  if (error) return j({ error: 'delete_failed' }, 500);
  return j({ ok: true });
}
