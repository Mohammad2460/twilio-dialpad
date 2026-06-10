import { useEffect, useState } from 'react';
import { ensureCloudAccount } from '@shared/cloud';
import { getCreditBalance, getCachedCreditState } from '@shared/credits';

/**
 * Small managed-AI credit balance chip for the Pro tab / status bar (P8.6).
 * Renders the cached balance instantly, then refreshes from the backend.
 * `onTopUp` (optional) wires the "Top up" affordance to the checkout flow.
 */
export function CreditBalance({ onTopUp }: { onTopUp?: () => void }) {
  const [balance, setBalance] = useState<number | null>(null);
  const lowThreshold = 50;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cached = await getCachedCreditState();
      if (!cancelled && cached) setBalance(cached.balance);
      try {
        const acct = await ensureCloudAccount();
        const state = await getCreditBalance(acct.userId);
        if (!cancelled) setBalance(state.balance);
      } catch {
        /* not registered */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (balance === null) return null;
  const low = balance <= lowThreshold;

  return (
    <div className="flex items-center justify-between text-sm px-3 py-2 rounded-lg bg-gray-50 border border-gray-200">
      <span className="text-gray-600">AI credits</span>
      <div className="flex items-center gap-2">
        <span className={low ? 'text-amber-700 font-medium' : 'text-gray-900 font-medium'}>
          {balance}
        </span>
        {onTopUp && (
          <button onClick={onTopUp} className="text-xs text-blue-600 hover:underline">
            Top up
          </button>
        )}
      </div>
    </div>
  );
}
