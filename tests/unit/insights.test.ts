import { describe, it, expect, beforeAll, vi } from 'vitest';
import {
  briefForNumber,
  collectPromises,
  insightRequestBody,
  isSummarizable,
  normalizeInsight,
  sameNumber,
  todayBrief,
} from '../../src/shared/insights-core';
import type { CallEntry } from '../../src/shared/ai-context';
import type { CallInsight, CallPromise, Transcript, TranscriptSegment } from '../../src/shared/types';

beforeAll(() => {
  vi.stubEnv('TZ', 'UTC');
});

const NOW = Date.UTC(2026, 9, 4, 12, 0, 0); // Sun 2026-10-04
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const promise = (over: Partial<CallPromise> & { id: string }): CallPromise => ({
  text: 'Send case study',
  who: 'me',
  ...over,
});

const insight = (promises: CallPromise[], over: Partial<CallInsight> = {}): CallInsight => ({
  summary: 'Jane liked the demo but pushed back on price.',
  objections: ['Too expensive'],
  promises,
  model: 'gpt-5-mini',
  createdAt: NOW,
  v: 1,
  ...over,
});

const call = (over: Partial<CallEntry> & { key: string }): CallEntry => ({
  number: '+14155550100',
  direction: 'out',
  startedAt: NOW - DAY,
  durationSec: 120,
  status: 'completed',
  ...over,
});

describe('sameNumber', () => {
  it('matches across formatting and country-code differences', () => {
    expect(sameNumber('+14155550100', '(415) 555-0100')).toBe(true);
    expect(sameNumber('+14155550100', '4155550100')).toBe(true);
    expect(sameNumber('+14155550100', '+14155550199')).toBe(false);
  });

  it('never matches empty or non-numeric values', () => {
    expect(sameNumber('Unknown', 'Unknown')).toBe(false);
    expect(sameNumber('', '')).toBe(false);
    expect(sameNumber('123', '123')).toBe(false);
  });
});

describe('normalizeInsight', () => {
  it('assigns promise ids and stamps model/time', () => {
    const r = normalizeInsight(
      {
        summary: 'Good call.',
        objections: ['Price'],
        promises: [
          { text: 'Send deck', who: 'me', due: '2026-10-06', ts: 30 },
          { text: 'Ask CFO', who: 'them' },
        ],
        nextStep: 'Send deck',
      },
      'gpt-5-mini',
      NOW,
    );
    expect(r).toEqual({
      summary: 'Good call.',
      objections: ['Price'],
      promises: [
        { id: 'p1', text: 'Send deck', who: 'me', due: '2026-10-06', ts: 30 },
        { id: 'p2', text: 'Ask CFO', who: 'them' },
      ],
      nextStep: 'Send deck',
      model: 'gpt-5-mini',
      createdAt: NOW,
      v: 1,
    });
  });

  it('rejects malformed payloads', () => {
    expect(normalizeInsight(null, 'm', NOW)).toBeNull();
    expect(normalizeInsight({ summary: '' , objections: [], promises: [] }, 'm', NOW)).toBeNull();
    expect(normalizeInsight({ summary: 'x', objections: 'nope', promises: [] }, 'm', NOW)).toBeNull();
  });
});

describe('collectPromises', () => {
  const calls = [
    call({ key: 'CA1', sid: 'CA1', contactName: 'Jane Doe', insight: insight([
      promise({ id: 'p1', due: '2026-10-06' }),
      promise({ id: 'p2', text: 'Old thing', done: true }),
    ]) }),
    call({ key: 'CA2', sid: 'CA2', startedAt: NOW - 2 * DAY, insight: insight([
      promise({ id: 'p1', text: 'Send contract', who: 'them', due: '2026-10-02' }),
      promise({ id: 'p2', text: 'Check pricing' }),
    ]) }),
    call({ key: 'h3' }),
  ];

  it('returns open promises: dated first by due date, then undated newest call first', () => {
    const items = collectPromises(calls);
    expect(items.map((i) => i.promise.text)).toEqual(['Send contract', 'Send case study', 'Check pricing']);
    expect(items[1]).toMatchObject({ callSid: 'CA1', contactName: 'Jane Doe', number: '+14155550100' });
  });

  it('can include completed ones', () => {
    expect(collectPromises(calls, { includeDone: true })).toHaveLength(4);
  });
});

describe('todayBrief', () => {
  it('lists promises due today or overdue, plus fresh undated ones I made', () => {
    const calls = [
      call({ key: 'CA1', sid: 'CA1', insight: insight([
        promise({ id: 'p1', text: 'Overdue', due: '2026-10-01' }),
        promise({ id: 'p2', text: 'Today', due: '2026-10-04' }),
        promise({ id: 'p3', text: 'Future', due: '2026-10-09' }),
        promise({ id: 'p4', text: 'Fresh undated' }),
        promise({ id: 'p5', text: 'Their undated', who: 'them' }),
        promise({ id: 'p6', text: 'Done', due: '2026-10-01', done: true }),
      ]) }),
      call({ key: 'CA2', sid: 'CA2', startedAt: NOW - 10 * DAY, insight: insight([
        promise({ id: 'p1', text: 'Stale undated' }),
      ]) }),
    ];
    const b = todayBrief(calls, NOW);
    expect(b.due.map((d) => d.promise.text)).toEqual(['Overdue', 'Today', 'Fresh undated']);
  });

  it('lists missed calls that were never returned, once per number', () => {
    const calls = [
      call({ key: 'm1', direction: 'in', status: 'missed', durationSec: 0, number: '+14155550111', startedAt: NOW - 2 * HOUR }),
      call({ key: 'm2', direction: 'in', status: 'missed', durationSec: 0, number: '+14155550111', startedAt: NOW - 5 * HOUR }),
      // Returned: called back after the miss.
      call({ key: 'm3', direction: 'in', status: 'missed', durationSec: 0, number: '+14155550122', startedAt: NOW - 6 * HOUR }),
      call({ key: 'c3', direction: 'out', number: '4155550122', startedAt: NOW - 3 * HOUR }),
      // Called before the miss — does not count as returned.
      call({ key: 'm4', direction: 'in', status: 'missed', durationSec: 0, number: '+14155550133', startedAt: NOW - 1 * HOUR, contactName: 'Sam' }),
      call({ key: 'c4', direction: 'out', number: '+14155550133', startedAt: NOW - 2 * DAY }),
      // Too old.
      call({ key: 'm5', direction: 'in', status: 'missed', durationSec: 0, number: '+14155550144', startedAt: NOW - 9 * DAY }),
      // No usable number.
      call({ key: 'm6', direction: 'in', status: 'missed', durationSec: 0, number: 'Unknown', startedAt: NOW - HOUR }),
    ];
    const b = todayBrief(calls, NOW);
    expect(b.missed).toEqual([
      { number: '+14155550133', contactName: 'Sam', lastMissedAt: NOW - 1 * HOUR, count: 1 },
      { number: '+14155550111', contactName: undefined, lastMissedAt: NOW - 2 * HOUR, count: 2 },
    ]);
  });

  it('is empty when there is nothing to do', () => {
    expect(todayBrief([call({ key: 'h1' })], NOW)).toEqual({ due: [], missed: [] });
  });
});

describe('briefForNumber', () => {
  const calls = [
    call({ key: 'h9', number: '+14155550100', startedAt: NOW - HOUR, durationSec: 0, status: 'failed' }),
    call({ key: 'CA1', sid: 'CA1', contactName: 'Jane Doe', durationSec: 372, insight: insight([
      promise({ id: 'p1' }),
      promise({ id: 'p2', text: 'Done one', done: true }),
    ]) }),
    call({ key: 'CA0', sid: 'CA0', startedAt: NOW - 9 * DAY, insight: insight(
      [promise({ id: 'p1', text: 'Older promise', who: 'them' })],
      { summary: 'First intro call.', objections: [] },
    ) }),
    call({ key: 'other', number: '+14155559999', sid: 'CAx', insight: insight([promise({ id: 'p1', text: 'Not mine' })]) }),
  ];

  it('summarises history with a number from the latest call that has notes', () => {
    const b = briefForNumber('(415) 555-0100', calls);
    expect(b).not.toBeNull();
    expect(b!.callCount).toBe(3);
    expect(b!.lastCallAt).toBe(NOW - HOUR);
    expect(b!.contactName).toBe('Jane Doe');
    expect(b!.summary).toBe('Jane liked the demo but pushed back on price.');
    expect(b!.summaryAt).toBe(NOW - DAY);
    expect(b!.objections).toEqual(['Too expensive']);
    expect(b!.detailSid).toBe('CA1');
    expect(b!.openPromises.map((p) => p.promise.text)).toEqual(['Send case study', 'Older promise']);
  });

  it('still returns a brief when there are calls but no notes', () => {
    const b = briefForNumber('+14155550100', [call({ key: 'h1' })]);
    expect(b).toMatchObject({ callCount: 1, objections: [], openPromises: [] });
    expect(b!.summary).toBeUndefined();
  });

  it('returns null for unknown or unusable numbers', () => {
    expect(briefForNumber('+14155550000', calls)).toBeNull();
    expect(briefForNumber('415', calls)).toBeNull();
  });
});

describe('isSummarizable / insightRequestBody', () => {
  const seg = (speaker: 'user' | 'remote', text: string, ts: number): TranscriptSegment => ({
    ts,
    speaker,
    text,
    isFinal: true,
  });
  const base: Transcript = {
    callSid: 'CA1',
    segments: [],
    startedAt: NOW - DAY,
    endedAt: NOW - DAY + 60_000,
    direction: 'out',
    remoteNumber: '+14155550100',
    contactSnapshot: { id: '1', name: 'Jane Doe', portalUrl: 'x' },
    createdAt: NOW - DAY,
  };

  it('skips calls with no real conversation', () => {
    expect(isSummarizable({ ...base, segments: [seg('user', 'Hello?', 0)] })).toBe(false);
    expect(isSummarizable({ ...base, segments: [seg('user', 'word '.repeat(80), 0)] })).toBe(false);
    expect(
      isSummarizable({
        ...base,
        segments: [seg('user', 'word '.repeat(30), 0), seg('remote', 'word '.repeat(30), 5000)],
      }),
    ).toBe(true);
  });

  it('builds the request with timestamps, local call date and contact', () => {
    const body = insightRequestBody({
      ...base,
      segments: [seg('user', 'I will send it Thursday', 65_000)],
    });
    expect(body).toEqual({
      transcript: '[01:05] You: I will send it Thursday',
      callDate: '2026-10-03',
      direction: 'out',
      contactName: 'Jane Doe',
    });
  });

  it('caps very long transcripts', () => {
    const body = insightRequestBody({
      ...base,
      segments: Array.from({ length: 5000 }, (_, i) => seg('user', 'word '.repeat(20), i * 1000)),
    });
    expect(body.transcript.length).toBeLessThanOrEqual(180_000);
  });
});
