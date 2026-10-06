/**
 * Free / Pro plan rules — pure (no DB import), so they are unit-testable.
 * The DB-touching counters live in usage.ts.
 *
 * Plan = Pro while the user has an active paid subscription (any product) or an
 * open trial; otherwise Free. Dodo only decides that; everything counted here is
 * enforced by the backend. Limits and prices come from the active
 * pricing_config, with the defaults below when a config predates them.
 */
import type { PricingConfig } from './pricing';

export type PlanName = 'free' | 'pro';
export type BillingCycle = 'monthly' | 'yearly';
export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'cancelled' | 'expired';

export interface PlanLimits {
  /** Managed transcription per calendar month. */
  transcribe_seconds: number;
  /** AI questions per calendar month. One question counts as one. */
  ai_questions: number;
  /** Automatic call summaries per day — an abuse guard, not shown to users. */
  summaries_per_day: number;
  /** Newest calls the Claude connector may read. null = all. */
  connector_calls: number | null;
}

export interface CheckoutProduct {
  name: string;
  price_cents: number;
}

export const DEFAULT_LIMITS: Record<PlanName, PlanLimits> = {
  free: { transcribe_seconds: 1800, ai_questions: 20, summaries_per_day: 10, connector_calls: 5 },
  pro: { transcribe_seconds: 36000, ai_questions: 500, summaries_per_day: 100, connector_calls: null },
};

export const DEFAULT_CHECKOUT: Record<BillingCycle, CheckoutProduct> = {
  monthly: { name: 'Twilio Dialpad Pro Monthly', price_cents: 1900 },
  yearly: { name: 'Twilio Dialpad Pro Yearly', price_cents: 18000 },
};

function count(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : fallback;
}

/** Limits for a plan from the active config; any missing or bad value falls back to the default. */
export function planLimits(pricing: Pick<PricingConfig, 'plans'>, plan: PlanName): PlanLimits {
  const d = DEFAULT_LIMITS[plan];
  const c = pricing.plans?.[plan];
  if (!c) return d;
  const connector = c.connector_calls;
  return {
    transcribe_seconds: count(c.transcribe_seconds, d.transcribe_seconds),
    ai_questions: count(c.ai_questions, d.ai_questions),
    summaries_per_day: count(c.summaries_per_day, d.summaries_per_day),
    connector_calls:
      connector === null ? null : connector === undefined ? d.connector_calls : count(connector, d.connector_calls ?? 0),
  };
}

/** The product a new checkout uses for a billing cycle. */
export function checkoutProduct(pricing: Pick<PricingConfig, 'checkout'>, cycle: BillingCycle): CheckoutProduct {
  const d = DEFAULT_CHECKOUT[cycle];
  const c = pricing.checkout?.[cycle];
  if (!c || typeof c.name !== 'string' || !c.name.trim()) return d;
  const price = count(c.price_cents, 0);
  return price > 0 ? { name: c.name.trim(), price_cents: price } : d;
}

/** Anything other than an explicit 'yearly' is monthly — including no body at all (older builds). */
export function parseCycle(v: unknown): BillingCycle {
  return v === 'yearly' ? 'yearly' : 'monthly';
}

// ── Who is on which plan ──────────────────────────────────────────────────────

export interface SubscriptionRow {
  subscription_status: string | null;
  trial_ends_at: string | null;
  current_period_end: string | null;
}

export interface PlanInfo {
  plan: PlanName;
  status: SubscriptionStatus;
  /** Trial window still open (full Pro). */
  trialing: boolean;
  trialDaysLeft?: number;
}

const STATUSES: readonly SubscriptionStatus[] = ['trialing', 'active', 'past_due', 'cancelled', 'expired'];

/** Mirrors the SQL user_has_access(): paid-in-period or open trial = Pro. */
export function resolvePlan(row: SubscriptionRow, nowMs: number): PlanInfo {
  const status = STATUSES.includes(row.subscription_status as SubscriptionStatus)
    ? (row.subscription_status as SubscriptionStatus)
    : 'trialing';
  const trialEnds = row.trial_ends_at ? Date.parse(row.trial_ends_at) : NaN;
  const periodEnd = row.current_period_end ? Date.parse(row.current_period_end) : NaN;

  const trialing = status === 'trialing' && trialEnds > nowMs;
  const paid = (status === 'active' || status === 'past_due' || status === 'cancelled') && periodEnd > nowMs;

  return {
    plan: trialing || paid ? 'pro' : 'free',
    status,
    trialing,
    trialDaysLeft: trialing ? Math.ceil((trialEnds - nowMs) / 86_400_000) : undefined,
  };
}

/** HubSpot contact data (lookup results synced with calls, connector filter) is a Pro feature. */
export function hubspotAllowed(plan: PlanName): boolean {
  return plan === 'pro';
}

// ── Periods (UTC) ─────────────────────────────────────────────────────────────
// Everyone resets on the 1st of the month, whatever their billing date — which
// also covers yearly subscribers, who only renew once a year.

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** The monthly period key: the 1st of this month, YYYY-MM-DD. */
export function monthPeriod(nowMs: number): string {
  const d = new Date(nowMs);
  return ymd(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)));
}

/** The daily period key, YYYY-MM-DD. */
export function dayPeriod(nowMs: number): string {
  return ymd(new Date(nowMs));
}

/** When the monthly counters reset: 00:00 UTC on the 1st of next month. */
export function nextReset(nowMs: number): string {
  const d = new Date(nowMs);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString();
}

// ── At a limit ────────────────────────────────────────────────────────────────

export type LimitKind = 'transcription' | 'questions' | 'summaries';

/**
 * The 402 body at a limit. `error` stays 'insufficient_credits' — the builds
 * already in the store stop transcription gracefully on exactly that value —
 * and the rest tells newer builds what ran out and when it comes back.
 */
export function limitBody(kind: LimitKind, plan: PlanName, max: number, nowMs: number) {
  return {
    error: 'insufficient_credits' as const,
    limit: kind,
    plan,
    max,
    resetsAt: kind === 'summaries' ? undefined : nextReset(nowMs),
  };
}
