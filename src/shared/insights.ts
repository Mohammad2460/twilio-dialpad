/**
 * Call insights — storage + network (the pure half lives in insights-core.ts).
 *
 * Runs in the side panel. Summaries are created in the background after a
 * transcribed call and backfilled when the panel opens; both are best-effort
 * and must never surface an error into the call flow.
 */
import { requestInsight } from './credits';
import {
  attemptAfterFailure,
  canAutoSummarize,
  insightRequestBody,
  isSummarizable,
  normalizeInsight,
} from './insights-core';
import { storage } from './storage';
import { transcripts } from './transcripts';
import type { InsightAttempt, Settings, Transcript } from './types';

export type SummarizeStatus =
  | 'ok'
  /** Insight already there, already requested, or nothing worth summarising. */
  | 'skipped'
  | 'not_signed_in'
  | 'no_credits'
  | 'failed';

/** Auto-summary is on unless the user turned it off. */
export function autoSummaryEnabled(settings: Settings | null | undefined): boolean {
  return settings?.aiAutoSummary !== false;
}

// ── First-run notice ─────────────────────────────────────────────
// Nothing is sent automatically until the user has seen what the assistant
// sends and where. Asking a question or pressing "Summarize" is its own consent.

const NOTICE_KEY = 'aiNoticeSeen';

export async function aiNoticeAcknowledged(): Promise<boolean> {
  try {
    const got = await chrome.storage.local.get(NOTICE_KEY);
    return !!got[NOTICE_KEY];
  } catch {
    return false;
  }
}

export async function acknowledgeAiNotice(): Promise<void> {
  await chrome.storage.local.set({ [NOTICE_KEY]: true });
}

/** Automatic summaries need the setting on AND the notice acknowledged. */
export async function autoSummaryAllowed(settings: Settings | null | undefined): Promise<boolean> {
  return autoSummaryEnabled(settings) && (await aiNoticeAcknowledged());
}

// ── Change notifications (same-document; the side panel is the only writer) ──

const listeners = new Set<() => void>();

/** Subscribe to insight writes (new summary, promise checked off). Returns unsubscribe. */
export function onInsightChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function notify(): void {
  for (const cb of listeners) cb();
}

// ── Summarise ────────────────────────────────────────────────────

/** Calls being summarised right now — one request per call, however many triggers fire. */
const inFlight = new Map<string, Promise<SummarizeStatus>>();

async function cloudUserId(): Promise<string | null> {
  const { cloudUserId: id } = await chrome.storage.local.get('cloudUserId');
  return typeof id === 'string' ? id : null;
}

function setAttempt(callSid: string, attempt: InsightAttempt | undefined): Promise<Transcript | null> {
  return transcripts.update(callSid, ({ insightAttempt: _old, ...cur }) =>
    attempt ? { ...cur, insightAttempt: attempt } : cur,
  );
}

async function run(callSid: string, force: boolean): Promise<SummarizeStatus> {
  const t = await transcripts.get(callSid);
  if (!t) return 'skipped';
  if (t.insight && !force) return 'skipped';
  if (!isSummarizable(t)) return 'skipped';

  const userId = await cloudUserId();
  if (!userId) return 'not_signed_in';

  // Claim the call before asking. The check and the marker are one IndexedDB
  // transaction, so two windows (or a reopened panel) cannot both request it,
  // and a request whose answer never arrived is not repeated automatically.
  let claimed: InsightAttempt | null = null;
  let previous: InsightAttempt | undefined;
  await transcripts.update(callSid, (cur) => {
    if (!force && !canAutoSummarize(cur)) return cur;
    previous = cur.insightAttempt;
    claimed = { at: Date.now(), n: (previous?.n ?? 0) + 1, state: 'pending' };
    return { ...cur, insightAttempt: claimed };
  });
  if (!claimed) return 'skipped';

  const res = await requestInsight(userId, insightRequestBody(t));
  if (!res.ok) {
    await setAttempt(callSid, attemptAfterFailure(claimed, previous, res));
    return res.status === 402 ? 'no_credits' : 'failed';
  }

  const insight = normalizeInsight(res.insight, res.model, Date.now());
  if (!insight) {
    await setAttempt(callSid, { ...(claimed as InsightAttempt), state: 'failed' });
    return 'failed';
  }

  const stored = await transcripts.update(callSid, ({ insightAttempt: _done, ...cur }) => ({
    ...cur,
    insight,
  }));
  if (!stored) return 'skipped'; // transcript deleted while we were waiting
  notify();
  return 'ok';
}

/**
 * Create the insight for one call. Never throws. Without `force` this is an
 * automatic request: it is skipped when the call was already requested (see
 * canAutoSummarize). `force` is the user asking explicitly.
 * Does not check the auto-summary setting — callers decide whether to trigger.
 */
export function summarizeCall(callSid: string, opts: { force?: boolean } = {}): Promise<SummarizeStatus> {
  const pending = inFlight.get(callSid);
  if (pending) return pending;
  const p = run(callSid, !!opts.force)
    .catch((e): SummarizeStatus => {
      console.warn('[insights] summarize failed', e);
      return 'failed';
    })
    .finally(() => inFlight.delete(callSid));
  inFlight.set(callSid, p);
  return p;
}

/** Calls already tried this panel session — at most one automatic try per call per session. */
const attempted = new Set<string>();
const BACKFILL_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Summarise recent transcribed calls that were never requested (e.g. the panel
 * closed before the request went out). Sequential, capped, and stops at the
 * first credit/sign-in problem so it cannot hammer the backend.
 */
export async function backfillInsights(limit = 5): Promise<void> {
  let recent: Transcript[];
  try {
    recent = await transcripts.list(40);
  } catch {
    return;
  }
  const cutoff = Date.now() - BACKFILL_MAX_AGE_MS;
  const todo = recent
    .filter(
      (t) => canAutoSummarize(t) && t.startedAt >= cutoff && !attempted.has(t.callSid) && isSummarizable(t),
    )
    .slice(0, limit);

  for (const t of todo) {
    attempted.add(t.callSid);
    const status = await summarizeCall(t.callSid);
    if (status === 'no_credits' || status === 'not_signed_in') return;
  }
}

/** Backfill when automatic summaries are allowed. Never throws. */
export async function autoBackfill(): Promise<void> {
  try {
    const settings = await storage.getSettings();
    if (settings && (await autoSummaryAllowed(settings))) await backfillInsights();
  } catch (e) {
    console.warn('[insights] backfill failed', e);
  }
}

// ── Promises ─────────────────────────────────────────────────────

/** Tick / untick one promise. The user's own checklist — nothing leaves the device. */
export async function setPromiseDone(callSid: string, promiseId: string, done: boolean): Promise<void> {
  await transcripts.update(callSid, (t) =>
    t.insight
      ? {
          ...t,
          insight: {
            ...t.insight,
            promises: t.insight.promises.map((p) => (p.id === promiseId ? { ...p, done } : p)),
          },
        }
      : t,
  );
  notify();
}
