/**
 * AI context assembly — pure, no IO.
 *
 * The chatbox answers questions over the user's calls. The calls live on this
 * device (transcripts in IndexedDB, the last few call records in
 * chrome.storage), so the context is built here and sent with each question:
 * a "call digest" of `[C1]…[Cn]` blocks, newest first, inside a token budget.
 *
 * Budget order per call: full transcript while it fits → stored AI notes →
 * header line only. Header lines are always kept so missed and untranscribed
 * calls stay visible ("who should I call back?").
 */
import type {
  CallDirection,
  CallInsight,
  CallRecord,
  Transcript,
  TranscriptMeta,
  TranscriptSegment,
} from './types';

/** One call, whichever store it came from. */
export interface CallEntry {
  /** Stable key: the call SID when known, else the history record id. */
  key: string;
  /** Set only when a transcript exists for this call. */
  sid?: string;
  number: string;
  direction: CallDirection;
  startedAt: number;
  durationSec: number;
  status: CallRecord['status'];
  /** Incoming call the user declined. */
  declined?: boolean;
  contactName?: string;
  segments?: TranscriptSegment[];
  insight?: CallInsight;
}

/** What a `[C#]` citation points at. */
export interface CallRef {
  sid?: string;
  number: string;
  contactName?: string;
  startedAt: number;
}

export interface CallDigest {
  text: string;
  refs: Record<string, CallRef>;
  stats: { calls: number; full: number; notes: number; headerOnly: number };
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Size of a text in quarter-tokens: 1 per ASCII character, 4 per character of
 * any other script (Arabic, CJK, Cyrillic… run about one token per character).
 * Same rule as the backend's request cap (backend/lib/pricing.ts).
 */
function weight(text: string): number {
  let nonAscii = 0;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) > 0x7f) nonAscii++;
  return text.length + 3 * nonAscii;
}

export function estimateTokens(text: string): number {
  return Math.ceil(weight(text) / 4);
}

/** Longest prefix of `text` that fits in `maxTokens`. */
export function truncateToTokens(text: string, maxTokens: number): string {
  const max = maxTokens * 4;
  let w = 0;
  for (let i = 0; i < text.length; i++) {
    w += text.charCodeAt(i) > 0x7f ? 4 : 1;
    if (w > max) return text.slice(0, i);
  }
  return text;
}

/** Room left for the question, the conversation and the answer under the backend's request cap. */
const SINGLE_CALL_TOKENS = 40_000;

/** One call's transcript as chat context, cut to fit a single request. */
export function singleCallContext(segments: TranscriptSegment[]): string {
  return truncateToTokens(formatTranscriptText(segments), SINGLE_CALL_TOKENS);
}

/** Local calendar date, YYYY-MM-DD. */
export function localDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function localDateTime(ms: number): string {
  const d = new Date(ms);
  return `${DAYS[d.getDay()].slice(0, 3)} ${localDate(ms)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

/** `You: … / Caller: …` lines. Only final segments are part of the record. */
export function formatTranscriptText(
  segments: TranscriptSegment[],
  opts: { timestamps?: boolean } = {},
): string {
  return segments
    .filter((s) => s.isFinal)
    .map((s) => {
      const who = s.speaker === 'user' ? 'You' : 'Caller';
      if (!opts.timestamps) return `${who}: ${s.text}`;
      const sec = Math.floor(s.ts / 1000);
      return `[${pad(Math.floor(sec / 60))}:${pad(sec % 60)}] ${who}: ${s.text}`;
    })
    .join('\n');
}

/**
 * Unify call history (capped, has missed/failed calls) with transcripts
 * (uncapped, transcribed calls only) into one newest-first list.
 */
export function mergeCalls(
  history: CallRecord[],
  transcripts: (Transcript | TranscriptMeta)[],
): CallEntry[] {
  const bySid = new Map<string, CallEntry>();
  const out: CallEntry[] = [];

  for (const t of transcripts) {
    const entry: CallEntry = {
      key: t.callSid,
      sid: t.callSid,
      number: t.remoteNumber,
      direction: t.direction,
      startedAt: t.startedAt,
      durationSec: Math.max(0, Math.round((t.endedAt - t.startedAt) / 1000)),
      status: 'completed',
      contactName: t.contactSnapshot?.name,
      segments: 'segments' in t ? t.segments : undefined,
      insight: t.insight,
    };
    bySid.set(t.callSid, entry);
    out.push(entry);
  }

  for (const h of history) {
    const existing = h.sid ? bySid.get(h.sid) : undefined;
    if (existing) {
      // The call record is authoritative for how the call went.
      existing.status = h.status;
      existing.durationSec = h.durationSec;
      // ...and for who it was with: a transcript saved for an outgoing call can
      // be missing the dialed number.
      if (h.number && h.number !== 'Unknown') existing.number = h.number;
      existing.contactName = existing.contactName ?? h.contact?.name;
      continue;
    }
    out.push({
      key: h.sid ?? h.id,
      number: h.number,
      direction: h.direction,
      startedAt: h.startedAt,
      durationSec: h.durationSec,
      status: h.status,
      ...(h.declined ? { declined: true } : {}),
      contactName: h.contact?.name,
    });
  }

  return out.sort((a, b) => b.startedAt - a.startedAt);
}

function headerLine(ref: string, c: CallEntry): string {
  const who = c.contactName ? `${c.number} (${c.contactName})` : c.number;
  const parts = [
    `[${ref}] ${localDateTime(c.startedAt)}`,
    c.direction === 'out' ? 'outgoing' : 'incoming',
    who,
  ];
  if (c.durationSec > 0) parts.push(formatDuration(c.durationSec));
  parts.push(c.status);
  return parts.join(' · ');
}

function notesBlock(i: CallInsight): string {
  const lines = [`Summary: ${i.summary}`];
  if (i.objections.length) lines.push(`Objections: ${i.objections.join('; ')}`);
  if (i.promises.length) {
    const items = i.promises.map((p) => {
      const bits = [p.who === 'me' ? 'you' : 'them'];
      if (p.due) bits.push(`due ${p.due}`);
      bits.push(p.done ? 'done' : 'open');
      return `${p.text} (${bits.join(', ')})`;
    });
    lines.push(`Promises: ${items.join('; ')}`);
  }
  if (i.nextStep) lines.push(`Next step: ${i.nextStep}`);
  return lines.join('\n');
}

const TRUNCATED = '\n…[transcript truncated]';

export function buildCallDigest(
  calls: CallEntry[],
  opts: { now: number; budgetTokens?: number; perCallTokens?: number; maxCalls?: number },
): CallDigest {
  // Budgets are in quarter-tokens (see weight()).
  const budget = (opts.budgetTokens ?? 40_000) * 4;
  const perCallTokens = opts.perCallTokens ?? 8_000;
  const maxCalls = opts.maxCalls ?? 150;

  const today = `Today: ${DAYS[new Date(opts.now).getDay()]} ${localDate(opts.now)}`;
  const refs: Record<string, CallRef> = {};
  const stats = { calls: 0, full: 0, notes: 0, headerOnly: 0 };

  if (calls.length === 0) {
    return { text: `${today}\n\n(no calls yet)`, refs, stats };
  }

  // Headers first — they are cheap and every call should at least be listed.
  const SEP = 2; // "\n\n" between blocks
  let used = weight(today);
  const picked: { ref: string; call: CallEntry; header: string }[] = [];
  for (const call of calls.slice(0, maxCalls)) {
    const ref = `C${picked.length + 1}`;
    const header = headerLine(ref, call);
    const cost = SEP + weight(header);
    if (used + cost > budget) break;
    used += cost;
    picked.push({ ref, call, header });
  }

  const blocks: string[] = [];
  for (const { ref, call, header } of picked) {
    refs[ref] = {
      sid: call.sid,
      number: call.number,
      contactName: call.contactName,
      startedAt: call.startedAt,
    };
    stats.calls += 1;

    const notes = call.insight ? notesBlock(call.insight) : '';
    let body = '';

    if (call.segments?.length) {
      let transcript = formatTranscriptText(call.segments);
      if (estimateTokens(transcript) > perCallTokens) {
        transcript = truncateToTokens(transcript, perCallTokens - estimateTokens(TRUNCATED)) + TRUNCATED;
      }
      const full = `${notes ? `${notes}\n` : ''}Transcript:\n${transcript}`;
      if (used + 1 + weight(full) <= budget) {
        body = full;
        stats.full += 1;
      }
    }
    if (!body && notes && used + 1 + weight(notes) <= budget) {
      body = notes;
      stats.notes += 1;
    }
    if (!body) stats.headerOnly += 1;
    else used += 1 + weight(body);

    blocks.push(body ? `${header}\n${body}` : header);
  }

  return { text: `${today}\n\n${blocks.join('\n\n')}`, refs, stats };
}

export type AnswerPart = { type: 'text'; text: string } | { type: 'cite'; ref: string };

/** Split an answer into plain text and `[C#]` citations for rendering. */
export function splitCitations(text: string): AnswerPart[] {
  const parts: AnswerPart[] = [];
  const re = /\[(C\d+)\]/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) parts.push({ type: 'text', text: text.slice(last, m.index) });
    parts.push({ type: 'cite', ref: m[1] });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ type: 'text', text: text.slice(last) });
  return parts;
}
