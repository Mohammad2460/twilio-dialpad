/**
 * Phase 8 (v2) — managed-AI credit engine (backend).
 *
 * The DB (migration-credits.sql) holds the atomic, oversell-safe logic in
 * plpgsql; this module is the typed TS surface over it:
 *   - loads the active versioned pricing_config (short in-memory cache),
 *   - converts real vendor usage → USD → credits (provider-agnostic adapters),
 *   - wraps the reserve/settle/refund/grant RPCs,
 *   - enforces hard per-request caps before any vendor call.
 *
 * 1 credit = $0.01 face value. credits = max(min_charge, ceil(usd * markup * 100)).
 * `vendor_cost_usd` for settlement MUST come from the real API usage object,
 * never an estimate.
 */
import { supabase } from './supabase';
import { InsufficientCreditsError, type PricingConfig } from './pricing';

// Re-export the pure pricing math so existing importers (`@/lib/credits`) are
// unchanged. The math itself lives in pricing.ts (no DB import) so it's unit-
// testable without stalling the test runner on the supabase client.
export {
  usdToCredits,
  costFromAnthropicUsage,
  costFromDeepgramMinutes,
  estimateLlmCredits,
  estimateTranscriptionCredits,
  enforceLlmCaps,
  InsufficientCreditsError,
  CapExceededError,
} from './pricing';
export type { PricingConfig, AnthropicUsage } from './pricing';

// ── Pricing config (cached briefly; it changes rarely and is request-hot) ──────
let cached: { cfg: PricingConfig; at: number } | null = null;
const PRICING_TTL_MS = 60_000;

export async function getActivePricing(): Promise<PricingConfig> {
  if (cached && Date.now() - cached.at < PRICING_TTL_MS) return cached.cfg;
  const { data, error } = await supabase
    .from('pricing_config')
    .select('version, config')
    .eq('active', true)
    .maybeSingle();
  if (error || !data) throw new Error('no active pricing_config');
  const cfg = { version: data.version as number, ...(data.config as object) } as PricingConfig;
  cached = { cfg, at: Date.now() };
  return cfg;
}

/** Test/seam hook — force a refetch (e.g. after a pricing version flip). */
export function clearPricingCache(): void {
  cached = null;
}

// ── Ledger RPC wrappers ───────────────────────────────────────────────────────
export async function getBalance(userId: string): Promise<number> {
  const { data, error } = await supabase.rpc('credit_balance', { p_user: userId });
  if (error) throw new Error(`balance failed: ${error.message}`);
  return (data as number) ?? 0;
}

/**
 * Reserve `credits` (idempotent on idemKey). Returns the reservation request_id.
 * Throws InsufficientCreditsError when the balance can't cover the hold.
 */
export async function reserve(
  userId: string,
  credits: number,
  idemKey: string,
  model: string | null,
  pricingVersion: number,
): Promise<string> {
  const { data, error } = await supabase.rpc('reserve_credits', {
    p_user: userId,
    p_amount: credits,
    p_idem_key: idemKey,
    p_model: model,
    p_pricing_ver: pricingVersion,
  });
  if (error) {
    if (error.message.includes('insufficient_credits')) throw new InsufficientCreditsError();
    throw new Error(`reserve failed: ${error.message}`);
  }
  return data as string;
}

/** Settle a reservation to its real cost. Returns the new balance. */
export async function settle(
  requestId: string,
  actualCredits: number,
  vendorCostUsd: number | null,
  model: string | null,
): Promise<number> {
  const { data, error } = await supabase.rpc('settle_credits', {
    p_request_id: requestId,
    p_actual_credits: actualCredits,
    p_vendor_cost: vendorCostUsd,
    p_model: model,
  });
  if (error) throw new Error(`settle failed: ${error.message}`);
  return data as number;
}

/**
 * Refund a reservation, keeping `incurredCredits` (vendor cost already paid on a
 * partial generation). Returns the new balance.
 */
export async function refund(
  requestId: string,
  incurredCredits: number,
  vendorCostUsd: number | null,
): Promise<number> {
  const { data, error } = await supabase.rpc('refund_credits', {
    p_request_id: requestId,
    p_incurred_credits: incurredCredits,
    p_vendor_cost: vendorCostUsd,
  });
  if (error) throw new Error(`refund failed: ${error.message}`);
  return data as number;
}

/** Grant credits (monthly grant or top-up). Idempotent on idemKey. */
export async function grant(
  userId: string,
  credits: number,
  kind: 'grant' | 'topup',
  expiresAt: string | null,
  idemKey: string,
  pricingVersion: number | null,
): Promise<number> {
  const { data, error } = await supabase.rpc('grant_credits', {
    p_user: userId,
    p_amount: credits,
    p_kind: kind,
    p_expires_at: expiresAt,
    p_idem_key: idemKey,
    p_pricing_ver: pricingVersion,
  });
  if (error) throw new Error(`grant failed: ${error.message}`);
  return data as number;
}
