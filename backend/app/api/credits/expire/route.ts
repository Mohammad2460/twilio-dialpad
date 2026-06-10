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
  const { data, error } = await supabase.rpc('expire_credits');
  if (error) {
    console.error('[credits/expire] failed', error);
    return NextResponse.json({ error: 'expire_failed' }, { status: 500 });
  }
  return NextResponse.json({ ok: true, expired: data ?? 0 });
}

export const GET = run;
export const POST = run;
