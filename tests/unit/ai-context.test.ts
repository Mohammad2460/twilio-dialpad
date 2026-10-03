import { describe, it, expect, beforeAll, vi } from 'vitest';
import {
  buildCallDigest,
  estimateTokens,
  truncateToTokens,
  formatTranscriptText,
  localDate,
  mergeCalls,
  splitCitations,
} from '../../src/shared/ai-context';
import type { CallInsight, CallRecord, Transcript, TranscriptSegment } from '../../src/shared/types';

beforeAll(() => {
  vi.stubEnv('TZ', 'UTC');
});

const NOW = Date.UTC(2026, 9, 4, 12, 0, 0); // Sun 2026-10-04 12:00 UTC
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const seg = (speaker: 'user' | 'remote', text: string, ts = 0): TranscriptSegment => ({
  ts,
  speaker,
  text,
  isFinal: true,
});

function transcript(over: Partial<Transcript> & { callSid: string }): Transcript {
  return {
    segments: [seg('user', 'Hi there'), seg('remote', 'Hello', 2000)],
    startedAt: NOW - DAY,
    endedAt: NOW - DAY + 372_000,
    direction: 'out',
    remoteNumber: '+14155550100',
    createdAt: NOW - DAY,
    ...over,
  };
}

function record(over: Partial<CallRecord> & { id: string }): CallRecord {
  return {
    direction: 'out',
    number: '+14155550100',
    startedAt: NOW - DAY,
    durationSec: 60,
    status: 'completed',
    ...over,
  };
}

const insight = (over: Partial<CallInsight> = {}): CallInsight => ({
  summary: 'Jane liked the demo but pushed back on price.',
  objections: ['Too expensive'],
  promises: [{ id: 'p1', text: 'Send case study', who: 'me', due: '2026-10-01' }],
  nextStep: 'Email the case study',
  model: 'gpt-5-mini',
  createdAt: NOW,
  v: 1,
  ...over,
});

describe('formatTranscriptText', () => {
  it('labels speakers and skips interim segments', () => {
    const text = formatTranscriptText([
      seg('user', 'Hi'),
      { ...seg('remote', 'partial'), isFinal: false },
      seg('remote', 'Hello'),
    ]);
    expect(text).toBe('You: Hi\nCaller: Hello');
  });

  it('adds mm:ss stamps when asked', () => {
    expect(formatTranscriptText([seg('remote', 'Send it Thursday', 65_000)], { timestamps: true })).toBe(
      '[01:05] Caller: Send it Thursday',
    );
  });
});

describe('localDate', () => {
  it('formats YYYY-MM-DD in local time', () => {
    expect(localDate(NOW)).toBe('2026-10-04');
  });
});

describe('mergeCalls', () => {
  it('unifies transcripts and history, newest first, without duplicates', () => {
    const calls = mergeCalls(
      [
        record({ id: 'h1', sid: 'CA1', startedAt: NOW - DAY, hasTranscript: true }),
        record({ id: 'h2', startedAt: NOW - HOUR, direction: 'in', status: 'missed', durationSec: 0, number: '+14155550199' }),
      ],
      [transcript({ callSid: 'CA1' }), transcript({ callSid: 'CA0', startedAt: NOW - 30 * DAY, endedAt: NOW - 30 * DAY + 60_000 })],
    );
    expect(calls.map((c) => c.key)).toEqual(['h2', 'CA1', 'CA0']);
    expect(calls[1].segments).toHaveLength(2);
    expect(calls[2].durationSec).toBe(60);
    expect(calls[0].status).toBe('missed');
  });

  it('prefers the history record for status/duration and the contact name from either source', () => {
    const calls = mergeCalls(
      [record({ id: 'h1', sid: 'CA1', durationSec: 372, contact: { id: '1', name: 'Jane Doe', portalUrl: 'x' } })],
      [transcript({ callSid: 'CA1' })],
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].contactName).toBe('Jane Doe');
    expect(calls[0].durationSec).toBe(372);
  });
});

describe('mergeCalls — numbers', () => {
  it('takes the number from the history record when the transcript has none', () => {
    const calls = mergeCalls(
      [record({ id: 'h1', sid: 'CA1', number: '+14155550100' })],
      [transcript({ callSid: 'CA1', remoteNumber: '' })],
    );
    expect(calls[0].number).toBe('+14155550100');
  });

  it('keeps the transcript number when the history record has no usable one', () => {
    const calls = mergeCalls(
      [record({ id: 'h1', sid: 'CA1', number: 'Unknown' })],
      [transcript({ callSid: 'CA1', remoteNumber: '+14155550100' })],
    );
    expect(calls[0].number).toBe('+14155550100');
  });
});

describe('buildCallDigest', () => {
  it('starts with today and numbers calls newest first', () => {
    const calls = mergeCalls([], [
      transcript({ callSid: 'CA_old', startedAt: NOW - 5 * DAY, endedAt: NOW - 5 * DAY + 60_000 }),
      transcript({ callSid: 'CA_new' }),
    ]);
    const d = buildCallDigest(calls, { now: NOW });
    expect(d.text.startsWith('Today: Sunday 2026-10-04')).toBe(true);
    expect(d.text.indexOf('[C1]')).toBeLessThan(d.text.indexOf('[C2]'));
    expect(d.refs.C1.sid).toBe('CA_new');
    expect(d.refs.C2.sid).toBe('CA_old');
    expect(d.text).toContain('[C1] Sat 2026-10-03 12:00 · outgoing · +14155550100 · 6m 12s · completed');
    expect(d.text).toContain('You: Hi there');
    expect(d.stats).toEqual({ calls: 2, full: 2, notes: 0, headerOnly: 0 });
  });

  it('includes the contact name and stored notes alongside the transcript', () => {
    const calls = mergeCalls([], [
      transcript({
        callSid: 'CA1',
        contactSnapshot: { id: '1', name: 'Jane Doe', portalUrl: 'x' },
        insight: insight({ promises: [{ id: 'p1', text: 'Send case study', who: 'me', due: '2026-10-01', done: true }] }),
      }),
    ]);
    const d = buildCallDigest(calls, { now: NOW });
    expect(d.text).toContain('+14155550100 (Jane Doe)');
    expect(d.text).toContain('Summary: Jane liked the demo');
    expect(d.text).toContain('Objections: Too expensive');
    expect(d.text).toContain('Send case study (you, due 2026-10-01, done)');
    expect(d.text).toContain('Next step: Email the case study');
  });

  it('falls back to notes, then header only, once the budget is spent', () => {
    const long = Array.from({ length: 400 }, (_, i) => seg(i % 2 ? 'remote' : 'user', 'word '.repeat(20), i * 1000));
    const calls = mergeCalls([], [
      transcript({ callSid: 'CA1', segments: long }),
      transcript({ callSid: 'CA2', segments: long, startedAt: NOW - 2 * DAY, endedAt: NOW - 2 * DAY + 60_000, insight: insight() }),
      transcript({ callSid: 'CA3', segments: long, startedAt: NOW - 3 * DAY, endedAt: NOW - 3 * DAY + 60_000 }),
    ]);
    const oneCall = estimateTokens(formatTranscriptText(long));
    const d = buildCallDigest(calls, { now: NOW, budgetTokens: oneCall + 400, perCallTokens: oneCall + 100 });
    expect(d.stats).toEqual({ calls: 3, full: 1, notes: 1, headerOnly: 1 });
    expect(d.text).toContain('[C2]');
    expect(d.text).toContain('Summary: Jane liked the demo');
    expect(d.text).toContain('[C3]');
    expect(estimateTokens(d.text)).toBeLessThanOrEqual(oneCall + 400);
  });

  it('truncates a single oversized transcript instead of dropping it', () => {
    const long = Array.from({ length: 400 }, (_, i) => seg('user', 'word '.repeat(20), i * 1000));
    const calls = mergeCalls([], [transcript({ callSid: 'CA1', segments: long })]);
    const d = buildCallDigest(calls, { now: NOW, perCallTokens: 500 });
    expect(d.stats.full).toBe(1);
    expect(d.text).toContain('[transcript truncated]');
    expect(estimateTokens(d.text)).toBeLessThan(800);
  });

  it('keeps missed calls visible as header-only lines', () => {
    const calls = mergeCalls(
      [record({ id: 'h1', direction: 'in', status: 'missed', durationSec: 0, startedAt: NOW - HOUR })],
      [],
    );
    const d = buildCallDigest(calls, { now: NOW });
    expect(d.text).toContain('[C1] Sun 2026-10-04 11:00 · incoming · +14155550100 · missed');
    expect(d.refs.C1.sid).toBeUndefined();
  });

  it('caps the number of calls', () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      record({ id: `h${i}`, startedAt: NOW - i * HOUR }),
    );
    const d = buildCallDigest(mergeCalls(many, []), { now: NOW, maxCalls: 10 });
    expect(d.stats.calls).toBe(10);
    expect(d.text).not.toContain('[C11]');
  });

  it('says so when there are no calls', () => {
    const d = buildCallDigest([], { now: NOW });
    expect(d.text).toContain('(no calls yet)');
    expect(d.refs).toEqual({});
  });
});

describe('splitCitations', () => {
  it('splits answer text into text and citation parts', () => {
    expect(splitCitations('Jane objected on price [C3]. See also [C12][C1].')).toEqual([
      { type: 'text', text: 'Jane objected on price ' },
      { type: 'cite', ref: 'C3' },
      { type: 'text', text: '. See also ' },
      { type: 'cite', ref: 'C12' },
      { type: 'cite', ref: 'C1' },
      { type: 'text', text: '.' },
    ]);
  });

  it('returns plain text untouched', () => {
    expect(splitCitations('No calls match.')).toEqual([{ type: 'text', text: 'No calls match.' }]);
  });
});

describe('token budget for non-Latin text', () => {
  it('counts other scripts at one token per character and truncates to fit', () => {
    expect(estimateTokens('abcdefgh')).toBe(2);
    expect(estimateTokens('你好你好')).toBe(4);
    expect(truncateToTokens('你好你好你好', 4)).toBe('你好你好');
    expect(truncateToTokens('abcdefghij', 2)).toBe('abcdefgh');
  });
});
