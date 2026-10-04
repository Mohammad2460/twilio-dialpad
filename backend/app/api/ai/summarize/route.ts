import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { corsHeaders } from '@/lib/cors';
import { authenticate } from '@/lib/auth';
import {
  getActivePricing,
  estimateTokens,
  enforceLlmCaps,
  costFromOpenAiUsage,
  CapExceededError,
  type OpenAiUsage,
} from '@/lib/credits';
import {
  INSIGHT_JSON_SCHEMA,
  insightSystemPrompt,
  insightUserPrompt,
  parseInsight,
  describeVendorError,
} from '@/lib/ai-prompts';
import { dayPeriod, limitBody } from '@/lib/plan';
import { getUserPlan, giveBackUsage, recordUsageCost, takeUsage } from '@/lib/usage';

export const runtime = 'nodejs';
// Headroom over VENDOR_TIMEOUT_MS: the vendor call must fail (and give the
// summary back) before the platform can stop the function mid-request.
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
 * Auth: device secret. Summaries do not use the monthly AI questions; a daily
 * cap per plan bounds them instead. The real vendor cost is recorded from the
 * usage object. The transcript is passed through and never stored or logged.
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

  // Estimate input tokens for the cap and the reservation hold.
  const estInputTokens = estimateTokens(system) + estimateTokens(user);
  const maxOut = pricing.caps.max_output_tokens;
  try {
    enforceLlmCaps(estInputTokens, maxOut, pricing);
  } catch (e) {
    if (e instanceof CapExceededError) return j({ error: 'too_large', detail: e.message }, 413);
    throw e;
  }

  const now = Date.now();
  const plan = await getUserPlan(userId, pricing, now);
  if (!plan) return j({ error: 'Unauthorized' }, 401);
  const day = dayPeriod(now);
  if (!(await takeUsage(userId, 'summaries', day, 1, plan.limits.summaries_per_day))) {
    return j(limitBody('summaries', plan.plan, plan.limits.summaries_per_day, now), 402);
  }
  const requestId = crypto.randomUUID();
  // The model did not run (or produced nothing billable): the summary is not counted.
  const notCounted = () => giveBackUsage(userId, 'summaries', day, 1);

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
  } catch (e) {
    console.error('[ai/summarize] vendor call failed', requestId, describeVendorError(e));
    await notCounted();
    return j({ error: 'generation_failed' }, 502);
  }

  // The recorded cost MUST come from real usage. With no usage object there is
  // nothing real to record and nothing is delivered: report a failed generation.
  if (typeof usage.prompt_tokens !== 'number' || usage.prompt_tokens <= 0) {
    console.error('[ai/summarize] vendor returned no usage', requestId);
    await notCounted();
    return j({ error: 'generation_failed' }, 502);
  }
  await recordUsageCost(userId, requestId, model, costFromOpenAiUsage(usage, model, pricing), pricing.version);

  const insight = parseInsight(content);
  if (!insight) return j({ error: 'bad_output' }, 502);

  return j({ insight, model });
}
