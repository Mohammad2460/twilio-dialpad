import { useEffect, useRef, useState } from 'react';
import { useCallStore } from '../stores/call-store';
import { getManager } from '../hooks/use-device';
import { usePasteSuggestion } from '../hooks/use-paste-suggestion';
import { normalizeE164, formatForDisplay } from '@shared/phone';
import { storage } from '@shared/storage';

const KEYS: { d: string; sub?: string }[] = [
  { d: '1' }, { d: '2', sub: 'ABC' }, { d: '3', sub: 'DEF' },
  { d: '4', sub: 'GHI' }, { d: '5', sub: 'JKL' }, { d: '6', sub: 'MNO' },
  { d: '7', sub: 'PQRS' }, { d: '8', sub: 'TUV' }, { d: '9', sub: 'WXYZ' },
  { d: '*' }, { d: '0', sub: '+' }, { d: '#' },
];

export function Dialpad() {
  const [input, setInput] = useState('');
  const [lastCalled, setLastCalled] = useState<string | null>(null);
  const deviceState = useCallStore((s) => s.deviceState);
  const callerIds = useCallStore((s) => s.callerIds);
  const selectedCallerId = useCallStore((s) => s.selectedCallerId);
  const setSelectedCallerIdStore = useCallStore((s) => s.setSelectedCallerId);
  const setCallerIdsStore = useCallStore((s) => s.setCallerIds);
  const setView = useCallStore((s) => s.setView);
  const ready = deviceState === 'registered';

  // Paste-to-dial — only show chip when input is empty.
  const { suggestion, dismiss: dismissSuggestion } = usePasteSuggestion(input.length > 0);

  // Load last-called number for the redial affordance.
  useEffect(() => {
    let cancelled = false;
    storage.getSettings().then((s) => {
      if (!cancelled) setLastCalled(s?.lastCalledNumber ?? null);
    });
    return () => { cancelled = true; };
  }, []);

  // Picker state
  const [pickerOpen, setPickerOpen] = useState(false);
  const [addingNumber, setAddingNumber] = useState(false);
  const [newNumber, setNewNumber] = useState('');
  const [addError, setAddError] = useState('');
  const pickerRef = useRef<HTMLDivElement>(null);
  const addInputRef = useRef<HTMLInputElement>(null);

  // Close picker on outside click
  useEffect(() => {
    if (!pickerOpen) return;
    function handle(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
        setAddingNumber(false);
        setNewNumber('');
        setAddError('');
      }
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [pickerOpen]);

  // Focus add-input when it appears
  useEffect(() => {
    if (addingNumber) addInputRef.current?.focus();
  }, [addingNumber]);

  function press(d: string) {
    setInput((v) => (v + d).slice(0, 32));
  }
  function backspace() {
    setInput((v) => v.slice(0, -1));
  }

  async function call() {
    const norm = normalizeE164(input);
    const target = norm.ok ? norm.e164! : input.trim();
    if (!target) return;
    try {
      await getManager().startCall(target, selectedCallerId || undefined);
      setLastCalled(target);
      void storage.updateSettings({ lastCalledNumber: target });
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  }

  async function selectCallerId(id: string) {
    setSelectedCallerIdStore(id);
    await storage.setSelectedCallerId(id);
    setPickerOpen(false);
  }

  async function confirmAdd() {
    setAddError('');
    const norm = normalizeE164(newNumber);
    if (!norm.ok) {
      setAddError(norm.reason ?? 'Invalid number');
      return;
    }
    const e164 = norm.e164!;
    if (callerIds.includes(e164)) {
      setAddError('Already in list');
      return;
    }
    const updated = [...callerIds, e164];
    setCallerIdsStore(updated);
    await storage.setCallerIds(updated);
    setSelectedCallerIdStore(e164);
    await storage.setSelectedCallerId(e164);
    setAddingNumber(false);
    setNewNumber('');
    setPickerOpen(false);
  }

  async function removeCallerId(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    const updated = callerIds.filter((c) => c !== id);
    if (updated.length === 0) return; // must keep at least one
    setCallerIdsStore(updated);
    await storage.setCallerIds(updated);
    if (selectedCallerId === id) {
      setSelectedCallerIdStore(updated[0]);
      await storage.setSelectedCallerId(updated[0]);
    }
  }

  // Keyboard support
  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      if (pickerOpen) return; // don't type while picker is open
      if (/^[0-9*#]$/.test(ev.key)) {
        press(ev.key);
      } else if (ev.key === 'Backspace') {
        backspace();
      } else if (ev.key === 'Enter') {
        call();
      } else if (ev.key === '+' && input.length === 0) {
        press('+');
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, pickerOpen]);

  const norm = normalizeE164(input);
  const displaySelected = selectedCallerId ? formatForDisplay(selectedCallerId) : 'Select number';

  return (
    <div className="flex h-full flex-col p-4">

      {/* ── Top row: settings gear + auto-dial entry ── */}
      <div className="mb-1 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setView('settings')}
          className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100"
          title="Settings"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
            <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.53 1.53 0 01-2.29.95c-1.37-.84-2.94.73-2.1 2.1.55.9.18 2.07-.95 2.29-1.56.38-1.56 2.6 0 2.98a1.53 1.53 0 01.95 2.29c-.84 1.37.73 2.94 2.1 2.1a1.53 1.53 0 012.29.95c.38 1.56 2.6 1.56 2.98 0a1.53 1.53 0 012.29-.95c1.37.84 2.94-.73 2.1-2.1a1.53 1.53 0 01.95-2.29c1.56-.38 1.56-2.6 0-2.98a1.53 1.53 0 01-.95-2.29c.84-1.37-.73-2.94-2.1-2.1a1.53 1.53 0 01-2.29-.95zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
          </svg>
          Settings
        </button>
        <button
          type="button"
          onClick={() => setView('autodial')}
          className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium text-brand-600 hover:bg-brand-50"
          title="Open the auto-dialer"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
            <path d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" />
          </svg>
          Auto-dial
        </button>
      </div>

      {/* ── Caller ID Picker ── */}
      {callerIds.length > 0 && (
        <div className="mb-3" ref={pickerRef}>
          <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-green-600">
            <svg viewBox="0 0 24 24" fill="currentColor" className="h-3 w-3">
              <path d="M6.62 10.79a15.05 15.05 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1.05-.24c1.16.39 2.41.6 3.7.6a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A18 18 0 0 1 3 3a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.3.21 2.54.6 3.7a1 1 0 0 1-.24 1.05l-2.24 2.04Z" />
            </svg>
            Calling From <span className="font-normal text-gray-400">(Caller ID)</span>
          </p>

          <div className="relative">
            {/* Trigger */}
            <button
              type="button"
              onClick={() => { setPickerOpen((v) => !v); setAddingNumber(false); setNewNumber(''); setAddError(''); }}
              className="flex w-full items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm font-medium text-gray-900 transition hover:border-gray-300 hover:bg-gray-100"
            >
              <span className="truncate tabular-nums">{displaySelected}</span>
              <svg
                viewBox="0 0 20 20"
                fill="currentColor"
                className={['h-4 w-4 text-gray-400 transition-transform', pickerOpen ? 'rotate-180' : ''].join(' ')}
              >
                <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" />
              </svg>
            </button>

            {/* Dropdown */}
            {pickerOpen && (
              <div className="absolute left-0 right-0 top-full z-50 mt-1.5 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl">
                {callerIds.map((id, i) => {
                  const isSelected = id === selectedCallerId;
                  const isFirst = i === 0;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => selectCallerId(id)}
                      className={[
                        'group flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm transition',
                        isFirst ? '' : 'border-t border-gray-100',
                        isSelected ? 'bg-green-50' : 'hover:bg-gray-50',
                      ].join(' ')}
                    >
                      {/* Checkmark */}
                      <span className="w-4 shrink-0 text-green-500">
                        {isSelected ? (
                          <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" />
                          </svg>
                        ) : null}
                      </span>

                      {/* Number */}
                      <div className="min-w-0 flex-1">
                        <div className={['tabular-nums font-medium', isSelected ? 'text-green-700' : 'text-gray-900'].join(' ')}>
                          {id}
                        </div>
                        <div className="text-xs text-gray-400">{formatForDisplay(id)}</div>
                      </div>

                      {/* Remove (only if more than 1 number) */}
                      {callerIds.length > 1 && (
                        <button
                          type="button"
                          onClick={(e) => removeCallerId(id, e)}
                          title="Remove"
                          className="ml-auto shrink-0 rounded p-0.5 text-gray-300 opacity-0 transition hover:bg-red-50 hover:text-red-400 group-hover:opacity-100"
                        >
                          <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" />
                          </svg>
                        </button>
                      )}
                    </button>
                  );
                })}

                {/* Add number row */}
                <div className="border-t border-gray-100">
                  {addingNumber ? (
                    <div className="px-3 py-2.5">
                      <input
                        ref={addInputRef}
                        type="tel"
                        value={newNumber}
                        onChange={(e) => { setNewNumber(e.target.value); setAddError(''); }}
                        placeholder="+1 234 567 8900"
                        className={[
                          'w-full rounded-lg border px-3 py-1.5 text-sm outline-none transition focus:ring-2',
                          addError
                            ? 'border-red-300 focus:ring-red-200'
                            : 'border-gray-200 focus:border-green-400 focus:ring-green-100',
                        ].join(' ')}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') confirmAdd();
                          if (e.key === 'Escape') { setAddingNumber(false); setNewNumber(''); setAddError(''); }
                        }}
                      />
                      {addError && <p className="mt-1 text-xs text-red-500">{addError}</p>}
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          onClick={confirmAdd}
                          className="flex-1 rounded-lg bg-green-500 py-1.5 text-xs font-semibold text-white hover:bg-green-600"
                        >
                          Add
                        </button>
                        <button
                          type="button"
                          onClick={() => { setAddingNumber(false); setNewNumber(''); setAddError(''); }}
                          className="flex-1 rounded-lg bg-gray-100 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-200"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setAddingNumber(true)}
                      className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-green-600 hover:bg-gray-50"
                    >
                      <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                        <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" />
                      </svg>
                      Add number
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Paste suggestion chip ── */}
      {suggestion && !input && (
        <div className="mb-2 flex justify-center">
          <button
            type="button"
            onClick={() => { setInput(suggestion.e164); dismissSuggestion(); }}
            className="group inline-flex items-center gap-2 rounded-full border border-green-200 bg-green-50 px-3 py-1.5 text-xs font-medium text-green-700 transition hover:border-green-300 hover:bg-green-100"
            title="Click to fill"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
              <path d="M8 3a2 2 0 00-2 2v1H5a2 2 0 00-2 2v9a2 2 0 002 2h10a2 2 0 002-2V8a2 2 0 00-2-2h-1V5a2 2 0 00-2-2H8zm0 2h4v1H8V5z" />
            </svg>
            <span>Paste <span className="tabular-nums">{suggestion.formatted}</span></span>
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); dismissSuggestion(); }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); dismissSuggestion(); } }}
              className="ml-1 -mr-1 rounded p-0.5 text-green-500 opacity-60 hover:bg-green-200 hover:opacity-100"
              title="Dismiss"
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" />
              </svg>
            </span>
          </button>
        </div>
      )}

      {/* ── Redial chip — last called number, when nothing typed ── */}
      {!input && !suggestion && lastCalled && (
        <div className="mb-2 flex justify-center">
          <button
            type="button"
            onClick={() => setInput(lastCalled)}
            className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:border-gray-300 hover:bg-gray-100"
            title="Redial last number"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
              <path fillRule="evenodd" d="M10 3a7 7 0 100 14 7 7 0 000-14zm0-2a9 9 0 110 18 9 9 0 010-18z" clipRule="evenodd" opacity="0" />
              <path d="M4 2v4h4M4.6 5.5A6 6 0 1110 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Redial <span className="tabular-nums">{formatForDisplay(lastCalled)}</span>
          </button>
        </div>
      )}

      {/* ── Number Display ── */}
      <div className="flex flex-col items-center gap-1 py-3">
        <div className="text-3xl font-light tracking-wider text-gray-900 min-h-[2.25rem]">
          {input || <span className="text-gray-300">Enter number</span>}
        </div>
        <div className="text-xs text-gray-500 min-h-[1rem]">
          {input && (norm.ok ? `${norm.country ?? ''} • ${norm.national}` : norm.reason ?? '')}
        </div>
      </div>

      {/* ── Keypad ── */}
      <div className="mt-2 grid grid-cols-3 gap-3">
        {KEYS.map((k) => (
          <button
            key={k.d}
            type="button"
            onClick={() => press(k.d)}
            className="flex h-16 flex-col items-center justify-center rounded-full bg-gray-100 text-2xl font-light text-gray-900 transition active:bg-gray-300"
          >
            <span>{k.d}</span>
            {k.sub && <span className="text-[10px] tracking-widest text-gray-500">{k.sub}</span>}
          </button>
        ))}
      </div>

      {/* ── Call / Backspace row ── */}
      <div className="mt-4 flex items-center justify-center gap-6">
        <span className="w-10" />
        <button
          type="button"
          onClick={call}
          disabled={!ready || !input}
          title={ready ? 'Call' : `Device ${deviceState}`}
          className="flex h-16 w-16 items-center justify-center rounded-full bg-green-500 text-white shadow-md transition hover:bg-green-600 disabled:bg-gray-300"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-7 w-7">
            <path d="M6.62 10.79a15.05 15.05 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1.05-.24c1.16.39 2.41.6 3.7.6a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A18 18 0 0 1 3 3a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.3.21 2.54.6 3.7a1 1 0 0 1-.24 1.05l-2.24 2.04Z" />
          </svg>
        </button>
        <button
          type="button"
          onClick={backspace}
          disabled={!input}
          className="flex h-10 w-10 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 disabled:opacity-30"
          title="Backspace"
        >
          ⌫
        </button>
      </div>
    </div>
  );
}
