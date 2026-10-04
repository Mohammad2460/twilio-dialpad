import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const runtime = 'nodejs';

/**
 * POST/GET /api/credits/expire — scheduled job (Vercel cron) that zeroes
 * unspent grant/top-up credits past their expiry and writes 'expiry' ledger
 * rows. Idempotent (only acts on buckets still holding remaining > 0 past
 * expiry). Authenticated by the CRON_SECRET bearer (same as recordings/purge).
 */
async function run(req: NextRequest) {
  const auth = req.headers.get('Authorization') ?? '';
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { data: expired, error } = await supabase.rpc('expire_credits');
  if (error) {
    console.error('[credits/expire] expire failed', error);
    return NextResponse.json({ error: 'expire_failed' }, { status: 500 });
  }
  // Also reap reservations stuck 'pending' (instance died after reserve, before
  // settle/refund) so held credits are returned. Idempotent; threshold 30 min.
  const { data: reaped, error: reapErr } = await supabase.rpc('reap_stale_reservations', {
    p_minutes: 30,
  });
  if (reapErr) console.error('[credits/expire] reap failed (non-fatal)', reapErr);

  // Close allowance transcription windows that were never settled (counted in full).
  const { error: winErr } = await supabase.rpc('reap_transcribe_windows', { p_minutes: 30 });
  if (winErr) console.error('[credits/expire] window reap failed (non-fatal)', winErr.message);

  // Prune trial-cap rows past the 24h window (see lib/trial-cap.ts). Non-fatal.
  const { error: pruneErr } = await supabase
    .from('trial_transcribe_mints')
    .delete()
    .lt('minted_at', new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString());
  if (pruneErr) console.error('[credits/expire] trial-cap prune failed (non-fatal)', pruneErr.message);

  return NextResponse.json({ ok: true, expired: expired ?? 0, reaped: reaped ?? 0 });
}

export const GET = run;
export const POST = run;
