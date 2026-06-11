import { UpgradeSheet } from './UpgradeSheet';

/**
 * Dismissible overlay wrapping the UpgradeSheet upsell. Used when a free user
 * taps a Pro-locked affordance (e.g. a Claude model). UX only — the backend 402
 * remains the source of truth.
 */
export function UpgradeModal({
  open,
  onClose,
  onUpgrade,
  loading,
  error,
  ctaLabel = 'Start free trial — $9/mo',
}: {
  open: boolean;
  onClose: () => void;
  onUpgrade: () => void;
  loading?: boolean;
  error?: string | null;
  ctaLabel?: string;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="w-full max-h-[90%] overflow-y-auto rounded-t-2xl bg-white p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Unlock Claude models</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1 text-gray-400 hover:bg-gray-100"
            title="Close"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
        <UpgradeSheet onUpgrade={onUpgrade} loading={loading} error={error} ctaLabel={ctaLabel} />
      </div>
    </div>
  );
}
