import { useEffect, useState } from 'react';

export type MicPermission = 'granted' | 'prompt' | 'denied' | 'unsupported';

/**
 * Live microphone permission state via the Permissions API. Decoupled from Twilio
 * device state — registration is token-based and never needs the mic. Fails open to
 * 'unsupported' (so we never nag) if the API is missing/throws (some Chromium forks).
 */
export function useMicPermission(): MicPermission {
  const [state, setState] = useState<MicPermission>('unsupported');

  useEffect(() => {
    let status: PermissionStatus | null = null;
    let cancelled = false;
    const onChange = () => {
      if (status && !cancelled) setState(status.state as MicPermission);
    };
    try {
      navigator.permissions
        .query({ name: 'microphone' as PermissionName })
        .then((s) => {
          if (cancelled) return;
          status = s;
          setState(s.state as MicPermission);
          s.addEventListener('change', onChange);
        })
        .catch(() => {
          if (!cancelled) setState('unsupported');
        });
    } catch {
      setState('unsupported');
    }
    return () => {
      cancelled = true;
      if (status) status.removeEventListener('change', onChange);
    };
  }, []);

  return state;
}
