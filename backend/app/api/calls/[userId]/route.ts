import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { corsHeaders } from '@/lib/cors';
import { IngestCallSchema } from '@/lib/schemas';
import { DBCallStore } from '@/lib/db-store';
import { authenticateUser } from '@/lib/auth';
import { getActivePricing } from '@/lib/credits';
import { hubspotAllowed } from '@/lib/plan';
import { getUserPlan } from '@/lib/usage';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

/**
 * POST /api/calls/[userId]
 * Ingests a completed call (meta + optional transcript) from the extension.
 * Auth: Authorization: Bearer {userId} header.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId } = await params;

  // ── auth ────────────────────────────────────────────────────────
  if (!(await authenticateUser(req, userId))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
  }

  // Verify user exists
  const store = new DBCallStore(userId);
  const exists = await store.userExists();
  if (!exists) {
    return NextResponse.json({ error: 'User not found' }, { status: 404, headers: corsHeaders });
  }

  // ── parse body ───────────────────────────────────────────────────
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400, headers: corsHeaders });
  }

  const parsed = IngestCallSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', details: parsed.error.issues }, { status: 400, headers: corsHeaders });
  }

  const { meta, transcript } = parsed.data;

  // HubSpot contact data is Pro-only. Enforced here, not just in the extension:
  // on Free the snapshot is not stored, whatever build sent it. The call itself
  // is always saved.
  // A failed plan lookup must not lose the call: it is saved without the snapshot.
  let contact: typeof meta.contact | null = null;
  if (meta.contact) {
    try {
      const plan = await getUserPlan(userId, await getActivePricing());
      if (plan && hubspotAllowed(plan.plan)) contact = meta.contact;
    } catch (e) {
      console.error('[calls] plan lookup failed — saving without contact', e instanceof Error ? e.message : e);
    }
  }

  // ── upsert call ──────────────────────────────────────────────────
  const { error } = await supabase.from('calls').upsert(
    {
      user_id: userId,
      call_sid: meta.callSid,
      direction: meta.direction,
      number: meta.number,
      started_at: meta.startedAt,
      duration_sec: meta.durationSec,
      status: meta.status,
      has_transcript: !!transcript,
      contact,
      transcript: transcript ?? null,
    },
    { onConflict: 'user_id,call_sid' },
  );

  if (error) {
    console.error('[calls] upsert failed', error);
    return NextResponse.json({ error: 'Failed to save call' }, { status: 500, headers: corsHeaders });
  }

  // Increment call_count (best-effort — ignore failure)
  supabase.rpc('increment_call_count', { uid: userId }).then(() => {}, () => {});

  return NextResponse.json({ ok: true }, { headers: corsHeaders });
}
