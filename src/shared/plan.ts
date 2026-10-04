/**
 * Plan + monthly usage — client (extension side).
 *
 * The BACKEND decides the plan, counts usage and stops at a limit. This module
 * only fetches that state for display (meters, "X left" chip, at-limit copy)
 * and formats it. Limits and prices arrive from the backend, so they can change
 * without a new extension release.
 */
import { authHeader, type SubscriptionStatus } from './cloud';

const BASE_URL = 'https://dialler-mcp.vercel.app';

export type PlanName = 'free' | 'pro';
export type BillingCycle = 'monthly' | 'yearly';

export interface Meter {
  used: number;
  limit: number;
}

export interface PlanLimits {
  /** Managed transcription per calendar month, in seconds. */
  transcriptionSeconds: number;
  /** AI questions per calendar month. */
  questions: number;
}

export interface PlanState {
  plan: PlanName;
  status: SubscriptionStatus;
  trialDaysLeft?: number;
  trialEndsAt?: string;
  /** End of the paid period (renewal date, or end of access when cancelled). */
  periodEnd?: string;
  /** When both meters reset: the 1st of next month, 00:00 UTC. */
  resetsAt: string;
  /** Seconds. */
  transcription: Meter;
  questions: Meter;
  /** Balance bought or granted before monthly allowances; spent after them. */
  extraBalanceCents: number;
  prices: { monthlyCents: number; yearlyCents: number };
  limits: { free: PlanLimits; pro: PlanLimits };
}

/**
 * Free-plan limits on features that cost us nothing, enforced only here in the
 * extension (the backend enforces everything that costs money).
 */
export const FREE_HISTORY_DAYS = 30;
export const FREE_AUTODIAL_MAX = 25;
export const PRO_AUTODIAL_MAX = 100;
export const FREE_CONNECTOR_CALLS = 5;

export function isPro(p: PlanState | null): boolean {
  return p?.plan === 'pro';
}

export type MeterLevel = 'ok' | 'low' | 'out';

/** A meter is "low" from 80% used and "out" at its limit. */
export const LOW_AT = 0.8;

export function meterLevel(m: Meter): MeterLevel {
  if (m.limit <= 0 || m.used >= m.limit) return 'out';
  return m.used / m.limit >= LOW_AT ? 'low' : 'ok';
}

export function meterPct(m: Meter): number {
  if (m.limit <= 0) return 100;
  return Math.max(0, Math.min(100, (m.used / m.limit) * 100));
}

/** "12 min", "1 h 30 min", "10 h". Partial minutes round down. */
export function fmtDuration(seconds: number): string {
  const mins = Math.max(0, Math.floor(seconds / 60));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** "12 of 30 min", "3 h 20 min of 10 h". */
export function fmtTranscriptionUsage(m: Meter): string {
  const used = Math.min(m.used, m.limit);
  const limitMins = Math.floor(m.limit / 60);
  // Same unit on both sides reads as one phrase ("12 of 30 min").
  if (limitMins < 60) return `${Math.floor(used / 60)} of ${limitMins} min`;
  return `${fmtDuration(used)} of ${fmtDuration(m.limit)}`;
}

export function fmtQuestionsUsage(m: Meter): string {
  return `${Math.min(m.used, m.limit)} of ${m.limit}`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export function transcriptionLeft(m: Meter): string {
  return `${fmtDuration(Math.max(0, m.limit - m.used))} left`;
}

export function questionsLeft(m: Meter): string {
  return `${plural(Math.max(0, m.limit - m.used), 'question')} left`;
}

/** The reset happens at 00:00 UTC, so the date is read in UTC ("Nov 1"). */
export function fmtResetDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function fmtDate(iso?: string): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** "$19", "$6.40". */
export function fmtMoney(cents: number): string {
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}

/** Extra balance is only usable (and only shown) when there is some. */
export function hasExtraBalance(p: PlanState): boolean {
  return p.extraBalanceCents > 0;
}

/** Trial running: full Pro until `trialEndsAt`. */
export function isTrial(p: PlanState): boolean {
  return p.plan === 'pro' && p.status === 'trialing';
}

/** Trial is over and the user never subscribed: on Free, calling unchanged. */
export function isTrialEnded(p: PlanState): boolean {
  return p.plan === 'free' && p.status === 'trialing';
}

export type LimitKind = 'transcription' | 'questions';

/** True when this meter is used up and there is no extra balance to fall back on. */
export function isBlocked(p: PlanState, kind: LimitKind): boolean {
  return meterLevel(p[kind]) === 'out' && !hasExtraBalance(p);
}

/**
 * The status-bar chip: nothing until a meter is 80% used, then the tightest
 * meter's "X left". Null = show nothing.
 */
export function usageChip(p: PlanState): { label: string; level: MeterLevel; kind: LimitKind } | null {
  const t = meterLevel(p.transcription);
  const q = meterLevel(p.questions);
  if (t === 'ok' && q === 'ok') return null;
  // Past the allowance but still running on extra balance: nothing is about to stop.
  if (hasExtraBalance(p) && t !== 'low' && q !== 'low') return null;
  const tFrac = p.transcription.limit > 0 ? p.transcription.used / p.transcription.limit : 1;
  const qFrac = p.questions.limit > 0 ? p.questions.used / p.questions.limit : 1;
  return tFrac >= qFrac
    ? { label: transcriptionLeft(p.transcription), level: t, kind: 'transcription' }
    : { label: questionsLeft(p.questions), level: q, kind: 'questions' };
}

/** What to tell the user at a limit: what was used, and when it comes back. */
export function limitMessage(p: PlanState, kind: LimitKind): string {
  const reset = fmtResetDate(p.resetsAt);
  return kind === 'questions'
    ? `You’ve used all ${p.questions.limit} AI questions for this month. They reset on ${reset}.`
    : `You’ve used all ${fmtDuration(p.transcription.limit)} of transcription for this month. It resets on ${reset}.`;
}

/** Yearly price shown per month, and what it saves against 12 monthly payments. */
export function yearlyMath(prices: PlanState['prices']): { perMonthCents: number; savingCents: number } {
  return {
    perMonthCents: Math.round(prices.yearlyCents / 12),
    savingCents: Math.max(0, prices.monthlyCents * 12 - prices.yearlyCents),
  };
}

// ── Fetch + shared state ──────────────────────────────────────────────────────
// One copy per panel session, cached in storage for an instant first render.
// Components read it through usePlan(); anything that spends (a question, a
// call with transcription) calls refreshPlan() afterwards.

const CACHE_KEY = 'planState';

let current: PlanState | null = null;
const listeners = new Set<() => void>();

function publish(next: PlanState | null): void {
  current = next;
  listeners.forEach((fn) => fn());
}

export function getPlanSnapshot(): PlanState | null {
  return current;
}

export function subscribePlan(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function looksLikePlan(v: unknown): v is PlanState {
  const p = v as PlanState | undefined;
  return !!p && (p.plan === 'free' || p.plan === 'pro') && !!p.transcription && !!p.questions && !!p.prices;
}

/** Last-known state for an instant render; refreshPlan() replaces it. */
export async function loadCachedPlan(): Promise<void> {
  if (current) return;
  const got = await chrome.storage.local.get(CACHE_KEY);
  if (!current && looksLikePlan(got[CACHE_KEY])) publish(got[CACHE_KEY]);
}

/** Fetch the live plan + usage. Returns null (and keeps the last state) on failure. */
export async function refreshPlan(userId: string): Promise<PlanState | null> {
  try {
    const res = await fetch(`${BASE_URL}/api/plan/${userId}`, {
      headers: { Authorization: await authHeader(userId) },
    });
    if (!res.ok) return null;
    const data: unknown = await res.json();
    if (!looksLikePlan(data)) return null;
    await chrome.storage.local.set({ [CACHE_KEY]: data });
    publish(data);
    return data;
  } catch {
    return null;
  }
}
