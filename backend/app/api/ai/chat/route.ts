import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { corsHeaders } from '@/lib/cors';
import { authenticate } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import {
  getActivePricing,
  estimateLlmCredits,
  enforceLlmCaps,
  costFromAnthropicUsage,
  costFromOpenAiUsage,
  providerForModel,
  usdToCredits,
  reserve,
  settle,
  refund,
  CapExceededError,
  InsufficientCreditsError,
  type AnthropicUsage,
  type OpenAiUsage,
} from '@/lib/credits';

export const runtime = 'nodejs';

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

function j(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: corsHeaders });
}

/** Models a free user may call. Premium models require Pro (or top-up credits). */
const FREE_MODELS = new Set(['claude-haiku-4-5', 'gpt-5-mini']);

async function hasPro(userId: string): Promise<boolean> {
  const { data } = await supabase.rpc('user_has_access', { uid: userId });
  return !!data;
}

interface ChatBody {
  model?: string;
  /** Plain-text transcript of the call, assembled client-side. */
  transcript?: string;
  /** Prior chat turns in this thread (user/assistant). */
  messages?: { role: 'user' | 'assistant'; content: string }[];
  /** Per-message idempotency key from the client (dedupes reserve on retry). */
  idempotencyKey?: string;
}

/**
 * POST /api/ai/chat — managed Claude chatbox over a call transcript.
 *
 * Auth: device secret. Metered by credits (NOT Pro-gated for Haiku — free tier
 * gets a small taste grant). Premium models (Sonnet/Opus) require Pro.
 *
 * Flow: reserve an estimated hold → stream the completion to the client (SSE) →
 * settle to the real token usage on completion → refund on failure.
 */
export async function POST(req: NextRequest) {
  const auth = await authenticate(req);
  if (!auth) return j({ error: 'Unauthorized' }, 401);
  const userId = auth.userId;

  let body: ChatBody;
  try {
    body = (await req.json()) as ChatBody;
  } catch {
    return j({ error: 'bad_json' }, 400);
  }

  const pricing = await getActivePricing();
  const model = body.model ?? 'claude-haiku-4-5';
  if (!pricing.llm[model]) return j({ error: 'unknown_model' }, 400);

  // Premium models are Pro-only; Haiku is open to all (credit-gated).
  if (!FREE_MODELS.has(model)) {
    if (!(await hasPro(userId))) {
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://dialler-mcp.vercel.app';
      return j(
        { error: 'pro_required', model, upgradeUrl: `${baseUrl}/api/checkout/${userId}` },
        402,
      );
    }
  }

  const transcript = typeof body.transcript === 'string' ? body.transcript : '';
  const turns = Array.isArray(body.messages) ? body.messages : [];
  if (turns.length === 0) return j({ error: 'no_messages' }, 400);

  const provider = providerForModel(model);
  const apiKey =
    provider === 'openai' ? process.env.OPENAI_API_KEY : process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return j({ error: 'ai_unavailable' }, 503);

  const system =
    'You are a sales-call coach embedded in a dialer. Answer the user’s questions ' +
    'about THIS call using the transcript below. Be concise, specific, and tactical. ' +
    'If the transcript does not contain the answer, say so.\n\n' +
    `--- CALL TRANSCRIPT ---\n${transcript}\n--- END TRANSCRIPT ---`;

  // Estimate input tokens for the reservation hold (chars/4 heuristic, upper-bounded).
  const promptChars = system.length + turns.reduce((n, m) => n + m.content.length, 0);
  const estInputTokens = Math.ceil(promptChars / 4);
  const maxOut = pricing.caps.max_output_tokens;

  try {
    enforceLlmCaps(estInputTokens, maxOut, pricing);
  } catch (e) {
    if (e instanceof CapExceededError) return j({ error: 'too_large', detail: e.message }, 413);
    throw e;
  }

  const estCredits = estimateLlmCredits(estInputTokens, model, pricing);
  const idemKey = body.idempotencyKey ?? crypto.randomUUID();

  let requestId: string;
  try {
    requestId = await reserve(userId, estCredits, idemKey, model, pricing.version);
  } catch (e) {
    if (e instanceof InsufficientCreditsError) {
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://dialler-mcp.vercel.app';
      return j({ error: 'insufficient_credits', need: estCredits, topUpUrl: `${baseUrl}/api/checkout/${userId}` }, 402);
    }
    throw e;
  }

  // Stream the completion to the client; accumulate usage for settlement.
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      try {
        // Vendor-specific streaming; both paths must yield a real USD cost from
        // the API's own usage object (never an estimate) for settlement.
        let vendorUsd: number;
        if (provider === 'openai') {
          const oai = new OpenAI({ apiKey });
          const completion = await oai.chat.completions.create({
            model,
            max_completion_tokens: maxOut,
            stream: true,
            stream_options: { include_usage: true },
            messages: [
              { role: 'system', content: system },
              ...turns.map((m) => ({ role: m.role, content: m.content })),
            ],
          });
          let usage: OpenAiUsage = {};
          for await (const chunk of completion) {
            const delta = chunk.choices[0]?.delta?.content;
            if (delta) send('delta', { text: delta });
            if (chunk.usage) usage = chunk.usage as OpenAiUsage;
          }
          vendorUsd = costFromOpenAiUsage(usage, model, pricing);
        } else {
          const ant = new Anthropic({ apiKey }).messages.stream({
            model,
            max_tokens: maxOut,
            system,
            messages: turns.map((m) => ({ role: m.role, content: m.content })),
          });
          ant.on('text', (delta) => send('delta', { text: delta }));
          const final = await ant.finalMessage();
          vendorUsd = costFromAnthropicUsage(final.usage as AnthropicUsage, model, pricing);
        }

        const actualCredits = usdToCredits(vendorUsd, pricing);
        const balance = await settle(requestId, actualCredits, vendorUsd, model);
        send('done', { credits: actualCredits, balance });
        controller.close();
      } catch (err) {
        // Generation failed/partial — refund the hold (no vendor usage captured here,
        // so treat as fully unincurred; a partial that still billed is rare for chat).
        try {
          const balance = await refund(requestId, 0, null);
          send('error', { error: 'generation_failed', balance });
        } catch {
          send('error', { error: 'generation_failed' });
        }
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
