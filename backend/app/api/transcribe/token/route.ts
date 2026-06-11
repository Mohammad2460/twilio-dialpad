import { NextRequest, NextResponse } from 'next/server';
import { corsHeaders } from '@/lib/cors';
import { authenticate } from '@/lib/auth';
import { mintDeepgramToken } from '@/lib/deepgram-token';
import {
  getActivePricing,
  estimateTranscriptionCredits,
  costFromDeepgramMinutes,
  usdToCredits,
  reserve,
  settle,
  refund,
  InsufficientCreditsError,
} from '@/lib/credits';

export const runtime = 'nodejs';

// One metering window. The client reconnects (with a fresh token) each window,
// so a zero-balance user gets no next token and transcription stops. Short
// enough to bound abuse, long enough that reconnects are infrequent.
const WINDOW_SECONDS = 120;
const TTL_SECONDS = 60; // token only needs validity at connect

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

function j(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: corsHeaders });
}

interface TokenBody {
  /** Deepgram model (managed default nova-3). Must exist in pricing.deepgram. */
  model?: string;
  /** Settle the previous window: its reservation id + actual seconds streamed. */
  prevRequestId?: string;
  prevSeconds?: number;
  /** Idempotency key for THIS window's reservation (e.g. `${callSid}:${windowIdx}`). */
  windowKey?: string;
}

/**
 * POST /api/transcribe/token — managed transcription metering + token mint.
 *
 * Flow per window: settle the previous window to actual usage → reserve the next
 * window's estimated credits → mint a short-lived Deepgram JWT. 402 when the
 * balance can't cover the next window (the client then stops transcription; the
 * call is unaffected). Device-auth; metered by credits (Haiku-tier free taste
 * applies — no Pro gate, transcription is the funnel).
 */
export async function POST(req: NextRequest) {
  const auth = await authenticate(req);
  if (!auth) return j({ error: 'Unauthorized' }, 401);
  const userId = auth.userId;

  if (!process.env.DEEPGRAM_API_KEY) return j({ error: 'managed_transcription_unavailable' }, 503);

  let body: TokenBody;
  try {
    body = (await req.json()) as TokenBody;
  } catch {
    body = {};
  }

  const pricing = await getActivePricing();
  const model = typeof body.model === 'string' ? body.model : 'nova-3';
  if (!pricing.deepgram[model]) return j({ error: 'unknown_model' }, 400);

  // ── Settle the previous window to actual seconds (best-effort; the reaper
  //    backstops a missed settle).
  if (body.prevRequestId && typeof body.prevSeconds === 'number' && body.prevSeconds >= 0) {
    try {
      const minutes = body.prevSeconds / 60;
      const usd = costFromDeepgramMinutes(minutes, model, pricing);
      const actual = body.prevSeconds === 0 ? 0 : usdToCredits(usd, pricing);
      await settle(body.prevRequestId, actual, usd, model);
    } catch (e) {
      console.error('[transcribe/token] settle prev failed (non-fatal)', e);
    }
  }

  // ── Reserve the next window.
  const estCredits = estimateTranscriptionCredits(WINDOW_SECONDS / 60, model, pricing);
  const idemKey = body.windowKey ?? crypto.randomUUID();
  let requestId: string;
  try {
    requestId = await reserve(userId, estCredits, idemKey, `deepgram:${model}`, pricing.version);
  } catch (e) {
    if (e instanceof InsufficientCreditsError) {
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://dialler-mcp.vercel.app';
      return j(
        { error: 'insufficient_credits', need: estCredits, topUpUrl: `${baseUrl}/api/checkout/${userId}` },
        402,
      );
    }
    throw e;
  }

  // ── Mint the token; refund the reservation if Deepgram is unreachable.
  try {
    const grant = await mintDeepgramToken(TTL_SECONDS);
    return j({
      token: grant.access_token,
      expiresIn: grant.expires_in,
      requestId,
      windowSeconds: WINDOW_SECONDS,
      model,
    });
  } catch (e) {
    console.error('[transcribe/token] mint failed', e);
    try {
      await refund(requestId, 0, null);
    } catch {
      /* reaper backstops */
    }
    return j({ error: 'mint_failed' }, 502);
  }
}
