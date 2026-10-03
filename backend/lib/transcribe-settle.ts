/**
 * Ledger access for managed-transcription windows: settling one (shared by
 * /api/transcribe/token for the previous window and /api/transcribe/settle for
 * the final one) and finding the window a client retry should reuse.
 *
 * The request id, seconds and window label arrive from the client, so each is
 * checked against the caller's own ledger rows — see transcribe-metering.ts.
 */
import { supabase } from './supabase';
import { settle, type PricingConfig } from './credits';
import { reservationKeyPrefix } from './reservation-key';
import {
  billableSeconds,
  isUuid,
  reusableWindow,
  settleableModel,
  windowCharge,
  RETRY_REUSE_SECONDS,
  TRANSCRIBE_MODEL_PREFIX,
  type PendingWindowRow,
  type ReservationRow,
} from './transcribe-metering';

/** Ledger key scope for transcription windows. */
export const TRANSCRIBE_KEY_SCOPE = 'transcribe';

/**
 * The caller's own just-reserved, still-pending window for this window label and
 * model, if there is one (a retry of a failed open). Null → reserve a new window.
 */
export async function findRetryWindow(
  userId: string,
  windowKey: unknown,
  model: string,
): Promise<string | null> {
  const prefix = reservationKeyPrefix(TRANSCRIBE_KEY_SCOPE, windowKey);
  if (!prefix) return null;

  const now = Date.now();
  const { data, error } = await supabase
    .from('credit_ledger')
    .select('request_id, idempotency_key, created_at')
    .eq('user_id', userId)
    .eq('kind', 'reservation')
    .eq('status', 'pending')
    .eq('model', `${TRANSCRIBE_MODEL_PREFIX}${model}`)
    .gte('created_at', new Date(now - RETRY_REUSE_SECONDS * 1000).toISOString())
    .order('created_at', { ascending: false })
    .limit(10);
  if (error) throw new Error(`retry window lookup failed: ${error.message}`);

  return reusableWindow(data as PendingWindowRow[] | null, prefix, now);
}

/**
 * Returns the new balance when the window was settled, or null when there was
 * nothing this user may settle (unknown id, someone else's, already settled).
 */
export async function settleWindow(
  userId: string,
  requestId: unknown,
  reportedSeconds: unknown,
  pricing: PricingConfig,
): Promise<number | null> {
  if (!isUuid(requestId)) return null;

  const { data, error } = await supabase
    .from('credit_ledger')
    .select('user_id, model, status, credits_delta, created_at')
    .eq('request_id', requestId)
    .eq('kind', 'reservation')
    .maybeSingle();
  if (error) throw new Error(`reservation lookup failed: ${error.message}`);

  const row = data as ReservationRow | null;
  const model = settleableModel(row, userId);
  if (!row || !model) return null;

  const seconds = billableSeconds(reportedSeconds, Date.now() - Date.parse(row.created_at));
  const { credits, usd } = windowCharge(seconds, model, -row.credits_delta, pricing);
  return settle(requestId, credits, usd, model);
}
