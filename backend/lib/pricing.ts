/**
 * Pure pricing/credit math — NO database imports, so it's unit-testable in
 * isolation (importing the supabase client transitively stalls the test runner's
 * dep optimizer). credits.ts re-exports everything here and adds the RPC layer.
 *
 * 1 credit = $0.01 face value. credits = max(min_charge, ceil(usd * markup * 100)).
 * Settlement cost MUST come from the real vendor usage object, never an estimate.
 */

export interface PricingConfig {
  version: number;
  markup: number;
  min_charge: number;
  monthly_grant: number;
  free_grant: number;
  topup_expiry_months: number;
  transcription_channels: number;
  caps: { max_input_tokens: number; max_output_tokens: number };
  llm: Record<string, { in: number; out: number; cache_write: number; cache_read: number }>;
  deepgram: Record<string, { per_min: number }>;
}

/** Anthropic Messages API usage shape (the fields that bill). */
export interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export class InsufficientCreditsError extends Error {
  constructor(public have?: number, public need?: number) {
    super('insufficient_credits');
    this.name = 'InsufficientCreditsError';
  }
}
export class CapExceededError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'CapExceededError';
  }
}

// ── USD → credits ─────────────────────────────────────────────────────────────
export function usdToCredits(usd: number, p: PricingConfig): number {
  const raw = Math.ceil(usd * p.markup * 100);
  return Math.max(p.min_charge, raw);
}

// ── Provider-agnostic cost adapters (USD from REAL usage) ─────────────────────
/** Anthropic token usage → USD using the active per-model rates (per 1M tokens). */
export function costFromAnthropicUsage(
  usage: AnthropicUsage,
  model: string,
  p: PricingConfig,
): number {
  const rate = p.llm[model];
  if (!rate) throw new Error(`no pricing for model ${model}`);
  const inTok = usage.input_tokens ?? 0;
  const outTok = usage.output_tokens ?? 0;
  const cw = usage.cache_creation_input_tokens ?? 0;
  const cr = usage.cache_read_input_tokens ?? 0;
  return (
    (inTok * rate.in + outTok * rate.out + cw * rate.cache_write + cr * rate.cache_read) / 1_000_000
  );
}

/** Deepgram billed minutes → USD. Channels from config (mono=1, stereo=2). */
export function costFromDeepgramMinutes(minutes: number, model: string, p: PricingConfig): number {
  const rate = p.deepgram[model];
  if (!rate) throw new Error(`no deepgram pricing for model ${model}`);
  const channels = Math.max(1, p.transcription_channels);
  return minutes * channels * rate.per_min;
}

// ── Estimates for the reservation hold (upper bound; settle is exact) ─────────
/** Worst-case LLM credits: full input estimate + capped output at this model. */
export function estimateLlmCredits(
  estInputTokens: number,
  model: string,
  p: PricingConfig,
): number {
  const usd = costFromAnthropicUsage(
    { input_tokens: estInputTokens, output_tokens: p.caps.max_output_tokens },
    model,
    p,
  );
  return usdToCredits(usd, p);
}

/** Transcription credits for a window of audio minutes. */
export function estimateTranscriptionCredits(
  minutes: number,
  model: string,
  p: PricingConfig,
): number {
  return usdToCredits(costFromDeepgramMinutes(minutes, model, p), p);
}

/** Reject over-cap LLM requests BEFORE spending money. Throws CapExceededError. */
export function enforceLlmCaps(inputTokens: number, maxOutputTokens: number, p: PricingConfig): void {
  if (inputTokens > p.caps.max_input_tokens) {
    throw new CapExceededError(`input ${inputTokens} > cap ${p.caps.max_input_tokens}`);
  }
  if (maxOutputTokens > p.caps.max_output_tokens) {
    throw new CapExceededError(`max_output ${maxOutputTokens} > cap ${p.caps.max_output_tokens}`);
  }
}
