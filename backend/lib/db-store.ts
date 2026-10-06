/**
 * DBCallStore — reads call data from Supabase Postgres.
 * Mirrors the interface of CallStore (mcp-server/src/store.ts) so MCP tools
 * can call it without caring about the underlying storage.
 */
import { supabase } from './supabase';
import type { CallFile, IndexEntry } from './schemas';

export class DBCallStore {
  /**
   * @param maxCalls When set, every read is limited to the user's newest
   *   `maxCalls` calls (the Free plan's connector window). null = all calls.
   * @param withContact false leaves the HubSpot contact snapshot out of every
   *   read (Free plan): snapshots stored while the user was on Pro stay hidden.
   */
  constructor(
    private userId: string,
    private maxCalls: number | null = null,
    private withContact = true,
  ) {}

  private toCallFile = (row: unknown): CallFile => {
    const call = rowToCallFile(row);
    if (!this.withContact) delete call.meta.contact;
    return call;
  };

  /** SIDs of the newest `maxCalls` calls, or null when there is no window. */
  private async windowSids(): Promise<string[] | null> {
    if (this.maxCalls === null) return null;
    if (this.maxCalls <= 0) return [];
    const { data, error } = await supabase
      .from('calls')
      .select('call_sid')
      .eq('user_id', this.userId)
      .order('started_at', { ascending: false })
      .limit(this.maxCalls);
    // Fail closed: an unreadable window shows nothing rather than everything.
    if (error || !data) return [];
    return data.map((r) => r.call_sid as string);
  }

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
      .limit(this.maxCalls === null ? limit : Math.min(limit, this.maxCalls));

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
    const sids = await this.windowSids();
    if (sids && !sids.includes(callSid)) return null;
    const { data, error } = await supabase
      .from('calls')
      .select('call_sid, direction, number, started_at, duration_sec, status, contact, transcript')
      .eq('user_id', this.userId)
      .eq('call_sid', callSid)
      .maybeSingle();

    if (error || !data) return null;
    return this.toCallFile(data);
  }

  /** All calls with transcripts. Slow — only for search/export. */
  async readAllCalls(): Promise<CallFile[]> {
    let qb = supabase
      .from('calls')
      .select('call_sid, direction, number, started_at, duration_sec, status, contact, transcript')
      .eq('user_id', this.userId)
      .order('started_at', { ascending: false });
    if (this.maxCalls !== null) qb = qb.limit(Math.max(this.maxCalls, 0));
    const { data, error } = await qb;

    if (error || !data) return [];
    return data.map(this.toCallFile);
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
    const sids = await this.windowSids();
    if (sids && sids.length === 0) return [];

    let qb = supabase
      .from('calls')
      .select('call_sid, direction, number, started_at, duration_sec, status, contact, transcript')
      .eq('user_id', this.userId)
      // Cast JSONB transcript to text for substring match — fast enough for beta
      .ilike('transcript::text', `%${q}%`)
      .order('started_at', { ascending: false })
      .limit(limit);

    if (sids) qb = qb.in('call_sid', sids);
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
      const call = this.toCallFile(row);
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
