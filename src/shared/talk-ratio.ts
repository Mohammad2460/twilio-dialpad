import type { TranscriptSegment } from './types';

export interface TalkRatio {
  userMs: number;
  remoteMs: number;
  /** 0–100, rounded. 0 when there is no measured speaking time. */
  userPct: number;
  remotePct: number;
  /** True when no segment carried a duration (legacy transcripts) — ratio unknown. */
  unknown: boolean;
}

/**
 * Accurate talk-to-listen ratio = summed spoken duration per speaker.
 * Uses `durationMs` (from Deepgram). Final segments only, to avoid
 * double-counting interim results. Falls back to `unknown` when no durations
 * are present (older transcripts captured before segment timing existed).
 */
export function computeTalkRatio(segments: TranscriptSegment[]): TalkRatio {
  let userMs = 0;
  let remoteMs = 0;
  let sawDuration = false;

  for (const seg of segments) {
    if (!seg.isFinal) continue;
    if (typeof seg.durationMs !== 'number' || seg.durationMs <= 0) continue;
    sawDuration = true;
    if (seg.speaker === 'user') userMs += seg.durationMs;
    else remoteMs += seg.durationMs;
  }

  const total = userMs + remoteMs;
  if (!sawDuration || total === 0) {
    return { userMs, remoteMs, userPct: 0, remotePct: 0, unknown: true };
  }
  const userPct = Math.round((userMs / total) * 100);
  return { userMs, remoteMs, userPct, remotePct: 100 - userPct, unknown: false };
}
