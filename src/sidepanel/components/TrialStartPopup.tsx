import { useEffect, useState } from 'react';

const SEEN_KEY = 'trialPopupSeen';

/** One-time popup surfacing the 7-day trial right after setup. Self-guards on storage. */
export function TrialStartPopup() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    chrome.storage.local.get(SEEN_KEY).then(({ trialPopupSeen }) => {
      if (!trialPopupSeen) setShow(true);
    });
  }, []);

  if (!show) return null;

  function dismiss() {
    void chrome.storage.local.set({ [SEEN_KEY]: true });
    setShow(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl">
        <h2 className="text-lg font-semibold text-gray-900">🎉 You&apos;re on a 7-day free trial</h2>
        <p className="mt-2 text-sm text-gray-600">
          Managed call transcription + AI call analysis are unlocked. Calling is always free.
        </p>
        <button
          type="button"
          onClick={dismiss}
          className="mt-4 w-full rounded-md bg-brand-600 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          Got it
        </button>
      </div>
    </div>
  );
}
