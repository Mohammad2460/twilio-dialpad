import { NextRequest, NextResponse } from 'next/server';
import { corsHeaders } from '@/lib/cors';
import { authenticate } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { mintDeepgramToken } from '@/lib/deepgram-token';
import { takeTrialMint } from '@/lib/trial-cap';
import {
  getActivePricing,
  estimateTranscriptionCredits,
  reserve,
  refund,
  InsufficientCreditsError,
} from '@/lib/credits';
import { reservationKey } from '@/lib/reservation-key';
import { WINDOW_SECONDS, TRANSCRIBE_MODEL_PREFIX } from '@/lib/transcribe-metering';
import { settleWindow } from '@/lib/transcribe-settle';

export const runtime = 'nodejs';

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
  /** Settle the previous window: its reservation id + the seconds the client
   *  streamed. Both are checked against the ledger (see settleWindow). */
  prevRequestId?: string;
  prevSeconds?: number;
  /** Client label for THIS window (e.g. `${callSid}:${windowIdx}`) — a trace
   *  prefix only (see reservationKey). */
  windowKey?: string;
}

/**
 * POST /api/transcribe/token — managed transcription metering + token mint.
 *
 * Flow per window: settle the previous window to actual usage → reserve the next
 * window's estimated credits → mint a short-lived Deepgram JWT. 402 when the
 * balance can't cover the next window (the client then stops transcription; the
 * call is unaffected). Device-auth; requires active access (trial or Pro):
 * free during trial, credit-metered on Pro. Credits stay banked when Pro
 * lapses and become usable again on renewal.
 */
export async function POST(req: NextRequest) {
  const auth = await authenticate(req);
  if (!auth) return j({ error: 'Unauthorized' }, 401);
  const userId = auth.userId;

  if (!process.env.DEEPGRAM_API_KEY) return j({ error: 'managed_transcription_unavailable' }, 503);

  // Managed transcription requires active access: FREE during the 7-day trial
  // (no credit reserve/debit), credit-metered on Pro. Expired/free users are
  // blocked even with banked credits — those unlock again when Pro renews.
  const { data: trialing } = await supabase.rpc('user_is_trialing', { uid: userId });
  if (!trialing) {
    const { data: access } = await supabase.rpc('user_has_access', { uid: userId });
    if (!access) {
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://dialler-mcp.vercel.app';
      return j(
        { error: 'subscription_required', topUpUrl: `${baseUrl}/api/checkout/${userId}` },
        402,
      );
    }
  }

  // Free trial transcription is capped per rolling 24h (abuse guard on our key).
  if (trialing && !(await takeTrialMint(supabase, userId))) {
    return j({ error: 'trial_transcription_cap' }, 402);
  }

  let body: TokenBody;
  try {
    body = (await req.json()) as TokenBody;
  } catch {
    body = {};
  }

  const pricing = await getActivePricing();
  const model = typeof body.model === 'string' ? body.model : 'nova-3';
  if (!pricing.deepgram[model]) return j({ error: 'unknown_model' }, 400);

  // ── Settle the previous window (best-effort; the reaper backstops a missed
  //    settle).
  if (body.prevRequestId) {
    try {
      await settleWindow(userId, body.prevRequestId, body.prevSeconds, pricing);
    } catch (e) {
      console.error('[transcribe/token] settle prev failed (non-fatal)', e);
    }
  }

  // ── Reserve the next window. Every token owns a fresh reservation.
  const estCredits = estimateTranscriptionCredits(WINDOW_SECONDS / 60, model, pricing);
  const idemKey = reservationKey('transcribe', body.windowKey);
  let requestId = '';
  if (!trialing) {
    try {
      requestId = await reserve(
        userId,
        estCredits,
        idemKey,
        `${TRANSCRIBE_MODEL_PREFIX}${model}`,
        pricing.version,
      );
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
    if (requestId) {
      try {
        await refund(requestId, 0, null);
      } catch {
        /* reaper backstops */
      }
    }
    return j({ error: 'mint_failed' }, 502);
  }
}
