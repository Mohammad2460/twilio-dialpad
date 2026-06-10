import { describe, it, expect } from 'vitest';
import { computeTalkRatio } from '../../src/shared/talk-ratio';
import type { TranscriptSegment } from '../../src/shared/types';

const seg = (s: Partial<TranscriptSegment>): TranscriptSegment => ({
  ts: 0,
  speaker: 'user',
  text: 'x',
  isFinal: true,
  ...s,
});

describe('computeTalkRatio', () => {
  it('sums per-speaker duration into percentages', () => {
    const r = computeTalkRatio([
      seg({ speaker: 'user', durationMs: 3000 }),
      seg({ speaker: 'remote', durationMs: 1000 }),
    ]);
    expect(r.unknown).toBe(false);
    expect(r.userMs).toBe(3000);
    expect(r.remoteMs).toBe(1000);
    expect(r.userPct).toBe(75);
    expect(r.remotePct).toBe(25);
  });

  it('ignores interim (non-final) segments', () => {
    const r = computeTalkRatio([
      seg({ speaker: 'user', durationMs: 1000, isFinal: false }),
      seg({ speaker: 'user', durationMs: 1000 }),
      seg({ speaker: 'remote', durationMs: 1000 }),
    ]);
    expect(r.userMs).toBe(1000);
    expect(r.userPct).toBe(50);
  });

  it('returns unknown when no segment carries a duration (legacy transcripts)', () => {
    const r = computeTalkRatio([seg({ speaker: 'user' }), seg({ speaker: 'remote' })]);
    expect(r.unknown).toBe(true);
    expect(r.userPct).toBe(0);
  });

  it('returns unknown for empty input', () => {
    expect(computeTalkRatio([]).unknown).toBe(true);
  });
});
