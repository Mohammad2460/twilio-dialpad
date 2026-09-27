/**
 * Daily cap on free managed-transcription tokens during the trial.
 *
 * Trial transcription is free (no credit reserve), and a Twilio trial account
 * costs nothing to create — so without a cap one registered device could mint
 * Deepgram tokens without limit on our key. Each token covers one metering
 * window (the client reconnects per window), so capping mints per rolling 24h
 * caps trial minutes. Default 120 mints × 2-min windows ≈ 4h/day.
 *
 * Fails OPEN if the table is missing or the DB errors: a cap outage must never
 * stop a legitimate trial user's transcription.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

const DEFAULT_MINTS_PER_DAY = 120;

export function trialMintsPerDay(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.TRIAL_TRANSCRIBE_MINTS_PER_DAY);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_MINTS_PER_DAY;
}

/** True when the user may mint another trial token; records the mint if so. */
export async function takeTrialMint(db: SupabaseClient, userId: string, cap = trialMintsPerDay()): Promise<boolean> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count, error } = await db
    .from('trial_transcribe_mints')
    .select('user_id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('minted_at', since);
  if (error) {
    console.error('[trial-cap] count failed — failing open', error.message);
    return true;
  }
  if ((count ?? 0) >= cap) return false;
  const { error: insErr } = await db.from('trial_transcribe_mints').insert({ user_id: userId });
  if (insErr) console.error('[trial-cap] record failed — failing open', insErr.message);
  return true;
}
