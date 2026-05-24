/**
 * DBCallStore — reads call data from Supabase Postgres.
 * Mirrors the interface of CallStore (mcp-server/src/store.ts) so MCP tools
 * can call it without caring about the underlying storage.
 */
import { supabase } from './supabase';
import type { CallFile, IndexEntry } from './schemas';

export class DBCallStore {
  constructor(private userId: string) {}

  /** Confirm user row exists — used by API routes to authenticate requests. */
  async userExists(): Promise<boolean> {
    const { data, error } = await supabase
      .from('users')
      .select('id')
      .eq('id', this.userId)
      .maybeSingle();
    return !error && data !== null;
  }

  /** Fast list of all calls (no transcript body). Sorted newest-first. */
  async readIndex(limit = 500): Promise<IndexEntry[]> {
    const { data, error } = await supabase
      .from('calls')
      .select('call_sid, direction, number, started_at, duration_sec, status, has_transcript')
      .eq('user_id', this.userId)
      .order('started_at', { ascending: false })
      .limit(limit);

    if (error || !data) return [];

    return data.map((r) => ({
      sid: r.call_sid,
      direction: r.direction as 'in' | 'out',
      number: r.number,
      startedAt: r.started_at,
      durationSec: r.duration_sec,
      status: r.status as 'completed' | 'missed' | 'failed',
      hasTranscript: r.has_transcript ?? false,
    }));
  }

  /** Full call record (meta + optional transcript) for one callSid. */
  async readCall(callSid: string): Promise<CallFile | null> {
    const { data, error } = await supabase
      .from('calls')
      .select('call_sid, direction, number, started_at, duration_sec, status, contact, transcript')
      .eq('user_id', this.userId)
      .eq('call_sid', callSid)
      .maybeSingle();

    if (error || !data) return null;
    return rowToCallFile(data);
  }

  /** All calls with transcripts. Slow — only for search/export. */
  async readAllCalls(): Promise<CallFile[]> {
    const { data, error } = await supabase
      .from('calls')
      .select('call_sid, direction, number, started_at, duration_sec, status, contact, transcript')
      .eq('user_id', this.userId)
      .order('started_at', { ascending: false });

    if (error || !data) return [];
    return data.map(rowToCallFile);
  }

  /** Case-insensitive full-text search across transcript segments. */
  async searchTranscripts(
    query: string,
    opts: {
      dateFrom?: number;
      dateTo?: number;
      direction?: 'in' | 'out' | 'all';
      limit?: number;
    } = {},
  ): Promise<Array<{ call: CallFile; matches: Array<{ ts: number; speaker: string; text: string }> }>> {
    const q = query.toLowerCase().trim();
    if (!q) return [];

    const limit = opts.limit ?? 50;

    let qb = supabase
      .from('calls')
      .select('call_sid, direction, number, started_at, duration_sec, status, contact, transcript')
      .eq('user_id', this.userId)
      // Cast JSONB transcript to text for substring match — fast enough for beta
      .ilike('transcript::text', `%${q}%`)
      .order('started_at', { ascending: false })
      .limit(limit);

    if (opts.direction && opts.direction !== 'all') {
      qb = qb.eq('direction', opts.direction);
    }
    if (opts.dateFrom) {
      qb = qb.gte('started_at', opts.dateFrom);
    }
    if (opts.dateTo) {
      qb = qb.lte('started_at', opts.dateTo);
    }

    const { data, error } = await qb;
    if (error || !data) return [];

    const results: Array<{ call: CallFile; matches: Array<{ ts: number; speaker: string; text: string }> }> = [];

    for (const row of data) {
      const call = rowToCallFile(row);
      const segs = call.transcript?.segments ?? [];
      const matches = segs
        .filter((s) => s.text.toLowerCase().includes(q))
        .map((s) => ({ ts: s.ts, speaker: s.speaker, text: s.text }));
      if (matches.length > 0) results.push({ call, matches });
    }

    return results;
  }
}

// ── helpers ──────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToCallFile(r: any): CallFile {
  return {
    meta: {
      callSid: r.call_sid,
      direction: r.direction as 'in' | 'out',
      number: r.number,
      startedAt: r.started_at,
      durationSec: r.duration_sec,
      status: r.status as 'completed' | 'missed' | 'failed',
      contact: r.contact ?? undefined,
    },
    transcript: r.transcript ?? undefined,
  };
}
