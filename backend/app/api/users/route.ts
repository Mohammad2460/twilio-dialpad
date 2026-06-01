import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { corsHeaders } from '@/lib/cors';

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

/**
 * POST /api/users
 * Creates a user record OR returns existing one keyed by twilioAccountSid.
 *
 * Why twilioAccountSid dedup:
 * - Same Twilio account = same human. Prevents trial-bypass by uninstall/reinstall
 *   (each reinstall would otherwise mint a fresh userId + 7-day trial).
 * - Observed in the wild already.
 *
 * Body: { twilioAccountSid?: string }
 *   - If provided AND a user with that SID exists → return existing row (preserves trial state).
 *   - If provided AND no match → insert new row with SID set.
 *   - If absent → insert new row without SID (legacy path, kept for backwards-compat).
 *
 * Returns { userId, mcpUrl }.
 */
export async function POST(req: NextRequest) {
  // Tolerate missing/invalid body — old extension installs POST nothing.
  let twilioAccountSid: string | undefined;
  try {
    const body = (await req.json()) as { twilioAccountSid?: unknown };
    if (typeof body?.twilioAccountSid === 'string' && /^AC[a-zA-Z0-9]{32}$/.test(body.twilioAccountSid)) {
      twilioAccountSid = body.twilioAccountSid;
    }
  } catch {
    /* no body / invalid JSON — proceed without SID */
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://dialler-mcp.vercel.app';

  // Lookup-first when SID present.
  if (twilioAccountSid) {
    const { data: existing, error: lookupErr } = await supabase
      .from('users')
      .select('id')
      .eq('twilio_account_sid', twilioAccountSid)
      .maybeSingle();

    if (lookupErr) {
      console.error('[users] lookup by sid failed', lookupErr);
      return NextResponse.json({ error: 'lookup_failed' }, { status: 500, headers: corsHeaders });
    }

    if (existing?.id) {
      const userId: string = existing.id;
      return NextResponse.json(
        { userId, mcpUrl: `${baseUrl}/api/mcp/${userId}`, existing: true },
        { status: 200, headers: corsHeaders },
      );
    }
  }

  const insertRow: Record<string, unknown> = {};
  if (twilioAccountSid) insertRow.twilio_account_sid = twilioAccountSid;

  const { data, error } = await supabase
    .from('users')
    .insert(insertRow)
    .select('id')
    .single();

  if (error || !data) {
    console.error('[users] insert failed', error);
    return NextResponse.json({ error: 'Failed to create user' }, { status: 500, headers: corsHeaders });
  }

  const userId: string = data.id;
  return NextResponse.json(
    { userId, mcpUrl: `${baseUrl}/api/mcp/${userId}` },
    { status: 201, headers: corsHeaders },
  );
}
