import { useState } from 'react';
import { summarizeCall, type SummarizeStatus } from '@shared/insights';
import { isSummarizable } from '@shared/insights-core';
import type { Transcript } from '@shared/types';
import { PromiseRow } from './AiToday';

const FAILURE_COPY: Partial<Record<SummarizeStatus, string>> = {
  no_credits: 'Today’s summary limit is reached. Try again tomorrow.',
  not_signed_in: 'Finish account setup to use AI summaries.',
  failed: 'Couldn’t summarize this call. Try again.',
  skipped: 'Not enough conversation in this call to summarize.',
};

function formatTs(sec: number): string {
  return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
}

/**
 * AI notes for one call: summary, objections, promises, next step. Shows a
 * "Summarize" action when the call has no notes yet (auto-summary off, the
 * panel closed too early, or a previous attempt failed).
 */
export function InsightCard({
  transcript,
  onJump,
}: {
  transcript: Transcript;
  /** Scroll the transcript to this many seconds into the call. */
  onJump?: (sec: number) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const insight = transcript.insight;

  async function summarize() {
    setBusy(true);
    setFailure(null);
    const status = await summarizeCall(transcript.callSid, { force: true });
    setBusy(false);
    if (status !== 'ok') setFailure(FAILURE_COPY[status] ?? FAILURE_COPY.failed!);
  }

  if (!insight) {
    if (!isSummarizable(transcript)) return null;
    return (
      <div className="mb-3 rounded-lg border border-brand-100 bg-brand-50 p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold text-brand-800">AI summary</p>
          <button
            type="button"
            onClick={summarize}
            disabled={busy}
            className="rounded-md bg-brand-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {busy ? 'Summarizing…' : 'Summarize'}
          </button>
        </div>
        <p className="mt-0.5 text-[11px] text-gray-600">
          Get the summary, objections and promises from this call.
        </p>
        {failure && <p className="mt-1 text-[11px] text-red-600">{failure}</p>}
      </div>
    );
  }

  return (
    <div className="mb-3 rounded-lg border border-brand-100 bg-brand-50/60 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-700">AI summary</p>
      <p className="mt-1 text-sm leading-relaxed text-gray-900">{insight.summary}</p>

      {insight.nextStep && (
        <p className="mt-2 text-sm text-gray-900">
          <span className="font-semibold">Next step: </span>
          {insight.nextStep}
        </p>
      )}

      {insight.objections.length > 0 && (
        <div className="mt-2">
          <p className="text-[11px] font-semibold text-gray-600">Objections</p>
          <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-sm text-gray-800">
            {insight.objections.map((o, i) => (
              <li key={i}>{o}</li>
            ))}
          </ul>
        </div>
      )}

      {insight.promises.length > 0 && (
        <div className="mt-2">
          <p className="text-[11px] font-semibold text-gray-600">Promises</p>
          <ul>
            {insight.promises.map((p) => (
              <PromiseRow
                key={p.id}
                item={{
                  callSid: transcript.callSid,
                  number: transcript.remoteNumber,
                  contactName: transcript.contactSnapshot?.name,
                  callStartedAt: transcript.startedAt,
                  promise: p,
                }}
                trailing={
                  p.ts !== undefined && onJump ? (
                    <button
                      type="button"
                      onClick={() => onJump(p.ts!)}
                      title="Jump to this moment in the transcript"
                      className="shrink-0 rounded px-1 text-[11px] tabular-nums text-brand-700 hover:bg-brand-100"
                    >
                      {formatTs(p.ts)}
                    </button>
                  ) : undefined
                }
              />
            ))}
          </ul>
        </div>
      )}

      {failure && <p className="mt-1 text-[11px] text-red-600">{failure}</p>}
    </div>
  );
}
