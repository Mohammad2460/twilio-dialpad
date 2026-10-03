/**
 * Managed-transcription metering rules — pure (no DB import), so they are
 * unit-testable. The DB-touching settle lives in transcribe-settle.ts.
 *
 * The backend never sees the audio stream, so a window is billed from what the
 * backend itself knows: who reserved it, which model it was reserved for, and
 * how long ago. The client's reported seconds can only raise the bill within
 * the window, never lower it below the server's own clock.
 */
import { costFromDeepgramMinutes, usdToCredits, type PricingConfig } from './pricing';

/** One metering window. The client reconnects (with a fresh token) each window,
 *  so a zero-balance user gets no next token and transcription stops. Short
 *  enough to bound abuse, long enough that reconnects are infrequent. */
export const WINDOW_SECONDS = 120;

/** Slack between the reservation and the client's own window clock (mint
 *  latency, socket teardown, request travel) so an honest client is not billed
 *  for time it did not stream. */
export const SETTLE_GRACE_SECONDS = 5;

/** Reservations made by /api/transcribe/token carry this model prefix. */
export const TRANSCRIBE_MODEL_PREFIX = 'deepgram:';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}

/** The ledger columns a settle decision needs. */
export interface ReservationRow {
  user_id: string;
  model: string | null;
  status: string | null;
  credits_delta: number;
  created_at: string;
}

/**
 * The Deepgram model a reservation was made for, when `userId` may settle it:
 * it must be their own, still pending, and a transcription window. Otherwise null.
 */
export function settleableModel(row: ReservationRow | null | undefined, userId: string): string | null {
  if (!row || row.user_id !== userId || row.status !== 'pending') return null;
  if (typeof row.model !== 'string' || !row.model.startsWith(TRANSCRIBE_MODEL_PREFIX)) return null;
  return row.model.slice(TRANSCRIBE_MODEL_PREFIX.length) || null;
}

/**
 * Seconds to bill for a window: the larger of what the client reported and the
 * time since the reservation (less the grace), capped at the window length.
 * An unreadable clock bills the whole window.
 */
export function billableSeconds(
  reported: unknown,
  elapsedMs: number,
  windowSeconds = WINDOW_SECONDS,
  graceSeconds = SETTLE_GRACE_SECONDS,
): number {
  const claimed = typeof reported === 'number' && Number.isFinite(reported) && reported > 0 ? reported : 0;
  const elapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs / 1000 - graceSeconds) : windowSeconds;
  return Math.min(windowSeconds, Math.max(claimed, elapsed));
}

/**
 * Credits + vendor USD for `seconds` of a window reserved at `reserved` credits.
 * Never more than the hold; zero seconds is free; a model that has left the
 * pricing config keeps the whole hold.
 */
export function windowCharge(
  seconds: number,
  model: string,
  reserved: number,
  p: PricingConfig,
): { credits: number; usd: number | null } {
  const hold = Math.max(0, reserved);
  if (!p.deepgram[model]) return { credits: hold, usd: null };
  const usd = costFromDeepgramMinutes(seconds / 60, model, p);
  if (seconds <= 0) return { credits: 0, usd };
  return { credits: Math.min(hold, usdToCredits(usd, p)), usd };
}
