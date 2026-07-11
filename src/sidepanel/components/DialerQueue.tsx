import { useDialerStore } from '../stores/dialer-store';
import { formatForDisplay } from '@shared/phone';
import type { DialerItemStatus, DialerOutcome, DialerQueueItem } from '@shared/types';

const STATUS_STYLES: Record<DialerItemStatus, string> = {
  pending: 'bg-gray-100 text-gray-700',
  calling: 'bg-amber-100 text-amber-800 animate-pulse',
  done: 'bg-green-100 text-green-700',
  skipped: 'bg-gray-100 text-gray-500 italic',
  failed: 'bg-red-100 text-red-700',
};

const OUTCOME_LABELS: Record<DialerOutcome, string> = {
  interested: '✓ Interested',
  callback: '⟳ Callback',
  no_answer: '— No answer',
  do_not_call: '⛔ DNC',
};

export function DialerQueue() {
  const queue = useDialerStore((s) => s.queue);
  const index = useDialerStore((s) => s.index);
  const setOutcome = useDialerStore((s) => s.setOutcome);

  if (queue.length === 0) {
    return (
      <div className="px-8 pb-8 pt-2 text-center">
        <p className="text-sm font-medium text-gray-900">Your call list is empty</p>
        <p className="mt-1 text-xs leading-relaxed text-gray-500">
          Upload a CSV or paste numbers above, then work through the list one
          call at a time — outcomes tracked for every dial.
        </p>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-gray-100 border-y border-gray-100">
      {queue.map((item, i) => (
        <DialerRow
          key={item.id}
          item={item}
          isCurrent={i === index}
          position={i + 1}
          onOutcomeChange={(o) => setOutcome(item.id, o)}
        />
      ))}
    </ul>
  );
}

function DialerRow({
  item,
  isCurrent,
  position,
  onOutcomeChange,
}: {
  item: DialerQueueItem;
  isCurrent: boolean;
  position: number;
  onOutcomeChange: (o: DialerOutcome) => void;
}) {
  return (
    <li
      className={[
        'flex items-start gap-2 px-4 py-2.5',
        isCurrent ? 'bg-brand-50 ring-1 ring-inset ring-brand-200' : '',
      ].join(' ')}
    >
      <span className="mt-0.5 w-6 shrink-0 text-right text-xs font-mono text-gray-400">
        {position}.
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-gray-900">
            {item.label ?? formatForDisplay(item.number)}
          </span>
          <span
            className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${STATUS_STYLES[item.status]}`}
          >
            {item.status}
          </span>
        </div>
        {item.label && (
          <p className="truncate text-xs text-gray-500 tabular-nums">
            {formatForDisplay(item.number)}
          </p>
        )}
        {item.status === 'done' && (
          <div className="mt-1.5 flex items-center gap-1.5">
            <select
              value={item.outcome ?? ''}
              onChange={(e) => onOutcomeChange(e.target.value as DialerOutcome)}
              className="rounded border border-gray-300 bg-white px-1.5 py-0.5 text-[11px] text-gray-700 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              <option value="" disabled>
                Outcome…
              </option>
              {(Object.keys(OUTCOME_LABELS) as DialerOutcome[]).map((k) => (
                <option key={k} value={k}>
                  {OUTCOME_LABELS[k]}
                </option>
              ))}
            </select>
            {item.outcome && (
              <span className="text-[11px] text-gray-500">{OUTCOME_LABELS[item.outcome]}</span>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
