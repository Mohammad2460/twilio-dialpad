import { NextRequest, NextResponse } from 'next/server';
import { corsHeaders } from '@/lib/cors';
import { authenticate } from '@/lib/auth';
import {
  getActivePricing,
  costFromDeepgramMinutes,
  usdToCredits,
  settle,
} from '@/lib/credits';

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
 * Body: { requestId, seconds, model }.
 */
export async function POST(req: NextRequest) {
  const auth = await authenticate(req);
  if (!auth) return j({ error: 'Unauthorized' }, 401);

  let body: { requestId?: string; seconds?: number; model?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return j({ error: 'bad_json' }, 400);
  }
  const requestId = typeof body.requestId === 'string' ? body.requestId : '';
  const seconds = typeof body.seconds === 'number' && body.seconds >= 0 ? body.seconds : 0;
  const model = typeof body.model === 'string' ? body.model : 'nova-3';
  // Trial windows carry no reservation (transcription is free during trial) → no-op.
  if (!requestId) return j({ ok: true, skipped: true });

  const pricing = await getActivePricing();
  if (!pricing.deepgram[model]) return j({ error: 'unknown_model' }, 400);

  try {
    const usd = costFromDeepgramMinutes(seconds / 60, model, pricing);
    const actual = seconds === 0 ? 0 : usdToCredits(usd, pricing);
    const balance = await settle(requestId, actual, usd, model);
    return j({ ok: true, balance });
  } catch (e) {
    console.error('[transcribe/settle] failed', e);
    return j({ error: 'settle_failed' }, 500);
  }
}
