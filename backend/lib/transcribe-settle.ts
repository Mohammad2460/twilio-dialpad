/**
 * Settle one managed-transcription window. Shared by /api/transcribe/token
 * (settles the previous window) and /api/transcribe/settle (the final one).
 *
 * The request id and seconds arrive from the client, so both are checked
 * against the ledger row before anything is settled — see transcribe-metering.ts.
 */
import { supabase } from './supabase';
import { settle, type PricingConfig } from './credits';
import {
  billableSeconds,
  isUuid,
  settleableModel,
  windowCharge,
  type ReservationRow,
} from './transcribe-metering';

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
