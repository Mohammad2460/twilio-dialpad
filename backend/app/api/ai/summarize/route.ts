import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { corsHeaders } from '@/lib/cors';
import { authenticate } from '@/lib/auth';
import {
  getActivePricing,
  estimateLlmCredits,
  enforceLlmCaps,
  costFromOpenAiUsage,
  usdToCredits,
  reserve,
  settleWithRetry,
  refund,
  CapExceededError,
  InsufficientCreditsError,
  type OpenAiUsage,
} from '@/lib/credits';
import {
  INSIGHT_JSON_SCHEMA,
  insightSystemPrompt,
  insightUserPrompt,
  parseInsight,
} from '@/lib/ai-prompts';
import { reservationKey } from '@/lib/reservation-key';

export const runtime = 'nodejs';
// Headroom over VENDOR_TIMEOUT_MS: the vendor call must fail (and release the
// hold) before the platform can stop the function between reserve and settle.
export const maxDuration = 300;
const VENDOR_TIMEOUT_MS = 120_000;

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

function j(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: corsHeaders });
}

/** Summaries always run on the cheap default model — never client-selectable. */
const INSIGHT_MODEL = 'gpt-5-mini';

interface SummarizeBody {
  /** Plain-text transcript, assembled client-side (`[mm:ss] You: …` lines). */
  transcript?: string;
  /** Local date of the call, YYYY-MM-DD — anchors "Thursday" / "next week". */
  callDate?: string;
  direction?: 'in' | 'out';
  contactName?: string;
  idempotencyKey?: string;
}

/**
 * POST /api/ai/summarize — structured post-call notes (summary, objections,
 * promises, next step) for one transcript.
 *
 * Auth: device secret. Metered by credits like the chatbox: reserve an estimated
 * hold → one JSON completion → settle to the real token usage → refund if the
 * vendor call fails. The transcript is passed through and never stored or logged.
 */
export async function POST(req: NextRequest) {
  const auth = await authenticate(req);
  if (!auth) return j({ error: 'Unauthorized' }, 401);
  const userId = auth.userId;

  let body: SummarizeBody;
  try {
    body = (await req.json()) as SummarizeBody;
  } catch {
    return j({ error: 'bad_json' }, 400);
  }

  const transcript = typeof body.transcript === 'string' ? body.transcript.trim() : '';
  if (!transcript) return j({ error: 'no_transcript' }, 400);
  const callDate =
    typeof body.callDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.callDate)
      ? body.callDate
      : new Date().toISOString().slice(0, 10);
  const direction = body.direction === 'in' || body.direction === 'out' ? body.direction : undefined;
  const contactName =
    typeof body.contactName === 'string' ? body.contactName.trim().slice(0, 120) || undefined : undefined;

  const pricing = await getActivePricing();
  const model = INSIGHT_MODEL;
  if (!pricing.llm[model]) return j({ error: 'ai_unavailable' }, 503);
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return j({ error: 'ai_unavailable' }, 503);

  const system = insightSystemPrompt();
  const user = insightUserPrompt({ transcript, callDate, direction, contactName });

  // Estimate input tokens for the reservation hold (chars/4 heuristic, upper-bounded).
  const estInputTokens = Math.ceil((system.length + user.length) / 4);
  const maxOut = pricing.caps.max_output_tokens;
  try {
    enforceLlmCaps(estInputTokens, maxOut, pricing);
  } catch (e) {
    if (e instanceof CapExceededError) return j({ error: 'too_large', detail: e.message }, 413);
    throw e;
  }

  const estCredits = estimateLlmCredits(estInputTokens, model, pricing);
  let requestId: string;
  try {
    requestId = await reserve(
      userId,
      estCredits,
      reservationKey('insight', body.idempotencyKey),
      model,
      pricing.version,
    );
  } catch (e) {
    if (e instanceof InsufficientCreditsError) {
      return j({ error: 'insufficient_credits', need: estCredits }, 402);
    }
    throw e;
  }

  let content: string;
  let usage: OpenAiUsage;
  try {
    const completion = await new OpenAI({ apiKey, timeout: VENDOR_TIMEOUT_MS, maxRetries: 1 }).chat.completions.create({
      model,
      // gpt-5 family: max_completion_tokens (not max_tokens), no temperature/top_p.
      max_completion_tokens: maxOut,
      reasoning_effort: 'low',
      response_format: { type: 'json_schema', json_schema: INSIGHT_JSON_SCHEMA },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    });
    content = completion.choices[0]?.message?.content ?? '';
    usage = (completion.usage ?? {}) as OpenAiUsage;
  } catch {
    // Vendor call failed before producing usage — nothing incurred, release the hold.
    try {
      const balance = await refund(requestId, 0, null);
      return j({ error: 'generation_failed', balance }, 502);
    } catch {
      return j({ error: 'generation_failed' }, 502);
    }
  }

  // Settlement MUST come from real usage. With no usage object we have no real
  // cost — bill the conservative reserved estimate rather than letting cost
  // collapse to min_charge (same rule as the chat route).
  let credits: number;
  let vendorUsd: number | null;
  if (typeof usage.prompt_tokens !== 'number' || usage.prompt_tokens <= 0) {
    credits = estCredits;
    vendorUsd = null;
  } else {
    vendorUsd = costFromOpenAiUsage(usage, model, pricing);
    credits = usdToCredits(vendorUsd, pricing);
  }

  // The model has run, so the work is delivered either way. If the ledger stays
  // unreachable the charge is lost, but failing the request would only make the
  // client ask again and run the model a second time.
  let balance: number | undefined;
  try {
    balance = await settleWithRetry(requestId, credits, vendorUsd, model);
  } catch (e) {
    console.error('[ai/summarize] settle failed', requestId, e instanceof Error ? e.message : e);
  }

  const insight = parseInsight(content);
  if (!insight) return j({ error: 'bad_output', credits, balance }, 502);

  return j({ insight, model, credits, balance });
}
