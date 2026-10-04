import { useEffect, useState } from 'react';
import { isDeviceRegistered, registerDevice } from '@shared/cloud';
import type { Settings } from '@shared/types';

/**
 * Legacy installs (≤1.2.0) authenticated with a bare userId, which the backend
 * stopped accepting after LEGACY_AUTH_UNTIL. Until the device is registered,
 * every cloud call (subscription, credits, call sync) 401s — so this banner is
 * pinned app-wide instead of hidden in Settings. Registering reuses the same
 * account (backend dedups by Twilio Account SID), so trial/subscription carry over.
 */
export function ReconnectBanner({ settings }: { settings: Settings }) {
  const [registered, setRegistered] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    isDeviceRegistered().then(setRegistered).catch(() => setRegistered(true));
  }, []);

  if (registered !== false || !settings.accountSid) return null;

  async function reconnect(e: React.FormEvent) {
    e.preventDefault();
    if (!token.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await registerDevice({
        accountSid: settings.accountSid,
        authToken: token.trim(),
        functionUrl: settings.functionUrl,
        configSecret: settings.configSecret,
      });
      // Reload so entitlements / credits refetch with the new device auth.
      location.reload();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(
        msg.includes('401')
          ? 'Twilio rejected that Auth Token — copy it again from console.twilio.com.'
          : 'Could not reconnect. Check your connection and try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
      <div className="flex items-center justify-between gap-2">
        <span>
          <strong>Reconnect your account</strong> — a one-time step to restore sync and your plan
          features. Calling still works.
        </span>
        {!open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="shrink-0 rounded-md bg-amber-600 px-3 py-1 font-medium text-white hover:bg-amber-700"
          >
            Reconnect
          </button>
        )}
      </div>
      {open && (
        <form onSubmit={(e) => void reconnect(e)} className="mt-2 space-y-1.5">
          <label className="block text-[11px] text-amber-800" htmlFor="reconnect-token">
            Twilio Auth Token (console.twilio.com → Account info). Verified with Twilio, then
            discarded — never stored.
          </label>
          <div className="flex gap-2">
            <input
              id="reconnect-token"
              type="password"
              autoComplete="off"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              disabled={busy}
              className="min-w-0 flex-1 rounded-md border border-amber-300 bg-white px-2 py-1 text-xs text-gray-900 focus:border-amber-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={busy || !token.trim()}
              className="shrink-0 rounded-md bg-amber-600 px-3 py-1 font-medium text-white hover:bg-amber-700 disabled:opacity-60"
            >
              {busy ? 'Verifying…' : 'Save'}
            </button>
          </div>
          {error && <p className="text-red-700">{error}</p>}
        </form>
      )}
    </div>
  );
}
