import { useEffect, useState } from 'react';
import {
  checklistSteps,
  getOnboarding,
  markOnboarding,
  showChecklist,
  type OnboardingFlags,
  type OnboardingStep,
} from '@shared/onboarding';
import { AI_CHAT_ENABLED } from '@shared/flags';
import { useCallStore } from '../stores/call-store';

type View = 'dialpad' | 'settings' | 'ai' | 'autodial';

const STEP: Record<OnboardingStep, { label: string; hint: string; view: View }> = {
  call: { label: 'Make your first call', hint: 'Type a number on the keypad', view: 'dialpad' },
  transcription: { label: 'Turn on call transcription', hint: 'Settings → Call transcription', view: 'settings' },
  ai: { label: 'Ask AI about a call', hint: 'After a transcribed call', view: 'ai' },
  list: { label: 'Load a list into the auto-dialer', hint: 'Paste numbers and call through them', view: 'autodial' },
};

/**
 * First-week checklist: one quiet line under the status bar that opens into
 * the four things that make the product stick. Goes away when all are done,
 * when dismissed, or two weeks after setup.
 */
export function OnboardingChecklist() {
  const settings = useCallStore((s) => s.settings);
  const hasCall = useCallStore((s) => s.history.length > 0);
  const view = useCallStore((s) => s.view);
  const setView = useCallStore((s) => s.setView);
  const [flags, setFlags] = useState<OnboardingFlags | null>(null);
  const [open, setOpen] = useState(false);

  // Steps are completed on other screens: re-read on view change, and as soon
  // as a flag is written.
  useEffect(() => {
    let cancelled = false;
    const read = () =>
      getOnboarding()
        .then((f) => {
          if (!cancelled) setFlags(f);
        })
        .catch(() => undefined);
    void read();
    const onChange = (changes: { [k: string]: chrome.storage.StorageChange }, area: string) => {
      if (area === 'local' && changes.onboarding) void read();
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => {
      cancelled = true;
      chrome.storage.onChanged.removeListener(onChange);
    };
  }, [view]);

  if (!settings || !flags) return null;
  const input = {
    flags,
    hasCall,
    transcriptionOn: !!settings.managedTranscription,
    configuredAt: settings.configuredAt,
    now: Date.now(),
  };
  if (!showChecklist(input)) return null;

  const steps = checklistSteps(input).filter((s) => AI_CHAT_ENABLED || s.step !== 'ai');
  const doneCount = steps.filter((s) => s.done).length;

  function dismiss() {
    setFlags({ ...flags, dismissed: true });
    void markOnboarding('dismissed');
  }

  return (
    <div className="border-b border-gray-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left hover:bg-gray-50"
      >
        <span className="flex items-center gap-2 text-xs text-gray-700">
          <span className="flex gap-0.5" aria-hidden="true">
            {steps.map((s) => (
              <span key={s.step} className={`h-1 w-3 rounded-full ${s.done ? 'bg-brand-600' : 'bg-gray-200'}`} />
            ))}
          </span>
          <span>
            Getting started · <span className="tabular-nums">{doneCount} of {steps.length}</span>
          </span>
        </span>
        <svg
          viewBox="0 0 20 20"
          fill="currentColor"
          className={`h-3.5 w-3.5 text-gray-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        >
          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" />
        </svg>
      </button>

      {open && (
        <div className="animate-rise-in px-3 pb-2">
          <ul>
            {steps.map(({ step, done }) => (
              <li key={step}>
                <button
                  type="button"
                  disabled={done}
                  onClick={() => {
                    setView(STEP[step].view);
                    setOpen(false);
                  }}
                  className="flex w-full items-start gap-2 rounded px-1 py-1.5 text-left enabled:hover:bg-gray-50"
                >
                  <span
                    className={[
                      'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[10px]',
                      done ? 'border-brand-600 bg-brand-600 text-white' : 'border-gray-300 text-transparent',
                    ].join(' ')}
                    aria-hidden="true"
                  >
                    ✓
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block text-xs font-medium ${done ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
                      {done && <span className="sr-only">Done: </span>}
                      {STEP[step].label}
                    </span>
                    {!done && <span className="block text-[11px] text-gray-500">{STEP[step].hint}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <button type="button" onClick={dismiss} className="mt-1 px-1 text-[11px] text-gray-500 hover:text-gray-700">
            Hide this list
          </button>
        </div>
      )}
    </div>
  );
}
