import { useEffect, useRef, useState } from 'react';
import { useCallStore } from '../stores/call-store';

const STORAGE_KEY = 'transcriptPanelOpen';

/**
 * Live transcript display during an active call.
 * Reads from store.transcriptDraft. Collapsible.
 * Auto-scrolls to bottom as segments stream in.
 */
export function TranscriptPanel() {
  const draft = useCallStore((s) => s.transcriptDraft);
  const settings = useCallStore((s) => s.settings);
  const error = useCallStore((s) => s.transcriptError);
  const hasKey = !!settings?.deepgramApiKey;

  const [open, setOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });

  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Persist open/closed across calls.
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, open ? '1' : '0'); } catch { /* noop */ }
  }, [open]);

  // Auto-scroll on new segment.
  useEffect(() => {
    if (!open) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [draft, open]);

  if (!hasKey) {
    // Soft hint only when settings panel is the right place to fix it.
    return null;
  }

  const count = draft.filter((s) => s.isFinal).length;

  return (
    <div className="mt-3 w-full rounded-lg border border-gray-200 bg-gray-50 text-left">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-100"
      >
        <span className="flex items-center gap-1.5">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
          </span>
          Live Transcript
          {count > 0 && <span className="text-gray-400">· {count} segment{count === 1 ? '' : 's'}</span>}
        </span>
        <svg
          viewBox="0 0 20 20"
          fill="currentColor"
          className={['h-3.5 w-3.5 text-gray-400 transition-transform', open ? 'rotate-180' : ''].join(' ')}
        >
          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" />
        </svg>
      </button>

      {open && (
        <div
          ref={scrollRef}
          className="max-h-40 overflow-y-auto border-t border-gray-200 bg-white px-3 py-2 text-xs"
        >
          {error ? (
            <p className="break-words text-red-600">
              <span className="font-semibold">Transcription error:</span> {error}
            </p>
          ) : draft.length === 0 ? (
            <p className="text-gray-400 italic">Listening…</p>
          ) : (
            <div className="space-y-1.5">
              {draft.map((seg) => (
                <div key={`${seg.speaker}-${seg.isFinal ? seg.ts : 'interim'}`} className="flex gap-1.5">
                  <span
                    className={[
                      'shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wider',
                      seg.speaker === 'user'
                        ? 'bg-green-100 text-green-700'
                        : 'bg-gray-100 text-gray-600',
                    ].join(' ')}
                  >
                    {seg.speaker === 'user' ? 'You' : 'Caller'}
                  </span>
                  <span className={['flex-1', seg.isFinal ? 'text-gray-900' : 'text-gray-500 italic'].join(' ')}>
                    {seg.text}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
