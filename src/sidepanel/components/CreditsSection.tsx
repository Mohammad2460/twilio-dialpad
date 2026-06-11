import { useEffect, useState } from 'react';
import { ensureCloudAccount } from '@shared/cloud';
import {
  getCreditBalance,
  getCachedCreditState,
  startTopUp,
  TOPUP_PACKS,
} from '@shared/credits';

/**
 * Managed-AI credits panel for the Pro tab (P8.6): live balance + one-tap
 * top-up packs. Self-contained — resolves the account and balance itself.
 */
export function CreditsSection() {
  const [userId, setUserId] = useState<string | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cached = await getCachedCreditState();
      if (!cancelled && cached) setBalance(cached.balance);
      try {
        const acct = await ensureCloudAccount();
        if (cancelled) return;
        setUserId(acct.userId);
        const state = await getCreditBalance(acct.userId);
        if (!cancelled) setBalance(state.balance);
      } catch {
        /* not registered — hide */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!userId) return null;

  async function topUp(credits: number) {
    if (!userId || busy) return;
    setBusy(credits);
    try {
      await startTopUp(userId, credits);
    } finally {
      setBusy(null);
    }
  }

  const low = balance !== null && balance <= 50;

  return (
    <section className="rounded-lg border border-gray-200 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900">AI credits</h2>
        <span className={`text-sm font-medium ${low ? 'text-amber-700' : 'text-gray-900'}`}>
          {balance === null ? '—' : `${balance} cr`}
        </span>
      </div>
      <p className="text-[11px] text-gray-500">
        Power the in-call AI chatbox. 1 credit = $0.01. Haiku is cheapest; Sonnet & Opus cost more.
      </p>
      <div className="grid grid-cols-3 gap-2">
        {TOPUP_PACKS.map((credits) => (
          <button
            key={credits}
            onClick={() => topUp(credits)}
            disabled={busy !== null}
            className="rounded-md border border-blue-200 bg-blue-50 px-2 py-2 text-center disabled:opacity-50"
          >
            <span className="block text-sm font-semibold text-blue-800">{credits}</span>
            <span className="block text-[11px] text-blue-600">${credits / 100}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
