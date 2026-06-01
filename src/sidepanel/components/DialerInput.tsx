import { useMemo, useState } from 'react';
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
    // Split on first comma OR semicolon to extract optional label
    const sepIdx = line.search(/[,;\t]/);
    const numberPart = sepIdx === -1 ? line : line.slice(0, sepIdx).trim();
    const label = sepIdx === -1 ? undefined : line.slice(sepIdx + 1).trim() || undefined;

    const norm = normalizeE164(numberPart);
    if (!norm.ok || !norm.e164) {
      invalid.push({ raw: line, reason: norm.reason ?? 'invalid' });
      continue;
    }

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

export function DialerInput() {
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ParseResult | null>(null);
  const queue = useDialerStore((s) => s.queue);
  const dncList = useDialerStore((s) => s.dncList);
  const appendToQueue = useDialerStore((s) => s.appendToQueue);

  const parsed = useMemo(() => {
    if (!text.trim()) return null;
    return parseInput(text, new Set(queue.map((q) => q.number)), new Set(dncList));
  }, [text, queue, dncList]);

  async function handleAdd() {
    if (!parsed || parsed.valid.length === 0) return;
    setSubmitting(true);
    try {
      const added = await appendToQueue(parsed.valid);
      setResult({ valid: added, invalid: parsed.invalid, duplicates: parsed.duplicates });
      setText('');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-3 p-4">
      <div>
        <label htmlFor="dialer-input" className="block text-sm font-medium text-gray-700">
          Paste numbers
        </label>
        <p className="mt-0.5 text-xs text-gray-500">
          One per line. Optional label after a comma. Invalid lines and DNC numbers are skipped.
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

      {result && result.valid.length > 0 && (
        <p className="text-xs text-green-700">✓ Added {result.valid.length} numbers to queue.</p>
      )}
    </div>
  );
}
