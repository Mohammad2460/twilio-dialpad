import { useEffect, useState } from 'react';
import { useCallStore } from '../stores/call-store';
import { getManager } from '../hooks/use-device';
import { IncomingToggle } from './IncomingToggle';
import { useMicPermission } from '../hooks/use-mic-permission';
import { isTrial, isTrialEnded, usageChip, fmtMoney } from '@shared/plan';
import { usePlan } from '../hooks/use-plan';

const STATE_META: Record<string, { text: string; color: string }> = {
  uninitialized: { text: 'Not initialized', color: 'bg-gray-200 text-gray-600' },
  initializing:  { text: 'Connecting…',    color: 'bg-amber-100 text-amber-800' },
  registered:    { text: 'Ready',           color: 'bg-green-100 text-green-800' },
  offline:       { text: 'Offline',         color: 'bg-red-100 text-red-800' },
  error:         { text: 'Error',           color: 'bg-red-100 text-red-800' },
};

export function StatusBar() {
  const deviceState = useCallStore((s) => s.deviceState);
  const deviceError = useCallStore((s) => s.deviceError);
  const settings = useCallStore((s) => s.settings);
  const meta = STATE_META[deviceState] ?? STATE_META.uninitialized;
  const needsRetry = deviceState === 'uninitialized' || deviceState === 'offline' || deviceState === 'error';
  const cloudBlocked = useCloudSyncBlocked();
  const plan = usePlan();
  const trialDays = plan && isTrial(plan) ? (plan.trialDaysLeft ?? 0) : null;
  const trialEndedSeen = useStoredFlag('trialEndedSeen');
  const setView = useCallStore((s) => s.setView);
  const micPerm = useMicPermission();
  const micNeedsGrant = micPerm === 'prompt' || micPerm === 'denied';

  function retryInit() {
    const s = useCallStore.getState().settings;
    if (!s) { chrome.runtime.openOptionsPage(); return; }
    getManager().init(s).catch((e) => console.error('[sidepanel] retryInit failed', e));
  }

  return (
    <div>
      <header className="flex items-center justify-between gap-2 border-b border-gray-200 bg-white px-3 py-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={['inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium shrink-0', meta.color].join(' ')}>
            <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
            {meta.text}
          </span>
          {settings && (
            <span className="text-xs text-gray-400 font-mono truncate">{settings.clientIdentity}</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <IncomingToggle />
          {needsRetry && (
            <button
              type="button"
              onClick={retryInit}
              title="Reconnect device"
              className="rounded px-2 py-1 text-xs bg-brand-50 text-brand-700 hover:bg-brand-100 border border-brand-200"
            >
              ↺ Connect
            </button>
          )}
          <UsageChip />
        </div>
      </header>

      {/* Mic banner — gated on REAL mic permission, not device state. Once granted
          it never reappears; transient connecting/offline states don't trigger it. */}
      {micNeedsGrant && settings && (
        <div className="bg-amber-50 px-3 py-2 text-xs text-amber-800 border-b border-amber-100 flex items-center justify-between gap-2">
          <span>{micPerm === 'denied' ? 'Microphone blocked — fix to make calls.' : 'Allow microphone to make calls.'}</span>
          <button
            type="button"
            onClick={() => chrome.runtime.openOptionsPage()}
            className="shrink-0 rounded bg-amber-600 px-2 py-1 text-white text-xs hover:bg-amber-700"
          >
            Grant mic →
          </button>
        </div>
      )}

      {deviceError && (
        <div className="bg-red-50 px-3 py-1.5 text-xs text-red-700 border-b border-red-100 break-all">
          {deviceError}
        </div>
      )}

      {/* Subscription gate — backend returned 402 on the last cloud sync.
          Calls still work locally; only cloud sync + Claude MCP are paused. */}
      {cloudBlocked && (
        <div className="bg-amber-50 px-3 py-2 text-xs text-amber-900 border-b border-amber-100 flex items-center justify-between gap-2">
          <span>⚠ Cloud sync + Claude MCP paused — subscription expired.</span>
          <button
            type="button"
            onClick={() => chrome.runtime.openOptionsPage()}
            className="shrink-0 rounded bg-amber-600 px-2 py-1 text-white text-xs hover:bg-amber-700"
          >
            Upgrade
          </button>
        </div>
      )}

      {/* Trial countdown — one quiet line; the last two days say what happens next. */}
      {plan && trialDays !== null && (
        <div className="flex items-center justify-between gap-2 border-b border-brand-100 bg-brand-50 px-3 py-1.5">
          <button
            type="button"
            onClick={() => setView('pro')}
            className="text-left text-xs text-brand-700 hover:text-brand-800 hover:underline"
          >
            Pro trial — {trialDays} day{trialDays === 1 ? '' : 's'} left
            {trialDays <= 2 && <span className="text-brand-600"> · then Free, calling stays on</span>}
          </button>
          {trialDays <= 2 && (
            <button
              type="button"
              onClick={() => setView('pro')}
              className="shrink-0 rounded bg-brand-600 px-2 py-1 text-xs font-medium text-white hover:bg-brand-700"
            >
              Keep Pro · {fmtMoney(plan.prices.monthlyCents)}/mo
            </button>
          )}
        </div>
      )}

      {/* Trial over, never subscribed — said once, then it is just the Free plan. */}
      {plan && isTrialEnded(plan) && trialEndedSeen.value === false && (
        <div className="flex items-center justify-between gap-2 border-b border-gray-200 bg-gray-50 px-3 py-2">
          <button
            type="button"
            onClick={() => {
              trialEndedSeen.set();
              setView('pro');
            }}
            className="text-left text-xs leading-snug text-gray-700 hover:underline"
          >
            Your Pro trial ended — you’re on Free. Calling works as before.
          </button>
          <button
            type="button"
            onClick={trialEndedSeen.set}
            aria-label="Dismiss"
            className="shrink-0 rounded px-1.5 text-sm text-gray-400 hover:bg-gray-200 hover:text-gray-600"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}

/** A one-way "seen" flag in extension storage. `value` is null until read. */
function useStoredFlag(key: string): { value: boolean | null; set: () => void } {
  const [value, setValue] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    chrome.storage.local.get(key).then((got) => {
      if (!cancelled) setValue(!!got[key]);
    });
    return () => { cancelled = true; };
  }, [key]);
  return {
    value,
    set: () => {
      setValue(true);
      void chrome.storage.local.set({ [key]: true });
    },
  };
}

/**
 * Reactive watcher for the `cloudSyncBlocked` flag set in cloud.ts when
 * `/api/calls/{userId}` returns 402.
 */
function useCloudSyncBlocked(): boolean {
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    let cancelled = false;
    chrome.storage.local.get('cloudSyncBlocked').then(({ cloudSyncBlocked }) => {
      if (!cancelled) setBlocked(!!cloudSyncBlocked);
    });
    const listener = (changes: { [k: string]: chrome.storage.StorageChange }, area: string) => {
      if (area === 'local' && changes.cloudSyncBlocked) {
        setBlocked(!!changes.cloudSyncBlocked.newValue);
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => {
      cancelled = true;
      chrome.storage.onChanged.removeListener(listener);
    };
  }, []);
  return blocked;
}

/**
 * Usage chip in the header. Nothing while there is plenty left; from 80% used
 * it shows what is left of the tightest allowance. Taps → Plan.
 */
function UsageChip() {
  const plan = usePlan();
  const setView = useCallStore((s) => s.setView);
  const chip = plan ? usageChip(plan) : null;
  if (!chip) return null;
  return (
    <button
      type="button"
      onClick={() => setView('pro')}
      title={`${chip.kind === 'questions' ? 'AI questions' : 'Transcription'} this month — tap for details`}
      className={[
        'rounded-full border px-2 py-0.5 text-xs font-medium tabular-nums',
        chip.level === 'out'
          ? 'border-red-200 bg-red-50 text-red-700'
          : 'border-amber-200 bg-amber-50 text-amber-800',
      ].join(' ')}
    >
      {chip.label}
    </button>
  );
}
