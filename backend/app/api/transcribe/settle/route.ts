import { NextRequest, NextResponse } from 'next/server';
import { corsHeaders } from '@/lib/cors';
import { authenticate } from '@/lib/auth';
import { getActivePricing } from '@/lib/credits';
import { settleWindow } from '@/lib/transcribe-settle';

export const runtime = 'nodejs';

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

function j(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: corsHeaders });
}

/**
 * POST /api/transcribe/settle — settle the FINAL transcription window when the
 * call ends (no next /token call to fold it into). Idempotent via settle's
 * reservation-status check; the reaper backstops a missed call. Device-auth.
 * Body: { requestId, seconds }. The reservation must be the caller's own; the
 * model and the time bounds come from the ledger row (see settleWindow).
 */
export async function POST(req: NextRequest) {
  const auth = await authenticate(req);
  if (!auth) return j({ error: 'Unauthorized' }, 401);

  let body: { requestId?: string; seconds?: number };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return j({ error: 'bad_json' }, 400);
  }
  // Trial windows carry no reservation (transcription is free during trial) → no-op.
  if (!body.requestId) return j({ ok: true, skipped: true });

  try {
    const pricing = await getActivePricing();
    const balance = await settleWindow(auth.userId, body.requestId, body.seconds, pricing);
    if (balance === null) return j({ ok: true, skipped: true });
    return j({ ok: true, balance });
  } catch (e) {
    console.error('[transcribe/settle] failed', e);
    return j({ error: 'settle_failed' }, 500);
  }
}
