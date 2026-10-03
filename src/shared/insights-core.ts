/**
 * Call insights — the pure half (no IO; see insights.ts for storage + network).
 *
 * An insight is the AI's structured notes for one call. Everything the user
 * sees without asking — the pre-call brief, Today, the promises list — is
 * derived from stored insights here, locally and deterministically. Only
 * creating an insight (and chat) ever calls the model.
 */
import { z } from 'zod';
import { formatTranscriptText, localDate, type CallEntry } from './ai-context';
import type { CallDirection, CallInsight, CallPromise, InsightAttempt, Transcript } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Undated promises I made stay on Today this long after the call. */
const FRESH_PROMISE_MS = 3 * DAY_MS;
/** Missed calls older than this are no longer "call back" candidates. */
const MISSED_WINDOW_MS = 7 * DAY_MS;
/** Request-size guard: ~45k tokens, under the backend's per-request cap. */
const MAX_TRANSCRIPT_CHARS = 180_000;
/** Below this there is no conversation worth summarising (voicemail, no answer). */
const MIN_TRANSCRIPT_CHARS = 200;

// ── Numbers ──────────────────────────────────────────────────────

/** Comparable key for a phone number: its last 10 digits. Null when unusable. */
function numberKey(n: string): string | null {
  const digits = n.replace(/\D/g, '');
  return digits.length >= 7 ? digits.slice(-10) : null;
}

/** Same phone number, tolerant of formatting and a missing country code. */
export function sameNumber(a: string, b: string): boolean {
  const ka = numberKey(a);
  return ka !== null && ka === numberKey(b);
}

// ── Insight payloads ─────────────────────────────────────────────

const WireInsightSchema = z.object({
  summary: z.string().trim().min(1),
  objections: z.array(z.string()),
  promises: z.array(
    z.object({
      text: z.string().trim().min(1),
      who: z.enum(['me', 'them']),
      due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      ts: z.number().nonnegative().optional(),
    }),
  ),
  nextStep: z.string().optional(),
});

/** Validate the backend's insight payload and turn it into a stored CallInsight. */
export function normalizeInsight(raw: unknown, model: string, now: number): CallInsight | null {
  const parsed = WireInsightSchema.safeParse(raw);
  if (!parsed.success) return null;
  const { summary, objections, promises, nextStep } = parsed.data;
  return {
    summary,
    objections: objections.map((o) => o.trim()).filter(Boolean),
    promises: promises.map((p, i) => ({
      id: `p${i + 1}`,
      text: p.text,
      who: p.who,
      ...(p.due ? { due: p.due } : {}),
      ...(p.ts !== undefined ? { ts: p.ts } : {}),
    })),
    ...(nextStep?.trim() ? { nextStep: nextStep.trim() } : {}),
    model,
    createdAt: now,
    v: 1,
  };
}

/** True when the transcript holds an actual two-way conversation. */
export function isSummarizable(t: Transcript): boolean {
  const finals = t.segments.filter((s) => s.isFinal);
  const chars = finals.reduce((n, s) => n + s.text.length, 0);
  const bothSpoke = finals.some((s) => s.speaker === 'user') && finals.some((s) => s.speaker === 'remote');
  return bothSpoke && chars >= MIN_TRANSCRIPT_CHARS;
}

/** Automatic requests per call, counting only ones that ended before the model ran. */
export const MAX_AUTO_ATTEMPTS = 3;

/**
 * May this call be summarised without the user asking? Not once it has notes,
 * and not after a request whose outcome is unknown or whose output was unusable
 * — those may already have been charged, so only the user can ask again.
 */
export function canAutoSummarize(t: Pick<Transcript, 'insight' | 'insightAttempt'>): boolean {
  if (t.insight) return false;
  const a = t.insightAttempt;
  return !a || (a.state === 'retry' && a.n < MAX_AUTO_ATTEMPTS);
}

/**
 * The marker to keep after a request that produced no notes. `claimed` is the
 * pending marker written before the request; `previous` is what it replaced.
 */
export function attemptAfterFailure(
  claimed: InsightAttempt,
  previous: InsightAttempt | undefined,
  res: { status: number; error: string },
): InsightAttempt | undefined {
  // Refused before any work (signed out, no credits): does not count as a try.
  if (res.status === 401 || res.status === 402) return previous;
  if (res.error === 'bad_output') return { ...claimed, state: 'failed' };
  return { ...claimed, state: 'retry' };
}

export interface InsightRequestBody {
  transcript: string;
  callDate: string;
  direction: CallDirection;
  contactName?: string;
}

export function insightRequestBody(t: Transcript): InsightRequestBody {
  return {
    transcript: formatTranscriptText(t.segments, { timestamps: true }).slice(0, MAX_TRANSCRIPT_CHARS),
    callDate: localDate(t.startedAt),
    direction: t.direction,
    ...(t.contactSnapshot?.name ? { contactName: t.contactSnapshot.name } : {}),
  };
}

// ── Derived views ────────────────────────────────────────────────

/** A promise together with the call it was made on. */
export interface PromiseItem {
  callSid: string;
  number: string;
  contactName?: string;
  callStartedAt: number;
  promise: CallPromise;
}

/** Dated promises first (soonest due), then undated (newest call first). */
function byUrgency(a: PromiseItem, b: PromiseItem): number {
  if (a.promise.due && b.promise.due) return a.promise.due.localeCompare(b.promise.due);
  if (a.promise.due) return -1;
  if (b.promise.due) return 1;
  return b.callStartedAt - a.callStartedAt;
}

export function collectPromises(
  calls: CallEntry[],
  opts: { includeDone?: boolean } = {},
): PromiseItem[] {
  const items: PromiseItem[] = [];
  for (const c of calls) {
    if (!c.sid || !c.insight) continue;
    for (const promise of c.insight.promises) {
      if (promise.done && !opts.includeDone) continue;
      items.push({
        callSid: c.sid,
        number: c.number,
        contactName: c.contactName,
        callStartedAt: c.startedAt,
        promise,
      });
    }
  }
  return items.sort(byUrgency);
}

export interface MissedItem {
  number: string;
  contactName?: string;
  lastMissedAt: number;
  count: number;
}

export interface TodayBrief {
  /** Open promises that need attention now. */
  due: PromiseItem[];
  /** Missed incoming calls nobody has called back. */
  missed: MissedItem[];
}

export function todayBrief(calls: CallEntry[], now: number): TodayBrief {
  const today = localDate(now);
  const due = collectPromises(calls).filter(({ promise, callStartedAt }) =>
    promise.due
      ? promise.due <= today
      : promise.who === 'me' && now - callStartedAt <= FRESH_PROMISE_MS,
  );

  const missedByNumber = new Map<string, MissedItem>();
  for (const c of calls) {
    if (c.direction !== 'in' || c.status !== 'missed') continue;
    if (now - c.startedAt > MISSED_WINDOW_MS) continue;
    const key = numberKey(c.number);
    if (!key) continue;
    const seen = missedByNumber.get(key);
    if (!seen) {
      missedByNumber.set(key, {
        number: c.number,
        contactName: c.contactName,
        lastMissedAt: c.startedAt,
        count: 1,
      });
    } else {
      seen.count += 1;
      if (c.startedAt > seen.lastMissedAt) seen.lastMissedAt = c.startedAt;
      seen.contactName = seen.contactName ?? c.contactName;
    }
  }

  const missed = [...missedByNumber.values()]
    .filter(
      (m) =>
        !calls.some(
          (c) =>
            c.startedAt > m.lastMissedAt &&
            (c.direction === 'out' || c.status === 'completed') &&
            sameNumber(c.number, m.number),
        ),
    )
    .sort((a, b) => b.lastMissedAt - a.lastMissedAt);

  return { due, missed };
}

/** What we know about a number before dialing / answering it. */
export interface NumberBrief {
  callCount: number;
  lastCallAt: number;
  contactName?: string;
  /** From the most recent call that has notes. */
  summary?: string;
  summaryAt?: number;
  objections: string[];
  openPromises: PromiseItem[];
  /** Call to open for the full story. */
  detailSid?: string;
}

export function briefForNumber(number: string, calls: CallEntry[]): NumberBrief | null {
  const matching = calls.filter((c) => sameNumber(c.number, number));
  if (matching.length === 0) return null;
  const withNotes = matching.find((c) => c.insight);
  return {
    callCount: matching.length,
    lastCallAt: matching[0].startedAt,
    contactName: matching.find((c) => c.contactName)?.contactName,
    summary: withNotes?.insight?.summary,
    summaryAt: withNotes?.startedAt,
    objections: withNotes?.insight?.objections ?? [],
    openPromises: collectPromises(matching),
    detailSid: withNotes?.sid ?? matching.find((c) => c.sid)?.sid,
  };
}
