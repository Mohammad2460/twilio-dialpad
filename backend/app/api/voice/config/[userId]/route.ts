import { NextRequest, NextResponse } from 'next/server';
import { corsHeaders } from '@/lib/cors';
import { authenticateUser } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export const runtime = 'nodejs';

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}
function j(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: corsHeaders });
}

/**
 * POST /api/voice/config/[userId] — update runtime call routing for a
 * backend-voice install. Replaces the legacy per-user Twilio Function /config
 * endpoint (pushConfig). Device-auth. The /api/voice/twiml route reads these
 * columns on every inbound call, so changes take effect immediately.
 *
 * Body (all optional): { incomingEnabled, forwardEnabled, forwardNumber, recordOutgoing }
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  if (!(await authenticateUser(req, userId))) return j({ error: 'Unauthorized' }, 401);

  // Only backend-voice users have server-side routing config; legacy installs
  // still go through their own Function.
  const { data: u, error } = await supabase
    .from('users')
    .select('backend_voice')
    .eq('id', userId)
    .single();
  if (error || !u) return j({ error: 'not_found' }, 404);
  if (!u.backend_voice) return j({ error: 'not_backend_voice' }, 409);

  const body = (await req.json().catch(() => ({}))) as {
    incomingEnabled?: unknown;
    forwardEnabled?: unknown;
    forwardNumber?: unknown;
    recordOutgoing?: unknown;
  };

  const patch: Record<string, boolean | string> = {};
  const updated: string[] = [];

  if (typeof body.incomingEnabled === 'boolean') {
    patch.incoming_enabled = body.incomingEnabled;
    updated.push('incomingEnabled');
  }
  if (typeof body.forwardEnabled === 'boolean') {
    patch.forward_enabled = body.forwardEnabled;
    updated.push('forwardEnabled');
  }
  if (typeof body.forwardNumber === 'string') {
    const n = body.forwardNumber.trim();
    if (n !== '' && !/^\+\d{6,15}$/.test(n)) {
      return j({ error: 'invalid_forward_number' }, 400);
    }
    patch.forward_number = n;
    updated.push('forwardNumber');
  }
  if (typeof body.recordOutgoing === 'boolean') {
    patch.record_outgoing = body.recordOutgoing;
    updated.push('recordOutgoing');
  }

  if (updated.length === 0) return j({ ok: true, updated: [] });

  const { error: upErr } = await supabase.from('users').update(patch).eq('id', userId);
  if (upErr) return j({ ok: false, error: upErr.message }, 500);

  return j({ ok: true, updated });
}
