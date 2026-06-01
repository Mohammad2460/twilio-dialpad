import { useEffect } from 'react';
import { DialerInput } from './DialerInput';
import { DialerQueue } from './DialerQueue';
import { DialerControls } from './DialerControls';
import { useDialerStore } from '../stores/dialer-store';

/**
 * Auto-dialer side-panel view.
 *
 * Preview mode only — user clicks "Call next" between calls. The hook in
 * use-device.ts marks the active queue item as done when the call disconnects,
 * but never auto-advances. This avoids any TCPA "auto-dialer" classification.
 */
export function AutoDialer() {
  const hydrated = useDialerStore((s) => s.hydrated);
  const hydrate = useDialerStore((s) => s.hydrate);

  useEffect(() => {
    if (!hydrated) {
      hydrate().catch((e) => console.error('[dialer] hydrate failed', e));
    }
  }, [hydrated, hydrate]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto">
        <DialerInput />
        <DialerQueue />
      </div>
      <DialerControls />
    </div>
  );
}
