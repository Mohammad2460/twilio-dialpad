import { useState } from 'react';
import { useCallStore } from '../stores/call-store';
import { getManager } from '../hooks/use-device';
import { formatForDisplay } from '@shared/phone';
import { storage } from '@shared/storage';
import { CallHistoryDetail } from './CallHistoryDetail';
import type { CallRecord } from '@shared/types';

type BadgeKind = 'outgoing-ok' | 'outgoing-fail' | 'incoming-ok' | 'incoming-missed';

function classifyCall(h: CallRecord): { kind: BadgeKind; label: string } {
  if (h.direction === 'in') {
    if (h.status === 'missed') return { kind: 'incoming-missed', label: 'Missed' };
    return { kind: 'incoming-ok', label: 'Incoming' };
  }
  if (h.status === 'failed') return { kind: 'outgoing-fail', label: 'Failed' };
  return { kind: 'outgoing-ok', label: 'Outgoing' };
}

function DirectionBadge({ kind, label }: { kind: BadgeKind; label: string }) {
  const styles: Record<BadgeKind, string> = {
    'outgoing-ok': 'bg-green-50 text-green-700 ring-green-600/20',
    'outgoing-fail': 'bg-red-50 text-red-700 ring-red-600/20',
    'incoming-ok': 'bg-blue-50 text-blue-700 ring-blue-600/20',
    'incoming-missed': 'bg-red-50 text-red-700 ring-red-600/20',
  };

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset ${styles[kind]}`}
      title={label}
    >
      <BadgeIcon kind={kind} />
      {label}
    </span>
  );
}

function BadgeIcon({ kind }: { kind: BadgeKind }) {
  // 12x12 inline SVG — matches existing transcript-icon SVG approach.
  if (kind === 'incoming-missed') {
    // Phone with strike-through (missed)
    return (
      <svg viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3" aria-hidden="true">
        <path d="M3 5.5C3 4.12 4.12 3 5.5 3h1A1.5 1.5 0 0 1 8 4.5v2A1.5 1.5 0 0 1 6.5 8H6c.3 1.4 1.1 2.7 2.3 3.8a8 8 0 0 0 3.7 2.2v-.5A1.5 1.5 0 0 1 13.5 12h2A1.5 1.5 0 0 1 17 13.5v1c0 1.4-1.1 2.5-2.5 2.5H14a11 11 0 0 1-11-11v-.5Z" />
        <path d="M14.3 4.3a1 1 0 0 1 1.4 1.4l-10 10a1 1 0 1 1-1.4-1.4l10-10Z" />
      </svg>
    );
  }
  // Arrow: incoming = down-left, outgoing = up-right
  if (kind === 'incoming-ok') {
    return (
      <svg viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3" aria-hidden="true">
        <path fillRule="evenodd" d="M14.7 5.3a1 1 0 0 1 0 1.4L8.4 13H13a1 1 0 1 1 0 2H6a1 1 0 0 1-1-1V7a1 1 0 1 1 2 0v4.6l6.3-6.3a1 1 0 0 1 1.4 0Z" clipRule="evenodd" />
      </svg>
    );
  }
  // outgoing-ok / outgoing-fail — same arrow, color decided by parent
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3" aria-hidden="true">
      <path fillRule="evenodd" d="M5.3 14.7a1 1 0 0 1 0-1.4L11.6 7H7a1 1 0 1 1 0-2h7a1 1 0 0 1 1 1v7a1 1 0 1 1-2 0V8.4l-6.3 6.3a1 1 0 0 1-1.4 0Z" clipRule="evenodd" />
    </svg>
  );
}

export function CallHistory() {
  const history = useCallStore((s) => s.history);
  const deviceState = useCallStore((s) => s.deviceState);
  const ready = deviceState === 'registered';
  const [detailFor, setDetailFor] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  if (history.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-8 pb-16 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6 text-gray-400">
            <path d="M6.62 10.79a15.05 15.05 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1.05-.24c1.16.39 2.41.6 3.7.6a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A18 18 0 0 1 3 3a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.3.21 2.54.6 3.7a1 1 0 0 1-.24 1.05l-2.24 2.04Z" />
          </svg>
        </div>
        <p className="mt-3 text-sm font-medium text-gray-900">No calls yet</p>
        <p className="mt-1 text-xs leading-relaxed text-gray-500">
          Your recent calls and transcripts will show up here after your first call from the Keypad.
        </p>
      </div>
    );
  }

  async function handleDelete(id: string) {
    if (pendingDelete) return;
    const ok = window.confirm(
      'Delete this call from recent calls?\n\nOnly the entry is removed. Any saved transcript stays in local storage.',
    );
    if (!ok) return;
    setPendingDelete(id);
    try {
      await storage.deleteCallRecord(id);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setPendingDelete(null);
    }
  }

  return (
    <>
      <ul className="divide-y divide-gray-100">
        {history.map((h) => {
          const { kind, label } = classifyCall(h);
          const durationLabel =
            h.durationSec > 0
              ? `${Math.floor(h.durationSec / 60)}:${String(h.durationSec % 60).padStart(2, '0')}`
              : null;
          return (
            <li key={h.id} className="flex items-center gap-2 px-4 py-3 transition-colors hover:bg-gray-50">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <DirectionBadge kind={kind} label={label} />
                  <p className="truncate text-sm font-medium">
                    {h.contact?.name ?? formatForDisplay(h.number)}
                  </p>
                </div>
                <p className="mt-0.5 text-xs text-gray-500">
                  {new Date(h.startedAt).toLocaleString()}
                  {durationLabel ? ` · ${durationLabel}` : ''}
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
                    <path
                      fillRule="evenodd"
                      d="M4 4a2 2 0 012-2h8a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm3 1h6v1H7V5zm0 3h6v1H7V8zm0 3h6v1H7v-1z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>
              )}

              <button
                type="button"
                disabled={!ready}
                onClick={() =>
                  getManager()
                    .startCall(h.number)
                    .catch((e) => alert(e instanceof Error ? e.message : String(e)))
                }
                className="rounded-md bg-brand-50 px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-100 disabled:opacity-40"
              >
                Call
              </button>

              <button
                type="button"
                onClick={() => handleDelete(h.id)}
                disabled={pendingDelete === h.id}
                title="Delete from recent calls"
                aria-label="Delete from recent calls"
                className="rounded-md p-1 text-red-500 hover:bg-red-50 hover:text-red-700 disabled:opacity-40"
              >
                <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                  <path
                    fillRule="evenodd"
                    d="M8.5 3a1 1 0 0 0-1 1v.5h-2A1.5 1.5 0 0 0 4 6h12a1.5 1.5 0 0 0-1.5-1.5h-2V4a1 1 0 0 0-1-1h-3ZM5.7 7.5l.7 8.6A2 2 0 0 0 8.4 18h3.2a2 2 0 0 0 2-1.9l.7-8.6H5.7Zm2.6 1.7a.7.7 0 0 1 1.4 0v6.2a.7.7 0 0 1-1.4 0V9.2Zm2.6 0a.7.7 0 0 1 1.4 0v6.2a.7.7 0 0 1-1.4 0V9.2Z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            </li>
          );
        })}
      </ul>

      {detailFor && (
        <CallHistoryDetail callSid={detailFor} onClose={() => setDetailFor(null)} />
      )}
    </>
  );
}
