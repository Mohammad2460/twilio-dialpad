import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { corsHeaders } from '@/lib/cors';

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

/**
 * POST /api/users
 * Creates a new user account. Called once when the extension is first installed.
 * Returns { userId, mcpUrl } — extension stores both in chrome.storage.local.
 */
export async function POST() {
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
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://dialler-mcp.vercel.app';
  const mcpUrl = `${baseUrl}/api/mcp/${userId}`;

  return NextResponse.json({ userId, mcpUrl }, { status: 201, headers: corsHeaders });
}
