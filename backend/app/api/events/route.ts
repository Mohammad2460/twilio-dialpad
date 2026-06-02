import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { corsHeaders } from '@/lib/cors';
import { TrackBatchSchema, sanitizeMeta } from '@/lib/telemetry-schema';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

/**
 * POST /api/events
 * Anonymous product-analytics ingest from the Chrome extension.
 *
 * No auth: events are keyed by an anonymous installId. We intentionally accept
 * unauthenticated writes (the extension has no token before setup) but defend
 * with: schema validation, a 50-event batch cap, an event-name allowlist (Zod
 * enum), meta sanitization (PII key block), and idempotent inserts.
 *
 * Body: { installId, userId?, events: [{ id, name, ts, meta? }] }
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400, headers: corsHeaders });
  }

  const parsed = TrackBatchSchema.safeParse(body);
  if (!parsed.success) {
    // 422 = malformed/blocklisted; client should drop these, not retry forever.
    return NextResponse.json(
      { error: 'Invalid payload', details: parsed.error.issues.slice(0, 5) },
      { status: 422, headers: corsHeaders },
    );
  }

  const { installId, userId, events } = parsed.data;

  const rows = events.map((e) => ({
    id: e.id, // client UUID → idempotency
    install_id: installId,
    user_id: userId ?? null,
    name: e.name,
    meta: sanitizeMeta(e.meta),
    client_ts: new Date(e.ts).toISOString(),
    // received_at defaults to now() in the DB
  }));

  // Idempotent: duplicate event ids (retries) are silently ignored.
  const { error } = await supabase
    .from('telemetry_events')
    .upsert(rows, { onConflict: 'id', ignoreDuplicates: true });

  if (error) {
    console.error('[events] insert failed', error);
    // 500 → client keeps the batch queued and retries later.
    return NextResponse.json({ error: 'Failed to record events' }, { status: 500, headers: corsHeaders });
  }

  return NextResponse.json({ ok: true, accepted: rows.length }, { headers: corsHeaders });
}
