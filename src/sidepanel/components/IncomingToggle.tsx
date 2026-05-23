import { useState } from 'react';
import { useCallStore } from '../stores/call-store';
import { storage } from '@shared/storage';
import { pushConfig } from '@shared/twilio-env';

/**
 * Quick on/off switch for "ring this extension on incoming calls."
 * Lives in the StatusBar. Optimistic — flips immediately, rolls back on error.
 */
export function IncomingToggle() {
  const settings = useCallStore((s) => s.settings);
  const setSettings = useCallStore((s) => s.setSettings);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!settings) return null;

  const enabled = settings.incomingEnabled ?? true;
  const hasConfigSupport = !!(settings.serviceSid && settings.environmentSid && settings.configSecret);

  async function toggle() {
    if (!settings || busy || !hasConfigSupport) return;
    const next = !enabled;
    setBusy(true);
    setError(null);
    // Optimistic local flip.
    const optimistic = { ...settings, incomingEnabled: next };
    setSettings(optimistic);
    try {
      await pushConfig(settings, { incomingEnabled: next });
      const updated = await storage.updateSettings({ incomingEnabled: next });
      if (updated) setSettings(updated);
    } catch (e) {
      // Roll back.
      setSettings(settings);
      setError(e instanceof Error ? e.message : String(e));
      setTimeout(() => setError(null), 4000);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={toggle}
        disabled={busy || !hasConfigSupport}
        title={
          !hasConfigSupport
            ? 'Re-run setup to enable forwarding'
            : enabled
              ? 'Incoming calls ringing here. Click to forward.'
              : 'Incoming forwarded. Click to ring here.'
        }
        className={[
          'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium transition',
          !hasConfigSupport
            ? 'cursor-not-allowed bg-gray-100 text-gray-400'
            : enabled
              ? 'bg-green-100 text-green-800 hover:bg-green-200'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
          busy ? 'opacity-50' : '',
        ].join(' ')}
      >
        <span
          className={[
            'relative inline-flex h-3 w-6 shrink-0 items-center rounded-full transition',
            enabled ? 'bg-green-500' : 'bg-gray-400',
          ].join(' ')}
        >
          <span
            className={[
              'inline-block h-2.5 w-2.5 transform rounded-full bg-white transition',
              enabled ? 'translate-x-3' : 'translate-x-0.5',
            ].join(' ')}
          />
        </span>
        {enabled ? 'Ring' : 'Forward'}
      </button>
      {error && (
        <div className="absolute right-0 top-full z-50 mt-1 max-w-[200px] rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[10px] text-red-700 shadow">
          {error}
        </div>
      )}
    </div>
  );
}
