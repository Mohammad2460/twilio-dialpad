/** Presentational upgrade CTA block — used inside ProTab. */
export function UpgradeSheet({
  onUpgrade,
  loading,
  error,
  ctaLabel = 'Start free trial',
  disabled,
  disabledNote,
}: {
  onUpgrade: () => void;
  loading?: boolean;
  error?: string | null;
  ctaLabel?: string;
  disabled?: boolean;
  disabledNote?: string;
}) {
  return (
    <div className="rounded-lg border border-brand-200 bg-brand-50 p-4 space-y-4">
      <div>
        <h2 className="text-base font-semibold text-gray-900 leading-snug">
          Turn Chrome into your Twilio sales dialer
        </h2>
        <p className="mt-1 text-xs text-gray-500">
          Everything an SDR needs — no separate dialers, no IT tickets.
        </p>
      </div>

      <ul className="space-y-2">
        {BENEFITS.map((b) => (
          <li key={b} className="flex items-start gap-2 text-sm text-gray-700">
            <span className="mt-0.5 text-green-500 shrink-0">✓</span>
            <span>{b}</span>
          </li>
        ))}
      </ul>

      <div className="rounded-md bg-white border border-gray-200 px-3 py-2 text-xs text-gray-600">
        <span className="font-medium text-gray-900">vs. JustCall / Aircall:</span> your company
        pays $30–40/user. Same calls + AI coaching for{' '}
        <span className="font-semibold text-gray-900">$9</span> — out of your own pocket if you
        have to.
      </div>

      <div>
        <p className="mb-2 text-sm font-semibold text-gray-900">
          $9 / month · 7-day free trial
        </p>

        <button
          type="button"
          onClick={onUpgrade}
          disabled={loading ?? disabled}
          className={[
            'w-full rounded-md px-4 py-2 text-sm font-semibold text-white transition',
            loading || disabled
              ? 'bg-brand-400 cursor-not-allowed'
              : 'bg-brand-600 hover:bg-brand-700',
          ].join(' ')}
        >
          {loading ? 'Opening checkout…' : ctaLabel}
        </button>

        {disabledNote && !error && (
          <p className="mt-1.5 text-xs text-gray-500">{disabledNote}</p>
        )}

        {error && (
          <p className="mt-1.5 text-xs text-red-600 break-all">{error}</p>
        )}
      </div>
    </div>
  );
}

const BENEFITS = [
  'Hit your 80-call daily target',
  'Know exactly why you\'re not booking meetings (Claude AI analysis)',
  'Never lose a prospect\'s words (cloud history)',
  'Text prospects (SMS)',
  'Replay your best calls (recording)',
];
