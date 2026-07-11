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
        <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-600">Free trial started</p>
        <h2 className="mt-0.5 text-lg font-semibold text-gray-900">Everything in Pro, free for 7 days</h2>
        <ul className="mt-3 space-y-1.5 text-sm text-gray-600">
          <li>✓ Live call transcription — no setup</li>
          <li>✓ Claude connector — ask Claude about your calls</li>
          <li>✓ Auto-dialer — import a list, call through it</li>
          <li>✓ SMS, call recording &amp; cloud history</li>
        </ul>
        <p className="mt-3 text-xs text-gray-500">
          Calling with your own Twilio stays free forever — with or without Pro.
        </p>
        <button
          type="button"
          onClick={dismiss}
          className="mt-4 w-full rounded-md bg-brand-600 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          Start exploring
        </button>
      </div>
    </div>
  );
}
