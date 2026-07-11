import { useMemo, useRef, useState } from 'react';
import { normalizeE164 } from '@shared/phone';
import type { DialerQueueItem } from '@shared/types';
import { useDialerStore } from '../stores/dialer-store';

interface ParseResult {
  valid: DialerQueueItem[];
  invalid: { raw: string; reason: string }[];
  duplicates: string[];
}

/**
 * Parse pasted text. Accepts one number per line; optional comma-separated label.
 * Examples:
 *   +14155551212
 *   +14155551212, Jane Doe
 *   415-555-1212 ; Customer A
 */
function parseInput(text: string, existingNumbers: Set<string>, dnc: Set<string>): ParseResult {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));

  const valid: DialerQueueItem[] = [];
  const invalid: { raw: string; reason: string }[] = [];
  const duplicates: string[] = [];
  const seenInPaste = new Set<string>();

  for (const line of lines) {
    // Split into fields; the phone can be in ANY column, so CSV exports like
    // "Jane Doe,+14155551212" work as well as phone-first lines. First field
    // that normalizes to E.164 wins; remaining text becomes the label.
    const fields = line.split(/[,;\t]/).map((f) => f.trim().replace(/^"|"$/g, ''));
    let norm: ReturnType<typeof normalizeE164> | null = null;
    let numberIdx = -1;
    for (let fi = 0; fi < fields.length; fi++) {
      const candidate = normalizeE164(fields[fi]);
      if (candidate.ok && candidate.e164) {
        norm = candidate;
        numberIdx = fi;
        break;
      }
    }
    if (!norm?.e164) {
      // Header rows ("name,phone") and junk lines land here — skipped.
      invalid.push({ raw: line, reason: 'no phone number found' });
      continue;
    }
    const label = fields.filter((_, fi) => fi !== numberIdx).join(' ').trim() || undefined;

    if (dnc.has(norm.e164)) {
      invalid.push({ raw: line, reason: 'On do-not-call list' });
      continue;
    }

    if (seenInPaste.has(norm.e164) || existingNumbers.has(norm.e164)) {
      duplicates.push(norm.e164);
      continue;
    }
    seenInPaste.add(norm.e164);

    valid.push({
      id: crypto.randomUUID(),
      number: norm.e164,
      label,
      status: 'pending',
    });
  }

  return { valid, invalid, duplicates };
}

/** Hard queue ceiling — keeps sessions manageable and Twilio-friendly. */
const MAX_QUEUE = 100;

export function DialerInput() {
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [capNote, setCapNote] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const queue = useDialerStore((s) => s.queue);
  const dncList = useDialerStore((s) => s.dncList);
  const appendToQueue = useDialerStore((s) => s.appendToQueue);

  const parsed = useMemo(() => {
    if (!text.trim()) return null;
    return parseInput(text, new Set(queue.map((q) => q.number)), new Set(dncList));
  }, [text, queue, dncList]);

  async function addItems(p: ParseResult) {
    if (p.valid.length === 0) {
      setResult(p);
      return;
    }
    setSubmitting(true);
    setCapNote(null);
    try {
      const room = Math.max(0, MAX_QUEUE - queue.length);
      const toAdd = p.valid.slice(0, room);
      const overflow = p.valid.length - toAdd.length;
      const added = toAdd.length > 0 ? await appendToQueue(toAdd) : [];
      setResult({ valid: added, invalid: p.invalid, duplicates: p.duplicates });
      if (overflow > 0) {
        setCapNote(`Queue holds ${MAX_QUEUE} numbers — ${overflow} not added. Clear finished calls to load more.`);
      }
      setText('');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAdd() {
    if (!parsed) return;
    await addItems(parsed);
  }

  async function handleFile(file: File) {
    const content = await file.text();
    const p = parseInput(content, new Set(queue.map((q) => q.number)), new Set(dncList));
    await addItems(p);
    if (fileRef.current) fileRef.current.value = '';
  }

  return (
    <div className="space-y-3 p-4">
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-600">Power dialing</p>
        <h1 className="mt-0.5 text-lg font-semibold text-gray-900">Auto-Dialer</h1>
      </header>

      <input
        ref={fileRef}
        type="file"
        accept=".csv,.txt,text/csv,text/plain"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
        }}
      />
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={submitting || queue.length >= MAX_QUEUE}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-gray-300 bg-gray-50 px-3 py-3 text-sm font-medium text-gray-700 transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 disabled:opacity-50"
      >
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
          <path d="M9 13a1 1 0 1 0 2 0V6.41l2.3 2.3a1 1 0 0 0 1.4-1.42l-4-4a1 1 0 0 0-1.4 0l-4 4A1 1 0 0 0 6.7 8.7L9 6.4V13Z" />
          <path d="M4 14a1 1 0 0 1 1 1v1h10v-1a1 1 0 1 1 2 0v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1a1 1 0 0 1 1-1Z" />
        </svg>
        Upload CSV or TXT — up to {MAX_QUEUE} numbers
      </button>

      <div>
        <label htmlFor="dialer-input" className="block text-xs font-medium text-gray-700">
          Or paste numbers
        </label>
        <p className="mt-0.5 text-xs text-gray-500">
          One per line — the number can be in any column. Duplicates, invalid lines and DNC numbers are skipped.
        </p>
      </div>

      <textarea
        id="dialer-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={'+1 415 555 1212, Jane Doe\n+44 20 7946 0958, ACME contact\n+91 98765 43210'}
        rows={6}
        className="w-full rounded-md border border-gray-300 bg-white p-2 font-mono text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
      />

      {parsed && (
        <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-xs">
          <div className="flex items-center gap-3">
            <span className="font-medium text-green-700">{parsed.valid.length} valid</span>
            {parsed.duplicates.length > 0 && (
              <span className="text-gray-500">{parsed.duplicates.length} dup</span>
            )}
            {parsed.invalid.length > 0 && (
              <span className="text-red-600">{parsed.invalid.length} invalid</span>
            )}
          </div>
          {parsed.invalid.length > 0 && (
            <ul className="mt-2 space-y-0.5">
              {parsed.invalid.slice(0, 5).map((item, i) => (
                <li key={i} className="truncate text-red-600">
                  <span className="font-mono">{item.raw || '(empty)'}</span>
                  <span className="text-gray-500"> — {item.reason}</span>
                </li>
              ))}
              {parsed.invalid.length > 5 && (
                <li className="text-gray-500">…and {parsed.invalid.length - 5} more</li>
              )}
            </ul>
          )}
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          disabled={!parsed || parsed.valid.length === 0 || submitting}
          onClick={handleAdd}
          className="flex-1 rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:bg-gray-300"
        >
          {submitting ? 'Adding…' : `Add ${parsed?.valid.length ?? 0} to queue`}
        </button>
        {text && (
          <button
            type="button"
            onClick={() => setText('')}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Clear
          </button>
        )}
      </div>

      {result && (result.valid.length > 0 || result.invalid.length > 0 || result.duplicates.length > 0) && (
        <div className="rounded-md border border-gray-200 bg-white px-3 py-2 text-xs">
          <span className="font-medium text-green-700">✓ {result.valid.length} added</span>
          {result.duplicates.length > 0 && <span className="text-gray-500"> · {result.duplicates.length} duplicate{result.duplicates.length === 1 ? '' : 's'}</span>}
          {result.invalid.length > 0 && <span className="text-red-600"> · {result.invalid.length} skipped</span>}
        </div>
      )}
      {capNote && <p className="text-xs text-amber-700">{capNote}</p>}
    </div>
  );
}
