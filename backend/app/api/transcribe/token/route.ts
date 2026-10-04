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
import { findRetryWindow, TRANSCRIBE_KEY_SCOPE } from '@/lib/transcribe-settle';
import { limitBody } from '@/lib/plan';
import {
  findRetryAllowanceWindow,
  getUserPlan,
  openAllowanceWindow,
  releaseAllowanceWindow,
  settleAnyWindow,
  type AllowanceWindow,
} from '@/lib/usage';

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
 * Flow per window: settle the previous window to actual usage → take the next
 * window from the plan's monthly allowance (or, once that is used up, reserve
 * it from a balance the user already holds) → mint a short-lived Deepgram JWT.
 * 402 when neither covers the next window: the client stops transcription and
 * the call is unaffected. Device-auth. Free and Pro both transcribe; only the
 * monthly limit differs.
 */
export async function POST(req: NextRequest) {
  const auth = await authenticate(req);
  if (!auth) return j({ error: 'Unauthorized' }, 401);
  const userId = auth.userId;

  if (!process.env.DEEPGRAM_API_KEY) return j({ error: 'managed_transcription_unavailable' }, 503);

  const now = Date.now();
  const pricing = await getActivePricing();
  const plan = await getUserPlan(userId, pricing, now);
  if (!plan) return j({ error: 'Unauthorized' }, 401);

  // Trial transcription is also capped per rolling 24h (abuse guard on our key:
  // a trial account costs nothing to create).
  if (plan.trialing && !(await takeTrialMint(supabase, userId))) {
    return j({ error: 'trial_transcription_cap' }, 402);
  }

  let body: TokenBody;
  try {
    body = (await req.json()) as TokenBody;
  } catch {
    body = {};
  }

  const model = typeof body.model === 'string' ? body.model : 'nova-3';
  if (!pricing.deepgram[model]) return j({ error: 'unknown_model' }, 400);

  // ── Settle the previous window (best-effort; the reaper backstops a missed
  //    settle).
  if (body.prevRequestId) {
    try {
      await settleAnyWindow(userId, body.prevRequestId, body.prevSeconds, pricing);
    } catch (e) {
      console.error('[transcribe/token] settle prev failed (non-fatal)', e);
    }
  }

  // ── Next window. The one exception to a fresh window is the client retrying
  //    an open it just made, which gets its own still-pending window back.
  let allowance: AllowanceWindow | null = null;
  let requestId = '';
  let reserved = false;
  let opened = false;
  try {
    allowance = await findRetryAllowanceWindow(userId, body.windowKey, model, now);
  } catch (e) {
    console.error('[transcribe/token] retry lookup failed (non-fatal)', e);
  }
  if (!allowance) {
    allowance = await openAllowanceWindow(userId, model, body.windowKey, plan.limits.transcribe_seconds, now);
    opened = !!allowance;
  }

  if (allowance) {
    requestId = allowance.id;
  } else {
    // Allowance used up — fall back to a balance the user already holds.
    const estCredits = estimateTranscriptionCredits(WINDOW_SECONDS / 60, model, pricing);
    try {
      requestId = (await findRetryWindow(userId, body.windowKey, model)) ?? '';
    } catch (e) {
      console.error('[transcribe/token] retry lookup failed (non-fatal)', e);
    }
    if (!requestId) {
      try {
        requestId = await reserve(
          userId,
          estCredits,
          reservationKey(TRANSCRIBE_KEY_SCOPE, body.windowKey),
          `${TRANSCRIBE_MODEL_PREFIX}${model}`,
          pricing.version,
        );
        reserved = true;
      } catch (e) {
        if (e instanceof InsufficientCreditsError) {
          return j(limitBody('transcription', plan.plan, plan.limits.transcribe_seconds, now), 402);
        }
        throw e;
      }
    }
  }

  // ── Mint the token; undo the window taken here if Deepgram is unreachable.
  try {
    const grant = await mintDeepgramToken(TTL_SECONDS);
    return j({
      token: grant.access_token,
      expiresIn: grant.expires_in,
      requestId,
      windowSeconds: allowance?.seconds ?? WINDOW_SECONDS,
      model,
    });
  } catch (e) {
    console.error('[transcribe/token] mint failed', e);
    if (allowance && opened) {
      await releaseAllowanceWindow(userId, allowance.id);
    } else if (reserved) {
      try {
        await refund(requestId, 0, null);
      } catch {
        /* reaper backstops */
      }
    }
    return j({ error: 'mint_failed' }, 502);
  }
}
