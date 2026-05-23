import { useCallStore } from '../stores/call-store';
import { getManager } from '../hooks/use-device';
import { IncomingToggle } from './IncomingToggle';

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
          <button
            type="button"
            onClick={() => chrome.runtime.openOptionsPage()}
            title="Settings"
            className="rounded p-1 text-gray-400 hover:bg-gray-100 text-sm"
          >
            ⚙
          </button>
        </div>
      </header>

      {/* Mic banner — always show until Ready, directing to options page where getUserMedia works */}
      {deviceState !== 'registered' && settings && (
        <div className="bg-amber-50 px-3 py-2 text-xs text-amber-800 border-b border-amber-100 flex items-center justify-between gap-2">
          <span>Microphone permission needed for calls.</span>
          <button
            type="button"
            onClick={() => chrome.runtime.openOptionsPage()}
            className="shrink-0 rounded bg-amber-600 px-2 py-1 text-white text-xs hover:bg-amber-700"
          >
            Fix in Settings →
          </button>
        </div>
      )}

      {deviceError && (
        <div className="bg-red-50 px-3 py-1.5 text-xs text-red-700 border-b border-red-100 break-all">
          {deviceError}
        </div>
      )}
    </div>
  );
}
