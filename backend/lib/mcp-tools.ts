/**
 * MCP tool definitions for the HTTP endpoint.
 * Logic copied from mcp-server/src/index.ts, adapted to use DBCallStore
 * and return plain objects instead of going through the MCP SDK transport.
 *
 * Each tool has:
 *   name, description, inputSchema (JSON Schema), execute(args) → MCP content response
 */
import type { DBCallStore } from './db-store';

// ── types ────────────────────────────────────────────────────────

export interface McpToolContent {
  type: 'text';
  text: string;
}

export interface McpToolResult {
  content: McpToolContent[];
  isError?: boolean;
  // structuredContent included for Claude's tool-use parsing
  structuredContent?: unknown;
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: object;
  execute(args: Record<string, unknown>): Promise<McpToolResult>;
}

// ── helpers ──────────────────────────────────────────────────────

function fmt(ms: number) {
  return new Date(ms).toISOString();
}

function dur(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' ? v : fallback;
}

function bool(v: unknown, fallback = false): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

// ── tool factory ─────────────────────────────────────────────────

export function buildMcpTools(store: DBCallStore): McpTool[] {
  return [

    // 1. list_recent_calls
    {
      name: 'list_recent_calls',
      description: 'List the most recent calls with summary metadata (no transcripts). Sorted newest first.',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', minimum: 1, maximum: 100, default: 20, description: 'Max number of calls to return' },
          since: { type: 'string', description: 'ISO datetime — only calls after this point' },
          direction: { type: 'string', enum: ['in', 'out', 'all'], default: 'all', description: 'Filter by call direction' },
        },
      },
      async execute(args) {
        const limit = num(args.limit, 20);
        const since = str(args.since);
        const direction = str(args.direction, 'all') as 'in' | 'out' | 'all';
        const sinceMs = since ? new Date(since).getTime() : 0;

        const idx = await store.readIndex(Math.min(limit * 10, 500));
        const filtered = idx
          .filter((e) => sinceMs === 0 || e.startedAt >= sinceMs)
          .filter((e) => direction === 'all' || e.direction === direction)
          .slice(0, limit);

        const text = filtered.length === 0
          ? 'No calls found.'
          : filtered.map((e) =>
              `${e.sid}  ${fmt(e.startedAt)} ${e.direction === 'in' ? '←' : '→'} ${e.number} (${dur(e.durationSec)}, ${e.status}${e.hasTranscript ? ', transcript' : ''})`
            ).join('\n');

        return { content: [{ type: 'text', text }], structuredContent: { calls: filtered } };
      },
    },

    // 2. get_call
    {
      name: 'get_call',
      description: 'Return full metadata for one call (without transcript). Use get_transcript for the transcript.',
      inputSchema: {
        type: 'object',
        required: ['callSid'],
        properties: {
          callSid: { type: 'string', description: 'Call SID (e.g. CA...)' },
        },
      },
      async execute(args) {
        const callSid = str(args.callSid);
        const call = await store.readCall(callSid);
        if (!call) {
          return { content: [{ type: 'text', text: `Call ${callSid} not found.` }], isError: true };
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(call.meta, null, 2) }],
          structuredContent: { meta: call.meta, hasTranscript: !!call.transcript },
        };
      },
    },

    // 3. get_transcript
    {
      name: 'get_transcript',
      description: 'Return the transcript for one call, with speaker labels and timestamps.',
      inputSchema: {
        type: 'object',
        required: ['callSid'],
        properties: {
          callSid: { type: 'string', description: 'Call SID' },
          format: { type: 'string', enum: ['text', 'json'], default: 'text', description: 'text = readable, json = structured' },
        },
      },
      async execute(args) {
        const callSid = str(args.callSid);
        const format = str(args.format, 'text');
        const call = await store.readCall(callSid);
        if (!call) {
          return { content: [{ type: 'text', text: `Call ${callSid} not found.` }], isError: true };
        }
        if (!call.transcript) {
          return { content: [{ type: 'text', text: `Call ${callSid} has no transcript.` }] };
        }
        if (format === 'json') {
          return {
            content: [{ type: 'text', text: JSON.stringify(call.transcript, null, 2) }],
            structuredContent: { transcript: call.transcript },
          };
        }
        const lines = call.transcript.segments.map((s) => {
          const sec = Math.floor(s.ts / 1000);
          const mm = Math.floor(sec / 60).toString().padStart(2, '0');
          const ss = (sec % 60).toString().padStart(2, '0');
          const label = s.speaker === 'user' ? 'You' : 'Caller';
          return `[${mm}:${ss}] ${label}: ${s.text}`;
        });
        return {
          content: [{ type: 'text', text: lines.join('\n') }],
          structuredContent: { segments: call.transcript.segments },
        };
      },
    },

    // 4. search_transcripts
    {
      name: 'search_transcripts',
      description: 'Full-text search across call transcripts. Returns matching calls with matched lines.',
      inputSchema: {
        type: 'object',
        required: ['query'],
        properties: {
          query: { type: 'string', minLength: 1, description: 'Search term (case-insensitive)' },
          dateFrom: { type: 'string', description: 'ISO datetime — earliest call start' },
          dateTo: { type: 'string', description: 'ISO datetime — latest call start' },
          direction: { type: 'string', enum: ['in', 'out', 'all'], default: 'all' },
          limit: { type: 'number', minimum: 1, maximum: 100, default: 20 },
        },
      },
      async execute(args) {
        const query = str(args.query);
        const dateFrom = str(args.dateFrom);
        const dateTo = str(args.dateTo);
        const direction = str(args.direction, 'all') as 'in' | 'out' | 'all';
        const limit = num(args.limit, 20);

        const results = await store.searchTranscripts(query, {
          dateFrom: dateFrom ? new Date(dateFrom).getTime() : undefined,
          dateTo: dateTo ? new Date(dateTo).getTime() : undefined,
          direction,
          limit,
        });

        if (results.length === 0) {
          return { content: [{ type: 'text', text: `No matches for "${query}".` }] };
        }

        const lines: string[] = [];
        for (const r of results) {
          lines.push(`\n── ${fmt(r.call.meta.startedAt)} ${r.call.meta.direction === 'in' ? '←' : '→'} ${r.call.meta.number} (${r.call.meta.callSid})`);
          for (const m of r.matches.slice(0, 3)) {
            lines.push(`   ${m.speaker === 'user' ? 'You' : 'Caller'}: ${m.text}`);
          }
          if (r.matches.length > 3) lines.push(`   … and ${r.matches.length - 3} more matches`);
        }
        return {
          content: [{ type: 'text', text: lines.join('\n').trim() }],
          structuredContent: { matches: results.map((r) => ({ callSid: r.call.meta.callSid, meta: r.call.meta, matches: r.matches })) },
        };
      },
    },

    // 5. get_call_stats
    {
      name: 'get_call_stats',
      description: 'Aggregate metrics for a time period: total calls, talk time, top contacts.',
      inputSchema: {
        type: 'object',
        properties: {
          period: { type: 'string', enum: ['today', 'week', 'month', 'all'], default: 'week' },
        },
      },
      async execute(args) {
        const period = str(args.period, 'week') as 'today' | 'week' | 'month' | 'all';
        const now = Date.now();
        const day = 86400000;
        const cutoff = period === 'today' ? now - day
          : period === 'week' ? now - 7 * day
          : period === 'month' ? now - 30 * day
          : 0;

        const idx = (await store.readIndex()).filter((e) => e.startedAt >= cutoff);
        const total = idx.length;
        const completed = idx.filter((e) => e.status === 'completed').length;
        const missed = idx.filter((e) => e.status === 'missed').length;
        const failed = idx.filter((e) => e.status === 'failed').length;
        const totalSec = idx.reduce((sum, e) => sum + e.durationSec, 0);
        const inbound = idx.filter((e) => e.direction === 'in').length;
        const outbound = idx.filter((e) => e.direction === 'out').length;

        const byNumber: Record<string, number> = {};
        for (const e of idx) byNumber[e.number] = (byNumber[e.number] ?? 0) + 1;
        const topContacts = Object.entries(byNumber)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([number, count]) => ({ number, count }));

        const stats = { period, total, completed, missed, failed, inbound, outbound, totalTalkTimeMinutes: Math.round(totalSec / 60), topContacts };
        return { content: [{ type: 'text', text: JSON.stringify(stats, null, 2) }], structuredContent: stats };
      },
    },

    // 6. get_contact_history
    {
      name: 'get_contact_history',
      description: 'All calls for one phone number or HubSpot contact ID.',
      inputSchema: {
        type: 'object',
        properties: {
          phone: { type: 'string', description: 'E.164 number, e.g. +14155551234' },
          hubspotContactId: { type: 'string', description: 'HubSpot contact ID' },
          includeTranscripts: { type: 'boolean', default: false },
        },
      },
      async execute(args) {
        const phone = str(args.phone);
        const hubspotContactId = str(args.hubspotContactId);
        const includeTranscripts = bool(args.includeTranscripts);

        if (!phone && !hubspotContactId) {
          return { content: [{ type: 'text', text: 'Provide either phone or hubspotContactId.' }], isError: true };
        }

        const all = await store.readAllCalls();
        const matches = all.filter((c) => {
          if (phone && c.meta.number === phone) return true;
          if (hubspotContactId && c.meta.contact?.id === hubspotContactId) return true;
          return false;
        });

        if (matches.length === 0) {
          return { content: [{ type: 'text', text: `No calls found for ${phone || hubspotContactId}.` }] };
        }

        const lines = matches.map((c) =>
          `${fmt(c.meta.startedAt)} ${c.meta.direction === 'in' ? '←' : '→'} ${dur(c.meta.durationSec)} ${c.meta.status}${c.transcript ? ` (${c.transcript.segments.length} segments)` : ''}`
        );
        const payload = matches.map((c) => ({ meta: c.meta, transcript: includeTranscripts ? c.transcript : undefined }));
        return {
          content: [{ type: 'text', text: lines.join('\n') }],
          structuredContent: { calls: payload, count: matches.length },
        };
      },
    },

    // 7. export_bundle
    {
      name: 'export_bundle',
      description: 'Export all calls and transcripts as CSV or JSON.',
      inputSchema: {
        type: 'object',
        properties: {
          format: { type: 'string', enum: ['csv', 'json'], default: 'json' },
          dateFrom: { type: 'string' },
          dateTo: { type: 'string' },
        },
      },
      async execute(args) {
        const format = str(args.format, 'json');
        const from = str(args.dateFrom) ? new Date(str(args.dateFrom)).getTime() : 0;
        const to = str(args.dateTo) ? new Date(str(args.dateTo)).getTime() : Infinity;

        const all = (await store.readAllCalls()).filter((c) => c.meta.startedAt >= from && c.meta.startedAt <= to);

        if (format === 'json') {
          return { content: [{ type: 'text', text: JSON.stringify(all, null, 2) }], structuredContent: { count: all.length, calls: all } };
        }

        const rows = [['callSid', 'direction', 'number', 'startedAt', 'durationSec', 'status', 'contactName', 'transcript'].join(',')];
        for (const c of all) {
          const transcript = (c.transcript?.segments ?? [])
            .map((s) => `[${s.speaker}] ${s.text}`)
            .join(' | ')
            .replace(/"/g, '""');
          rows.push([
            c.meta.callSid, c.meta.direction, c.meta.number,
            new Date(c.meta.startedAt).toISOString(),
            c.meta.durationSec, c.meta.status,
            (c.meta.contact?.name ?? '').replace(/"/g, '""'),
            `"${transcript}"`,
          ].join(','));
        }
        return { content: [{ type: 'text', text: rows.join('\n') }], structuredContent: { count: all.length, format: 'csv' } };
      },
    },
  ];
}
