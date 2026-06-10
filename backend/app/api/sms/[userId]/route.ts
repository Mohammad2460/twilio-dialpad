import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { corsHeaders } from '@/lib/cors';
import { authenticateUser } from '@/lib/auth';
import { getFunctionForUser } from '@/lib/device-functions';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

function j(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: corsHeaders });
}

/** Pro gate — mirror the calls route. */
async function requireAccess(userId: string): Promise<boolean> {
  const { data } = await supabase.rpc('user_has_access', { uid: userId });
  return !!data;
}

/**
 * GET /api/sms/[userId] — list recent messages grouped into threads.
 * Device-auth + Pro. Returns { threads: [{ peer, messages: [...] }] }.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  if (!(await authenticateUser(req, userId))) return j({ error: 'Unauthorized' }, 401);
  if (!(await requireAccess(userId))) {
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://dialler-mcp.vercel.app';
    return j({ error: 'subscription_required', upgradeUrl: `${baseUrl}/api/checkout/${userId}` }, 402);
  }

  const { data, error } = await supabase
    .from('messages')
    .select('id, direction, from_number, to_number, body, status, thread_key, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(500);
  if (error) return j({ error: 'load_failed' }, 500);

  const byThread = new Map<string, unknown[]>();
  for (const m of data ?? []) {
    const list = byThread.get(m.thread_key) ?? [];
    list.push(m);
    byThread.set(m.thread_key, list);
  }
  const threads = Array.from(byThread.entries()).map(([peer, messages]) => ({ peer, messages }));
  return j({ threads });
}

/**
 * POST /api/sms/[userId] — send an SMS.
 * Device-auth + Pro. Body { to, body }. Sends via the user's Twilio Function
 * (which holds API Key creds), then records the outbound message.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  if (!(await authenticateUser(req, userId))) return j({ error: 'Unauthorized' }, 401);
  if (!(await requireAccess(userId))) {
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://dialler-mcp.vercel.app';
    return j({ error: 'subscription_required', upgradeUrl: `${baseUrl}/api/checkout/${userId}` }, 402);
  }

  let body: { to?: unknown; body?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return j({ error: 'bad_json' }, 400);
  }
  const to = typeof body.to === 'string' ? body.to.trim() : '';
  const text = typeof body.body === 'string' ? body.body : '';
  if (!/^\+\d{6,}$/.test(to) || !text.trim()) return j({ error: 'invalid_request' }, 400);

  const fn = await getFunctionForUser(userId);
  if (!fn) return j({ error: 'messaging_not_provisioned' }, 409);

  // Call the user's Twilio Function /sms (it sends via Messages API with API-Key creds).
  let sendRes: Response;
  try {
    sendRes = await fetch(`${fn.functionUrl}/sms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: fn.configSecret, To: to, Body: text }),
    });
  } catch {
    return j({ error: 'function_unreachable' }, 502);
  }
  const result = (await sendRes.json().catch(() => ({}))) as {
    ok?: boolean;
    sid?: string;
    from?: string;
    error?: string;
  };
  if (!sendRes.ok || !result.ok) {
    return j({ error: 'send_failed', detail: result.error ?? `status ${sendRes.status}` }, 502);
  }

  // Record outbound (idempotent on sid).
  await supabase.from('messages').upsert(
    {
      user_id: userId,
      direction: 'out',
      from_number: result.from ?? '',
      to_number: to,
      body: text,
      status: 'sent',
      twilio_message_sid: result.sid ?? null,
      thread_key: to,
    },
    { onConflict: 'twilio_message_sid' },
  );

  return j({ ok: true, sid: result.sid });
}
