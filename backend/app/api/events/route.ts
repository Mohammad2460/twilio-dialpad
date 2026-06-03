import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { corsHeaders } from '@/lib/cors';
import { TrackBatchSchema, sanitizeMeta } from '@/lib/telemetry-schema';

export const runtime = 'nodejs';

// Non-secret shared tag baked into the extension. NOT auth — a cheap filter so
// random internet scripts get 401'd instead of writing rows. Override via env.
const INGEST_KEY = process.env.TEL_INGEST_KEY ?? 'tdp_tel_b7f4c1a9e2d6483a';

// Best-effort per-IP rate limit. In-memory → per serverless instance only (not
// global), but enough to blunt trivial floods without extra infra. Real users
// send <10 events/min; a bursting script trips this fast.
const RL_WINDOW_MS = 60_000;
const RL_MAX = 60; // requests per IP per minute per instance
const rl = new Map<string, { count: number; resetAt: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const e = rl.get(ip);
  if (!e || now > e.resetAt) {
    rl.set(ip, { count: 1, resetAt: now + RL_WINDOW_MS });
    if (rl.size > 5000) for (const [k, v] of rl) if (now > v.resetAt) rl.delete(k); // cheap GC
    return false;
  }
  e.count += 1;
  return e.count > RL_MAX;
}

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
  // Cheap abuse filter: shared client tag. Wrong/missing → 401, no DB touch.
  if (req.headers.get('x-tel-key') !== INGEST_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
  }

  // Per-IP rate limit (best-effort, per-instance). Prefer x-real-ip (set by
  // Vercel's proxy, not client-spoofable) over the client-controllable
  // left-most x-forwarded-for entry.
  const ip =
    req.headers.get('x-real-ip') ??
    (req.headers.get('x-forwarded-for') ?? 'unknown').split(',')[0].trim();
  if (rateLimited(ip)) {
    return NextResponse.json({ error: 'Rate limited' }, { status: 429, headers: corsHeaders });
  }

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
