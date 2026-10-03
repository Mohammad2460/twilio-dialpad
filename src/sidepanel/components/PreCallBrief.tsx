import { useMemo } from 'react';
import type { CallEntry } from '@shared/ai-context';
import { briefForNumber } from '@shared/insights-core';
import { formatRelativeDate } from '@shared/hubspot';

/**
 * What happened last time with this number — shown before dialing and on the
 * incoming-call screen. Reads stored call notes only; never calls the AI.
 * Renders nothing for numbers without history.
 */
export function PreCallBrief({
  number,
  calls,
  onOpenCall,
}: {
  number: string;
  calls: CallEntry[];
  onOpenCall?: (callSid: string) => void;
}) {
  const brief = useMemo(() => briefForNumber(number, calls), [number, calls]);
  if (!brief) return null;

  const last = formatRelativeDate(new Date(brief.lastCallAt).toISOString());
  const detailSid = brief.detailSid;
  const promises = brief.openPromises.slice(0, 2);

  return (
    <button
      type="button"
      onClick={() => detailSid && onOpenCall?.(detailSid)}
      disabled={!detailSid || !onOpenCall}
      className="w-full rounded-xl border border-brand-100 bg-brand-50/70 px-3 py-2 text-left transition enabled:hover:bg-brand-50"
    >
      <p className="text-[11px] font-semibold text-brand-800">
        {brief.contactName ? `${brief.contactName} · ` : ''}
        {brief.callCount === 1 ? '1 call' : `${brief.callCount} calls`}
        {last ? ` · last ${last}` : ''}
      </p>
      {brief.summary && (
        <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-gray-700">{brief.summary}</p>
      )}
      {promises.map((p) => (
        <p key={`${p.callSid}:${p.promise.id}`} className="mt-0.5 truncate text-xs text-gray-900">
          <span className="font-medium">{p.promise.who === 'me' ? 'You owe: ' : 'Waiting on: '}</span>
          {p.promise.text}
        </p>
      ))}
      {brief.objections.length > 0 && (
        <p className="mt-0.5 truncate text-xs text-gray-600">
          <span className="font-medium">Objection: </span>
          {brief.objections[0]}
        </p>
      )}
    </button>
  );
}
