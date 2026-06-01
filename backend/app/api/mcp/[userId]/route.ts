/**
 * MCP HTTP endpoint for Claude.ai.
 *
 * Implements MCP Streamable HTTP transport (2025-03-26 spec) as a stateless
 * JSON-RPC handler. Claude.ai sends all messages via POST to this single URL.
 * No SDK transport layer needed — we handle the JSON-RPC protocol directly.
 *
 * URL shape: /api/mcp/{userId}
 * The userId in the path IS the auth token.
 */
import { NextRequest, NextResponse } from 'next/server';
import { corsHeaders } from '@/lib/cors';
import { DBCallStore } from '@/lib/db-store';
import { buildMcpTools } from '@/lib/mcp-tools';
import { supabase } from '@/lib/supabase';

const MCP_PROTOCOL_VERSION = '2025-03-26';
const SERVER_INFO = { name: 'twilio-dialer', version: '1.0.0' };

// ── preflight ────────────────────────────────────────────────────

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

// ── GET — optional SSE stream (Claude.ai may probe this) ─────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  await params; // consume — not needed for stateless server
  // Return empty SSE stream with CORS headers.
  // Claude.ai will fall back to POST-only mode.
  return new NextResponse(null, {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
  });
}

// ── POST — JSON-RPC handler ──────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId } = await params;

  // Verify user exists
  const store = new DBCallStore(userId);
  const exists = await store.userExists();
  if (!exists) {
    return NextResponse.json({ error: 'User not found' }, { status: 404, headers: corsHeaders });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(jsonRpcError(null, -32700, 'Parse error'), { status: 400, headers: corsHeaders });
  }

  const id = body.id ?? null;
  const method = typeof body.method === 'string' ? body.method : '';
  const rpcParams = (body.params ?? {}) as Record<string, unknown>;

  // Handle batch (array) requests — not expected from Claude.ai but be safe
  if (Array.isArray(body)) {
    return NextResponse.json(
      jsonRpcError(null, -32600, 'Batch requests not supported'),
      { status: 400, headers: corsHeaders },
    );
  }

  const tools = buildMcpTools(store);

  switch (method) {
    // ── lifecycle ──────────────────────────────────────────────────
    case 'initialize':
      return ok(id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });

    case 'notifications/initialized':
      // Notification — no response body required
      return new NextResponse(null, { status: 204, headers: corsHeaders });

    case 'ping':
      return ok(id, {});

    // ── tools ──────────────────────────────────────────────────────
    case 'tools/list':
      return ok(id, {
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      });

    case 'tools/call': {
      // Subscription gate — every tool call requires active access.
      const { data: access } = await supabase.rpc('user_has_access', { uid: userId });
      if (!access) {
        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://dialler-mcp.vercel.app';
        return NextResponse.json(
          jsonRpcError(
            id,
            -32001,
            `Subscription required to use Twilio Dialer tools. Upgrade at ${baseUrl}/api/checkout/${userId}`,
          ),
          { status: 200, headers: corsHeaders },
        );
      }

      const toolName = typeof rpcParams.name === 'string' ? rpcParams.name : '';
      const toolArgs = (rpcParams.arguments ?? {}) as Record<string, unknown>;
      const tool = tools.find((t) => t.name === toolName);

      if (!tool) {
        return NextResponse.json(
          jsonRpcError(id, -32601, `Tool not found: ${toolName}`),
          { status: 200, headers: corsHeaders },
        );
      }

      try {
        const result = await tool.execute(toolArgs);
        return ok(id, result);
      } catch (e) {
        return NextResponse.json(
          jsonRpcError(id, -32603, `Tool error: ${String(e)}`),
          { status: 200, headers: corsHeaders },
        );
      }
    }

    default:
      return NextResponse.json(
        jsonRpcError(id, -32601, `Method not found: ${method}`),
        { status: 200, headers: corsHeaders },
      );
  }
}

// ── helpers ──────────────────────────────────────────────────────

function ok(id: unknown, result: unknown) {
  return NextResponse.json({ jsonrpc: '2.0', id, result }, { headers: corsHeaders });
}

function jsonRpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}
