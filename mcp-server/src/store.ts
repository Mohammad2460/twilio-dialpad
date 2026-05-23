import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { CallFileSchema, IndexEntrySchema, type CallFile, type IndexEntry } from './schemas.js';

export class CallStore {
  constructor(private folder: string) {}

  /** Reads index.json — fast list of all calls with summary metadata. */
  async readIndex(): Promise<IndexEntry[]> {
    const path = join(this.folder, 'index.json');
    if (!existsSync(path)) return [];
    try {
      const raw = await readFile(path, 'utf8');
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      const out: IndexEntry[] = [];
      for (const item of parsed) {
        const r = IndexEntrySchema.safeParse(item);
        if (r.success) out.push(r.data);
      }
      return out;
    } catch {
      return [];
    }
  }

  /** Reads a single call's full file (meta + transcript). */
  async readCall(callSid: string): Promise<CallFile | null> {
    const path = join(this.folder, 'calls', `${callSid}.json`);
    if (!existsSync(path)) return null;
    try {
      const raw = await readFile(path, 'utf8');
      const parsed = JSON.parse(raw);
      const r = CallFileSchema.safeParse(parsed);
      return r.success ? r.data : null;
    } catch {
      return null;
    }
  }

  /** Reads all call files. Slow — only use for search / export. */
  async readAllCalls(): Promise<CallFile[]> {
    const dir = join(this.folder, 'calls');
    if (!existsSync(dir)) return [];
    let files: string[] = [];
    try { files = await readdir(dir); } catch { return []; }
    const out: CallFile[] = [];
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const callSid = f.replace(/\.json$/, '');
      const c = await this.readCall(callSid);
      if (c) out.push(c);
    }
    // Most recent first.
    out.sort((a, b) => b.meta.startedAt - a.meta.startedAt);
    return out;
  }

  /** Helper — full-text search over transcript segments. */
  async searchTranscripts(query: string, opts: {
    dateFrom?: number;
    dateTo?: number;
    direction?: 'in' | 'out' | 'all';
    limit?: number;
  } = {}): Promise<Array<{ call: CallFile; matches: Array<{ ts: number; speaker: string; text: string }> }>> {
    const q = query.toLowerCase().trim();
    if (!q) return [];
    const all = await this.readAllCalls();
    const direction = opts.direction ?? 'all';
    const limit = opts.limit ?? 50;
    const results: Array<{ call: CallFile; matches: Array<{ ts: number; speaker: string; text: string }> }> = [];
    for (const c of all) {
      if (direction !== 'all' && c.meta.direction !== direction) continue;
      if (opts.dateFrom && c.meta.startedAt < opts.dateFrom) continue;
      if (opts.dateTo && c.meta.startedAt > opts.dateTo) continue;
      const matches: Array<{ ts: number; speaker: string; text: string }> = [];
      const segs = c.transcript?.segments ?? [];
      for (const s of segs) {
        if (s.text.toLowerCase().includes(q)) {
          matches.push({ ts: s.ts, speaker: s.speaker, text: s.text });
        }
      }
      if (matches.length > 0) results.push({ call: c, matches });
      if (results.length >= limit) break;
    }
    return results;
  }
}
