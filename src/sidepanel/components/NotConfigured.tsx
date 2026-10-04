import { useState } from 'react';
import { DemoTour } from './DemoTour';

/**
 * First screen before any Twilio details exist. Leads with the demo so a new
 * user sees what the product does before being asked for credentials.
 */
export function NotConfigured() {
  const [demo, setDemo] = useState(false);
  if (demo) return <DemoTour onExit={() => setDemo(false)} />;

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="border-b border-brand-100 bg-gradient-to-b from-brand-50 to-white px-5 pb-6 pt-8">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-700">Twilio Dialpad</p>
        <h1 className="mt-1.5 text-xl font-semibold leading-snug text-gray-900">
          Call from Chrome. Every call transcribed, summarized and searchable.
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-gray-600">
          See it work on a sample call first. It takes 30 seconds and needs no account.
        </p>
        <button
          type="button"
          onClick={() => setDemo(true)}
          className="mt-4 w-full rounded-md bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700"
        >
          Play the 30-second demo
        </button>
      </div>

      <div className="flex-1 px-5 py-5">
        <ul className="space-y-3">
          <Point title="Free, unlimited calling">You bring your own Twilio number and pay Twilio’s usual per-minute rate. No per-call fee from us.</Point>
          <Point title="Live transcript and AI notes">Summary, objections and promises after each call. Included on the free plan, with more on Pro.</Point>
          <Point title="7 days of Pro to start">No card. Afterwards you stay on Free and keep calling.</Point>
        </ul>
      </div>

      <div className="border-t border-gray-200 p-4">
        <button
          type="button"
          onClick={() => chrome.runtime.openOptionsPage()}
          className="w-full rounded-md border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
        >
          Set up with my Twilio account
        </button>
      </div>
    </div>
  );
}

function Point({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-600" aria-hidden="true" />
      <div>
        <p className="text-sm font-medium text-gray-900">{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-gray-600">{children}</p>
      </div>
    </li>
  );
}
