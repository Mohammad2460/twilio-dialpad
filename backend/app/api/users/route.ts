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
  // ── SECURITY (Phase 0b) ──────────────────────────────────────────────────
  // This endpoint MUST NOT resolve or return an account from an Account SID
  // alone — a SID is not a secret and is forgeable, which previously let anyone
  // claim another user's account/trial. SID-based dedup now happens ONLY in
  // POST /api/devices/register, behind genuine Twilio ownership verification.
  //
  // Kept only so old/in-flight extension builds that still POST here don't 500:
  // it mints a fresh anonymous user (no SID lookup, no SID write, no dedup).
  // New + migrating installs must use /api/devices/register.
  // Drain the body so SID, if sent, is explicitly ignored.
  try {
    await req.json();
  } catch {
    /* no body — fine */
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://dialler-mcp.vercel.app';

  const { data, error } = await supabase
    .from('users')
    .insert({})
    .select('id')
    .single();

  if (error || !data) {
    console.error('[users] insert failed', error);
    return NextResponse.json({ error: 'Failed to create user' }, { status: 500, headers: corsHeaders });
  }

  const userId: string = data.id;
  return NextResponse.json(
    { userId, mcpUrl: `${baseUrl}/api/mcp/${userId}`, deprecated: 'use /api/devices/register' },
    { status: 201, headers: corsHeaders },
  );
}
