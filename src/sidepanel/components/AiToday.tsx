import { useState, type ReactNode } from 'react';
import { localDate } from '@shared/ai-context';
import { setPromiseDone } from '@shared/insights';
import type { MissedItem, PromiseItem, TodayBrief } from '@shared/insights-core';
import { formatForDisplay } from '@shared/phone';
import { formatRelativeDate } from '@shared/hubspot';
import { getManager } from '../hooks/use-device';
import { useCallStore } from '../stores/call-store';

const who = (item: { contactName?: string; number: string }) =>
  item.contactName ?? formatForDisplay(item.number);

/** "due today" / "2d overdue" / "due Oct 9" — relative to the local calendar day. */
function dueLabel(due: string, now: number): { text: string; overdue: boolean } {
  const today = localDate(now);
  if (due === today) return { text: 'due today', overdue: false };
  const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${due}T00:00:00Z`)) / 86_400_000);
  if (days > 0) return { text: `${days}d overdue`, overdue: true };
  const d = new Date(`${due}T00:00:00`);
  return {
    text: `due ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`,
    overdue: false,
  };
}

/** One promise: check-off box, text, who it is with, when it is due. */
export function PromiseRow({
  item,
  onOpenCall,
  trailing,
}: {
  item: PromiseItem;
  onOpenCall?: (callSid: string) => void;
  /** Extra control at the end of the row (e.g. a transcript timestamp). */
  trailing?: ReactNode;
}) {
  const { promise } = item;
  const due = promise.due ? dueLabel(promise.due, Date.now()) : null;
  return (
    <li className="flex items-start gap-2 py-1.5">
      <input
        type="checkbox"
        checked={!!promise.done}
        onChange={(e) => void setPromiseDone(item.callSid, promise.id, e.target.checked)}
        aria-label={`Mark done: ${promise.text}`}
        className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-gray-300 text-brand-600"
      />
      <button
        type="button"
        onClick={() => onOpenCall?.(item.callSid)}
        disabled={!onOpenCall}
        className="min-w-0 flex-1 text-left"
        title={onOpenCall ? 'Open this call' : undefined}
      >
        <span className={`block text-sm ${promise.done ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
          {promise.text}
        </span>
        <span className="mt-0.5 block text-[11px] text-gray-500">
          {promise.who === 'me' ? 'You → ' : 'Waiting on '}
          {who(item)}
          {due && (
            <span className={due.overdue ? 'font-medium text-red-600' : ''}> · {due.text}</span>
          )}
        </span>
      </button>
      {trailing}
    </li>
  );
}

function MissedRow({ item }: { item: MissedItem }) {
  const ready = useCallStore((s) => s.deviceState) === 'registered';
  return (
    <li className="flex items-center gap-2 py-1.5">
      <span className="flex h-4 w-4 shrink-0 items-center justify-center text-red-500" aria-hidden="true">
        ☎
      </span>
      <div className="min-w-0 flex-1">
        <span className="block truncate text-sm text-gray-900">{who(item)}</span>
        <span className="block text-[11px] text-gray-500">
          Missed {formatRelativeDate(new Date(item.lastMissedAt).toISOString()) ?? ''}
          {item.count > 1 ? ` · ${item.count} times` : ''}
        </span>
      </div>
      <button
        type="button"
        disabled={!ready}
        onClick={() =>
          getManager()
            .startCall(item.number)
            .catch((e) => alert(e instanceof Error ? e.message : String(e)))
        }
        className="rounded-md bg-brand-50 px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-100 disabled:opacity-40"
      >
        Call back
      </button>
    </li>
  );
}

/** What needs attention today — computed locally, no AI call. */
export function TodayPanel({
  brief,
  onOpenCall,
}: {
  brief: TodayBrief;
  onOpenCall: (callSid: string) => void;
}) {
  const empty = brief.due.length === 0 && brief.missed.length === 0;
  return (
    <section className="px-3 py-2">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Today</h2>
        <span className="text-[11px] text-gray-400">
          {new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
        </span>
      </div>
      {empty ? (
        <p className="py-2 text-xs text-gray-500">Nothing owed today. You’re all caught up.</p>
      ) : (
        <ul className="max-h-44 divide-y divide-gray-100 overflow-y-auto">
          {brief.due.map((item) => (
            <PromiseRow key={`${item.callSid}:${item.promise.id}`} item={item} onOpenCall={onOpenCall} />
          ))}
          {brief.missed.map((item) => (
            <MissedRow key={item.number} item={item} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** Every open promise across calls. Collapsed by default to leave room for chat. */
export function PromiseList({
  items,
  onOpenCall,
}: {
  items: PromiseItem[];
  onOpenCall: (callSid: string) => void;
}) {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;
  return (
    <section className="border-t border-gray-100 px-3 py-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-gray-500"
      >
        <span>Open promises ({items.length})</span>
        <span aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <ul className="mt-1 max-h-48 divide-y divide-gray-100 overflow-y-auto">
          {items.map((item) => (
            <PromiseRow key={`${item.callSid}:${item.promise.id}`} item={item} onOpenCall={onOpenCall} />
          ))}
        </ul>
      )}
    </section>
  );
}
