import { useState } from 'react';
import { useCallStore } from '../stores/call-store';
import { useDialerStore, DEFAULT_DAILY_CAP } from '../stores/dialer-store';
import { getManager } from '../hooks/use-device';
import { formatForDisplay } from '@shared/phone';

export function DialerControls() {
  const queue = useDialerStore((s) => s.queue);
  const index = useDialerStore((s) => s.index);
  const dailyCount = useDialerStore((s) => s.dailyCount);
  const setIndex = useDialerStore((s) => s.setIndex);
  const patchItem = useDialerStore((s) => s.patchItem);
  const bumpDailyCount = useDialerStore((s) => s.bumpDailyCount);
  const clear = useDialerStore((s) => s.clear);

  const deviceState = useCallStore((s) => s.deviceState);
  const activeCall = useCallStore((s) => s.activeCall);
  const selectedCallerId = useCallStore((s) => s.selectedCallerId);

  const ready = deviceState === 'registered' && !activeCall;
  const cap = DEFAULT_DAILY_CAP;
  const capReached = dailyCount >= cap;

  const current = queue[index];
  const pendingAtOrAfter = queue.slice(index).find((q) => q.status === 'pending');
  const nextPendingIndex = pendingAtOrAfter ? queue.indexOf(pendingAtOrAfter) : -1;
  const allDone = nextPendingIndex === -1;

  const progress = queue.filter(
    (q) => q.status === 'done' || q.status === 'skipped' || q.status === 'failed',
  ).length;

  const [busy, setBusy] = useState(false);

  async function callNext() {
    if (capReached) {
      alert(`Daily cap reached (${cap}). Auto-dial paused until tomorrow.`);
      return;
    }
    if (allDone) return;
    setBusy(true);
    try {
      // Advance to next pending item
      if (nextPendingIndex !== index) await setIndex(nextPendingIndex);
      const target = queue[nextPendingIndex];
      if (!target) return;

      await patchItem(target.id, { status: 'calling' });
      await bumpDailyCount();

      try {
        await getManager().startCall(target.number, selectedCallerId || undefined);
      } catch (e) {
        await patchItem(target.id, { status: 'failed' });
        alert(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setBusy(false);
    }
  }

  async function skipCurrent() {
    if (allDone) return;
    const target = queue[nextPendingIndex];
    if (!target) return;
    await patchItem(target.id, { status: 'skipped' });
    // Advance pointer to next pending
    const after = queue
      .map((q, i) => ({ q, i }))
      .find(({ q, i }) => i > nextPendingIndex && q.status === 'pending');
    if (after) await setIndex(after.i);
  }

  async function handleClear() {
    if (!confirm('Clear the entire queue? Calls already made stay in your call history.')) return;
    await clear();
  }

  if (queue.length === 0) return null;

  return (
    <div className="border-t border-gray-200 bg-white">
      <div className="px-4 pt-3">
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium text-gray-700">
            Progress: {progress}/{queue.length}
          </span>
          <span className={capReached ? 'text-red-600' : 'text-gray-500'}>
            Today: {dailyCount}/{cap}
          </span>
        </div>
        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
          <div
            className="h-full bg-brand-500 transition-all"
            style={{ width: `${(progress / queue.length) * 100}%` }}
          />
        </div>
      </div>

      {!allDone && current && (
        <div className="mx-4 mt-3 rounded-md bg-gray-50 px-3 py-2 text-xs">
          <p className="text-[10px] font-medium uppercase tracking-wide text-gray-500">Up next</p>
          <p className="truncate text-sm font-medium text-gray-900">
            {queue[nextPendingIndex]?.label ??
              (queue[nextPendingIndex]
                ? formatForDisplay(queue[nextPendingIndex].number)
                : '—')}
          </p>
        </div>
      )}

      {allDone && (
        <div className="mx-4 mt-3 rounded-md bg-green-50 px-3 py-2 text-xs text-green-700">
          ✓ All numbers processed. Clear queue or add more to continue.
        </div>
      )}

      <div className="flex gap-2 px-4 py-3">
        <button
          type="button"
          onClick={callNext}
          disabled={!ready || allDone || busy || capReached}
          className="flex-1 rounded-md bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:bg-gray-300"
          title={
            !ready
              ? 'Device not ready or call in progress'
              : capReached
                ? 'Daily cap reached'
                : 'Call next pending number'
          }
        >
          {busy ? 'Dialing…' : 'Call next'}
        </button>
        <button
          type="button"
          onClick={skipCurrent}
          disabled={allDone || busy || !!activeCall}
          className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
        >
          Skip
        </button>
        <button
          type="button"
          onClick={handleClear}
          disabled={busy}
          className="rounded-md border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-40"
        >
          Clear
        </button>
      </div>
    </div>
  );
}
