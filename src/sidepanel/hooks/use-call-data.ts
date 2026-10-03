import { useCallback, useEffect, useMemo, useState } from 'react';
import { useCallStore } from '../stores/call-store';
import { mergeCalls, type CallEntry } from '@shared/ai-context';
import { onInsightChange } from '@shared/insights';
import { transcripts } from '@shared/transcripts';
import type { TranscriptMeta } from '@shared/types';

/**
 * Every call this device knows about — transcripts (with their AI notes) merged
 * with recent history, newest first. Segment bodies are left out; this feeds the
 * views that only need call meta + insight (Today, promises, pre-call brief).
 * Refreshes when history changes or an insight is written.
 */
export function useCallData(): { calls: CallEntry[]; loaded: boolean } {
  const history = useCallStore((s) => s.history);
  const [metas, setMetas] = useState<TranscriptMeta[]>([]);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(() => {
    transcripts
      .listMeta(200)
      .then(setMetas)
      .catch((e) => console.warn('[call-data] transcript load failed', e))
      .finally(() => setLoaded(true));
  }, []);

  // history.length: a finished call adds a record right after its transcript is saved.
  useEffect(reload, [reload, history.length]);
  useEffect(() => onInsightChange(reload), [reload]);

  const calls = useMemo(() => mergeCalls(history, metas), [history, metas]);
  return { calls, loaded };
}
