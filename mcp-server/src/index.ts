#!/usr/bin/env node
/**
 * Twilio Dialer MCP server.
 * stdio transport — pair with Claude Desktop or Claude Code.
 *
 * Reads call + transcript JSON files from a folder the extension writes to.
 *
 * Usage:
 *   twilio-dialer-mcp --folder /path/to/transcripts
 *   (or set DIALER_FOLDER env var)
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { CallStore } from './store.js';

// ── Parse CLI args ───────────────────────────────────────────────

const args = process.argv.slice(2);
let folder = process.env.DIALER_FOLDER ?? '';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--folder' && args[i + 1]) {
    folder = args[i + 1];
    i++;
  }
}
if (!folder) {
  console.error('ERROR: --folder <path> required (or set DIALER_FOLDER env var)');
  console.error('');
  console.error('This is the same folder the Twilio Dialer Chrome extension writes to.');
  console.error('In the extension: Options → "Transcript Sync Folder" → "Choose folder".');
  process.exit(1);
}

const store = new CallStore(folder);
const server = new McpServer({
  name: 'twilio-dialer',
  version: '0.1.0',
});

// ── Tools ────────────────────────────────────────────────────────

function formatTimestamp(ms: number): string {
  return new Date(ms).toISOString();
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// 1. list_recent_calls
server.registerTool(
  'list_recent_calls',
  {
    title: 'List recent calls',
    description: 'List the most recent calls with summary metadata (no transcripts). Sorted newest first.',
    inputSchema: {
      limit: z.number().int().min(1).max(100).default(20).describe('Max number of calls to return'),
      since: z.string().optional().describe('ISO datetime — only calls after this point'),
      direction: z.enum(['in', 'out', 'all']).default('all').describe('Filter by call direction'),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  async ({ limit, since, direction }) => {
    const idx = await store.readIndex();
    const sinceMs = since ? new Date(since).getTime() : 0;
    const filtered = idx
      .filter((e) => (sinceMs === 0 || e.startedAt >= sinceMs))
      .filter((e) => (direction === 'all' || e.direction === direction))
      .slice(0, limit);
    const text = filtered.length === 0
      ? `No calls found in ${folder}.`
      : filtered.map((e) => `${formatTimestamp(e.startedAt)} ${e.direction === 'in' ? '←' : '→'} ${e.number} (${formatDuration(e.durationSec)}, ${e.status}${e.hasTranscript ? ', transcript' : ''})`).join('\n');
    return {
      content: [{ type: 'text', text }],
      structuredContent: { calls: filtered },
    };
  },
);

// 2. get_call
server.registerTool(
  'get_call',
  {
    title: 'Get call metadata',
    description: 'Return full metadata for one call (without transcript). Use get_transcript for transcript body.',
    inputSchema: {
      callSid: z.string().describe('Call SID (e.g. CA...)'),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  async ({ callSid }) => {
    const call = await store.readCall(callSid);
    if (!call) {
      return { content: [{ type: 'text', text: `Call ${callSid} not found in ${folder}/calls/.` }], isError: true };
    }
    return {
      content: [{ type: 'text', text: JSON.stringify(call.meta, null, 2) }],
      structuredContent: { meta: call.meta, hasTranscript: !!call.transcript },
    };
  },
);

// 3. get_transcript
server.registerTool(
  'get_transcript',
  {
    title: 'Get call transcript',
    description: 'Return the transcript for one call, with speaker labels and timestamps. Format text or JSON.',
    inputSchema: {
      callSid: z.string().describe('Call SID'),
      format: z.enum(['text', 'json']).default('text').describe('text = readable, json = structured'),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  async ({ callSid, format }) => {
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
);

// 4. search_transcripts
server.registerTool(
  'search_transcripts',
  {
    title: 'Search transcripts',
    description: 'Full-text search across every call transcript. Returns matching calls with the matched lines and context.',
    inputSchema: {
      query: z.string().min(1).describe('Search term (case-insensitive substring)'),
      dateFrom: z.string().optional().describe('ISO datetime — earliest call start to include'),
      dateTo: z.string().optional().describe('ISO datetime — latest call start to include'),
      direction: z.enum(['in', 'out', 'all']).default('all'),
      limit: z.number().int().min(1).max(100).default(20),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  async ({ query, dateFrom, dateTo, direction, limit }) => {
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
      lines.push(`\n── ${formatTimestamp(r.call.meta.startedAt)} ${r.call.meta.direction === 'in' ? '←' : '→'} ${r.call.meta.number} (${r.call.meta.callSid})`);
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
);

// 5. get_call_stats
server.registerTool(
  'get_call_stats',
  {
    title: 'Get call statistics',
    description: 'Aggregate metrics for a time period: total calls, talk time, connected/missed rates, top contacts.',
    inputSchema: {
      period: z.enum(['today', 'week', 'month', 'all']).default('week'),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  async ({ period }) => {
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

    // Top contacts by call count.
    const byNumber: Record<string, number> = {};
    for (const e of idx) byNumber[e.number] = (byNumber[e.number] ?? 0) + 1;
    const topContacts = Object.entries(byNumber)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([number, count]) => ({ number, count }));

    const stats = {
      period,
      total,
      completed,
      missed,
      failed,
      inbound,
      outbound,
      totalTalkTimeMinutes: Math.round(totalSec / 60),
      topContacts,
    };
    return {
      content: [{ type: 'text', text: JSON.stringify(stats, null, 2) }],
      structuredContent: stats,
    };
  },
);

// 6. get_contact_history
server.registerTool(
  'get_contact_history',
  {
    title: 'Get contact call history',
    description: 'List all calls + transcripts for one phone number (E.164) or HubSpot contact ID. Useful for "show me everything I have with X".',
    inputSchema: {
      phone: z.string().optional().describe('E.164 number, e.g. +14155551234'),
      hubspotContactId: z.string().optional().describe('HubSpot contact ID (numeric string)'),
      includeTranscripts: z.boolean().default(false).describe('Include full transcripts in response'),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  async ({ phone, hubspotContactId, includeTranscripts }) => {
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
      return { content: [{ type: 'text', text: `No calls found for ${phone ?? hubspotContactId}.` }] };
    }
    const lines = matches.map((c) => `${formatTimestamp(c.meta.startedAt)} ${c.meta.direction === 'in' ? '←' : '→'} ${formatDuration(c.meta.durationSec)} ${c.meta.status}${c.transcript ? ` (${c.transcript.segments.length} segments)` : ''}`);
    const payload = matches.map((c) => ({
      meta: c.meta,
      transcript: includeTranscripts ? c.transcript : undefined,
    }));
    return {
      content: [{ type: 'text', text: lines.join('\n') }],
      structuredContent: { calls: payload, count: matches.length },
    };
  },
);

// 7. export_bundle
server.registerTool(
  'export_bundle',
  {
    title: 'Export call bundle',
    description: 'Generate a CSV or JSON dump of all calls and transcripts for backup or external analysis.',
    inputSchema: {
      format: z.enum(['csv', 'json']).default('json'),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  async ({ format, dateFrom, dateTo }) => {
    const from = dateFrom ? new Date(dateFrom).getTime() : 0;
    const to = dateTo ? new Date(dateTo).getTime() : Infinity;
    const all = (await store.readAllCalls()).filter((c) => c.meta.startedAt >= from && c.meta.startedAt <= to);
    if (format === 'json') {
      return {
        content: [{ type: 'text', text: JSON.stringify(all, null, 2) }],
        structuredContent: { count: all.length, calls: all },
      };
    }
    // CSV: one row per call with transcript joined.
    const rows = [
      ['callSid', 'direction', 'number', 'startedAt', 'durationSec', 'status', 'contactName', 'transcript'].join(','),
    ];
    for (const c of all) {
      const transcript = (c.transcript?.segments ?? [])
        .map((s) => `[${s.speaker}] ${s.text}`)
        .join(' | ')
        .replace(/"/g, '""');
      const row = [
        c.meta.callSid,
        c.meta.direction,
        c.meta.number,
        new Date(c.meta.startedAt).toISOString(),
        c.meta.durationSec,
        c.meta.status,
        (c.meta.contact?.name ?? '').replace(/"/g, '""'),
        `"${transcript}"`,
      ];
      rows.push(row.join(','));
    }
    return {
      content: [{ type: 'text', text: rows.join('\n') }],
      structuredContent: { count: all.length, format: 'csv' },
    };
  },
);

// ── Start ────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Log to stderr (stdout is reserved for MCP protocol).
  console.error(`[twilio-dialer-mcp] reading from: ${folder}`);
}

main().catch((e) => {
  console.error('[twilio-dialer-mcp] fatal:', e);
  process.exit(1);
});
