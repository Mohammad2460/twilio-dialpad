import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { takeTrialMint, trialMintsPerDay } from '../lib/trial-cap';

/** Minimal stand-in for the two supabase-js chains takeTrialMint uses. */
function fakeDb(opts: { count?: number; countError?: string; insertError?: string }) {
  const insert = vi.fn(async () => ({ error: opts.insertError ? { message: opts.insertError } : null }));
  const countChain = {
    eq: () => countChain,
    gte: async () => ({
      count: opts.count ?? 0,
      error: opts.countError ? { message: opts.countError } : null,
    }),
  };
  const db = { from: () => ({ select: () => countChain, insert }) } as unknown as SupabaseClient;
  return { db, insert };
}

describe('trial transcription cap', () => {
  it('allows and records a mint under the cap', async () => {
    const { db, insert } = fakeDb({ count: 5 });
    expect(await takeTrialMint(db, 'u1', 120)).toBe(true);
    expect(insert).toHaveBeenCalledWith({ user_id: 'u1' });
  });

  it('refuses at the cap without recording', async () => {
    const { db, insert } = fakeDb({ count: 120 });
    expect(await takeTrialMint(db, 'u1', 120)).toBe(false);
    expect(insert).not.toHaveBeenCalled();
  });

  it('fails open when the count query errors (e.g. table not migrated yet)', async () => {
    const { db } = fakeDb({ countError: 'relation "trial_transcribe_mints" does not exist' });
    expect(await takeTrialMint(db, 'u1', 120)).toBe(true);
  });

  it('reads the cap from env, falling back to 120 on junk', () => {
    expect(trialMintsPerDay({ TRIAL_TRANSCRIBE_MINTS_PER_DAY: '60' })).toBe(60);
    expect(trialMintsPerDay({ TRIAL_TRANSCRIBE_MINTS_PER_DAY: 'abc' })).toBe(120);
    expect(trialMintsPerDay({})).toBe(120);
  });
});
