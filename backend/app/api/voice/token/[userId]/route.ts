import { NextRequest, NextResponse } from 'next/server';
import twilio from 'twilio';
import { corsHeaders } from '@/lib/cors';
import { authenticateUser } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { decryptSecret } from '@/lib/crypto';

export const runtime = 'nodejs';

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}
function j(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: corsHeaders });
}

/**
 * POST /api/voice/token/[userId] — mint a Twilio Voice AccessToken from the
 * user's stored API Key secret. Device-auth. Mirrors the legacy TOKEN_JS.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  if (!(await authenticateUser(req, userId))) return j({ error: 'Unauthorized' }, 401);

  const { data: u, error } = await supabase
    .from('users')
    .select('twilio_account_sid, api_key_sid, api_key_secret_enc, twiml_app_sid, client_identity')
    .eq('id', userId)
    .single();
  if (error || !u || !u.api_key_secret_enc || !u.api_key_sid || !u.twiml_app_sid) {
    return j({ error: 'voice_not_provisioned' }, 409);
  }

  const secret = decryptSecret(u.api_key_secret_enc);
  const identity = (u.client_identity ?? 'dialpad').toString().slice(0, 121);

  const AccessToken = twilio.jwt.AccessToken;
  const token = new AccessToken(u.twilio_account_sid, u.api_key_sid, secret, { identity, ttl: 3600 });
  token.addGrant(new AccessToken.VoiceGrant({ outgoingApplicationSid: u.twiml_app_sid, incomingAllow: true }));

  return j({ token: token.toJwt(), identity });
}
