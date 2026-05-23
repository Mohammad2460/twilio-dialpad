import { useState } from 'react';
import { useCallStore } from '../stores/call-store';
import { getManager } from '../hooks/use-device';
import { formatForDisplay } from '@shared/phone';
import { CallHistoryDetail } from './CallHistoryDetail';

export function CallHistory() {
  const history = useCallStore((s) => s.history);
  const deviceState = useCallStore((s) => s.deviceState);
  const ready = deviceState === 'registered';
  const [detailFor, setDetailFor] = useState<string | null>(null);

  if (history.length === 0) {
    return (
      <div className="p-6 text-center text-sm text-gray-500">No recent calls.</div>
    );
  }
  return (
    <>
      <ul className="divide-y divide-gray-100">
        {history.map((h) => (
          <li key={h.id} className="flex items-center gap-2 px-4 py-3">
            <span className="text-lg">
              {h.direction === 'in' ? (h.status === 'missed' ? '↙️' : '↘️') : '↗️'}
            </span>
            <div className="flex-1 min-w-0">
              <p className="truncate text-sm font-medium">
                {h.contact?.name ?? formatForDisplay(h.number)}
              </p>
              <p className="text-xs text-gray-500">
                {new Date(h.startedAt).toLocaleString()} • {h.durationSec}s • {h.status}
              </p>
            </div>
            {h.hasTranscript && h.sid && (
              <button
                type="button"
                onClick={() => setDetailFor(h.sid!)}
                title="View transcript"
                className="rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
              >
                <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                  <path fillRule="evenodd" d="M4 4a2 2 0 012-2h8a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm3 1h6v1H7V5zm0 3h6v1H7V8zm0 3h6v1H7v-1z" clipRule="evenodd" />
                </svg>
              </button>
            )}
            <button
              type="button"
              disabled={!ready}
              onClick={() => getManager().startCall(h.number).catch((e) => alert(e instanceof Error ? e.message : String(e)))}
              className="rounded-md bg-brand-50 px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-100 disabled:opacity-40"
            >
              Call
            </button>
          </li>
        ))}
      </ul>

      {detailFor && (
        <CallHistoryDetail callSid={detailFor} onClose={() => setDetailFor(null)} />
      )}
    </>
  );
}
