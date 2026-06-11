import { useState } from 'react';
import { getCheckoutUrl } from '@shared/cloud';

interface Props {
  userId: string;
  daysLeft: number;
}

/** Shown in the last 3 days of trial. Upgrade → Dodo checkout. */
export function TrialBanner({ userId, daysLeft }: Props) {
  const [loading, setLoading] = useState(false);

  async function upgrade() {
    setLoading(true);
    try {
      const url = await getCheckoutUrl(userId);
      window.open(url, '_blank', 'noopener');
    } catch {
      /* non-fatal; user can retry */
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center justify-between gap-2 bg-amber-50 px-3 py-2 text-xs text-amber-900">
      <span>
        Trial ends in {daysLeft} day{daysLeft === 1 ? '' : 's'} — upgrade to keep transcription and unlock
        Claude, SMS &amp; recording.
      </span>
      <button
        type="button"
        onClick={() => void upgrade()}
        disabled={loading}
        className="shrink-0 rounded-md bg-amber-600 px-3 py-1 font-medium text-white hover:bg-amber-700 disabled:opacity-60"
      >
        {loading ? '…' : 'Upgrade'}
      </button>
    </div>
  );
}
