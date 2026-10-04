/**
 * Monthly usage counters (DB side). The rules — who is on which plan, what the
 * limits are, when a month starts — are in plan.ts; the SQL is in
 * scripts/migration-plan-usage.sql.
 *
 * Order of spend everywhere: the plan's monthly allowance first, then any
 * balance the user already holds in the credit ledger, then a 402. The client
 * is never asked what was used.
 */
import { supabase } from './supabase';
import { costFromDeepgramMinutes, type PricingConfig } from './pricing';
import { reservationKeyPrefix } from './reservation-key';
import { settleWindow as settleLedgerWindow } from './transcribe-settle';
import {
  billableSeconds,
  isUuid,
  RETRY_REUSE_SECONDS,
  WINDOW_SECONDS,
} from './transcribe-metering';
import { monthPeriod, planLimits, resolvePlan, type PlanInfo, type PlanLimits } from './plan';

export type UsageMetric = 'transcribe_seconds' | 'ai_questions' | 'summaries';

/** Below this, what is left of the month is not worth opening a window for. */
export const MIN_WINDOW_SECONDS = 10;

/** Window labels are stored under this scope (same sanitising as ledger keys). */
const WINDOW_KEY_SCOPE = 'transcribe';

export interface UserPlan extends PlanInfo {
  limits: PlanLimits;
  trialEndsAt: string | null;
  periodEnd: string | null;
}

/** The user's plan and its limits. Null when the user row is missing. */
export async function getUserPlan(
  userId: string,
  pricing: PricingConfig,
  nowMs = Date.now(),
): Promise<UserPlan | null> {
  const { data, error } = await supabase
    .from('users')
    .select('subscription_status, trial_ends_at, current_period_end')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw new Error(`plan lookup failed: ${error.message}`);
  if (!data) return null;
  const info = resolvePlan(data, nowMs);
  return {
    ...info,
    limits: planLimits(pricing, info.plan),
    trialEndsAt: data.trial_ends_at ?? null,
    periodEnd: data.current_period_end ?? null,
  };
}

/** Take `amount` from a counter if it fits under `limit`. True when taken. */
export async function takeUsage(
  userId: string,
  metric: UsageMetric,
  period: string,
  amount: number,
  limit: number,
): Promise<boolean> {
  if (limit <= 0) return false;
  const { data, error } = await supabase.rpc('usage_take', {
    p_user: userId,
    p_metric: metric,
    p_period: period,
    p_amount: amount,
    p_limit: limit,
  });
  if (error) throw new Error(`usage take failed: ${error.message}`);
  return data === true;
}

/** Return units taken for work that did not happen. Never throws. */
export async function giveBackUsage(
  userId: string,
  metric: UsageMetric,
  period: string,
  amount: number,
): Promise<void> {
  const { error } = await supabase.rpc('usage_give_back', {
    p_user: userId,
    p_metric: metric,
    p_period: period,
    p_amount: amount,
  });
  if (error) console.error('[usage] give back failed', metric, error.message);
}

/** This month's counters, for display. Missing rows read as zero. */
export async function readMonthUsage(
  userId: string,
  nowMs = Date.now(),
): Promise<{ transcribeSeconds: number; questions: number }> {
  const { data, error } = await supabase
    .from('usage_counters')
    .select('metric, used')
    .eq('user_id', userId)
    .eq('period', monthPeriod(nowMs))
    .in('metric', ['transcribe_seconds', 'ai_questions']);
  if (error) throw new Error(`usage read failed: ${error.message}`);
  const used = (metric: UsageMetric) =>
    (data ?? []).find((r) => r.metric === metric)?.used ?? 0;
  return { transcribeSeconds: used('transcribe_seconds'), questions: used('ai_questions') };
}

/**
 * Record what allowance usage really cost us, from the vendor's own usage
 * numbers. Bookkeeping only — it never changes a balance and never throws.
 */
export async function recordUsageCost(
  userId: string,
  requestId: string,
  model: string,
  vendorUsd: number | null,
  pricingVersion: number,
): Promise<void> {
  const { error } = await supabase.rpc('record_usage_cost', {
    p_user: userId,
    p_request_id: requestId,
    p_model: model,
    p_vendor_cost: vendorUsd,
    p_pricing_ver: pricingVersion,
  });
  if (error) console.error('[usage] cost record failed', requestId, error.message);
}

// ── Transcription windows paid from the monthly allowance ─────────────────────

export interface AllowanceWindow {
  id: string;
  /** Seconds this window may run: a full window, or what is left of the month. */
  seconds: number;
}

function windowKeyOf(clientKey: unknown): string | null {
  return reservationKeyPrefix(WINDOW_KEY_SCOPE, clientKey);
}

/** Take the next window from this month's allowance. Null when it is used up. */
export async function openAllowanceWindow(
  userId: string,
  model: string,
  clientKey: unknown,
  limitSeconds: number,
  nowMs = Date.now(),
): Promise<AllowanceWindow | null> {
  if (limitSeconds <= 0) return null;
  const { data, error } = await supabase.rpc('transcribe_window_open', {
    p_user: userId,
    p_period: monthPeriod(nowMs),
    p_window: WINDOW_SECONDS,
    p_limit: limitSeconds,
    p_min: MIN_WINDOW_SECONDS,
    p_model: model,
    p_key: windowKeyOf(clientKey),
  });
  if (error) throw new Error(`window open failed: ${error.message}`);
  const row = (Array.isArray(data) ? data[0] : data) as { id?: string; held_seconds?: number } | null;
  return row?.id && row.held_seconds ? { id: row.id, seconds: row.held_seconds } : null;
}

/**
 * The caller's own just-opened, still-pending allowance window for this window
 * label and model (a retry of a failed open), so it is not taken twice.
 */
export async function findRetryAllowanceWindow(
  userId: string,
  clientKey: unknown,
  model: string,
  nowMs = Date.now(),
): Promise<AllowanceWindow | null> {
  const key = windowKeyOf(clientKey);
  if (!key) return null;
  const { data, error } = await supabase
    .from('transcribe_windows')
    .select('id, held_seconds')
    .eq('user_id', userId)
    .eq('status', 'pending')
    .eq('model', model)
    .eq('window_key', key)
    .gte('created_at', new Date(nowMs - RETRY_REUSE_SECONDS * 1000).toISOString())
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw new Error(`retry window lookup failed: ${error.message}`);
  const row = data?.[0];
  return row ? { id: row.id, seconds: row.held_seconds } : null;
}

/**
 * Settle an allowance window at the seconds used (server clock bounds the
 * client's report — see billableSeconds) and give the rest back.
 * Returns null when `id` is not an allowance window at all (the caller then
 * tries the credit ledger), false when it is not this user's to settle.
 */
export async function settleAllowanceWindow(
  userId: string,
  id: string,
  reportedSeconds: unknown,
  pricing: PricingConfig,
  nowMs = Date.now(),
): Promise<boolean | null> {
  const { data: row, error } = await supabase
    .from('transcribe_windows')
    .select('user_id, model, status, held_seconds, created_at')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`window lookup failed: ${error.message}`);
  if (!row) return null;
  if (row.user_id !== userId || row.status !== 'pending') return false;

  const seconds = Math.ceil(
    billableSeconds(reportedSeconds, nowMs - Date.parse(row.created_at), row.held_seconds),
  );
  const { data: settled, error: settleErr } = await supabase.rpc('transcribe_window_settle', {
    p_id: id,
    p_user: userId,
    p_seconds: seconds,
  });
  if (settleErr) throw new Error(`window settle failed: ${settleErr.message}`);
  if (settled !== true) return false;

  if (seconds > 0 && pricing.deepgram[row.model]) {
    const usd = costFromDeepgramMinutes(seconds / 60, row.model, pricing);
    await recordUsageCost(userId, id, `deepgram:${row.model}`, usd, pricing.version);
  }
  return true;
}

/** Release a window whose token was never delivered (the mint failed). */
export async function releaseAllowanceWindow(userId: string, id: string): Promise<void> {
  const { error } = await supabase.rpc('transcribe_window_settle', { p_id: id, p_user: userId, p_seconds: 0 });
  if (error) console.error('[usage] window release failed', id, error.message);
}

/**
 * Settle a transcription window wherever it was paid from: the monthly
 * allowance, or (for balance-paid windows) the credit ledger.
 */
export async function settleAnyWindow(
  userId: string,
  requestId: unknown,
  reportedSeconds: unknown,
  pricing: PricingConfig,
): Promise<void> {
  if (!isUuid(requestId)) return;
  const allowance = await settleAllowanceWindow(userId, requestId, reportedSeconds, pricing);
  if (allowance === null) await settleLedgerWindow(userId, requestId, reportedSeconds, pricing);
}

/** Dollars-and-cents view of the ledger balance (1 credit = 1 cent). */
export async function extraBalanceCents(userId: string): Promise<number> {
  const { data, error } = await supabase.rpc('credit_balance', { p_user: userId });
  if (error) throw new Error(`balance failed: ${error.message}`);
  return Math.max(0, (data as number) ?? 0);
}
