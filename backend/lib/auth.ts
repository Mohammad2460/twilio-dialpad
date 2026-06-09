/**
 * Phase 0b device authentication.
 *
 * Primary: `Authorization: Bearer <deviceId>.<secret>` — looks up a non-revoked
 * device, constant-time verifies the secret hash.
 *
 * Legacy fallback: a bare `Bearer <userId>` (a UUID, no dot) is accepted only
 * while a user row exists, so existing installs keep working until they register
 * a device. Every legacy use is logged + metered; remove after the migration
 * window. deviceId/secret are base64url + UUID — the first "." cleanly splits.
 */
import type { NextRequest } from 'next/server';
import { supabase } from './supabase';
import { verifySecret } from './crypto';

export interface AuthResult {
  userId: string;
  deviceId: string | null; // null when authenticated via the legacy fallback
  legacy: boolean;
}

export async function authenticate(req: NextRequest): Promise<AuthResult | null> {
  const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!bearer) return null;

  const dot = bearer.indexOf('.');
  if (dot > 0) {
    const deviceId = bearer.slice(0, dot);
    const secret = bearer.slice(dot + 1);
    const { data: device } = await supabase
      .from('devices')
      .select('id, user_id, secret_hash, secret_salt, revoked_at')
      .eq('id', deviceId)
      .maybeSingle();
    if (!device || device.revoked_at) return null;
    if (!verifySecret(secret, device.secret_hash, device.secret_salt)) return null;
    // Best-effort last_seen; never block the request on it.
    void supabase
      .from('devices')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('id', deviceId)
      .then(() => undefined, () => undefined);
    return { userId: device.user_id, deviceId: device.id, legacy: false };
  }

  // Legacy fallback — bare userId.
  const userId = bearer;
  const { data: user } = await supabase.from('users').select('id').eq('id', userId).maybeSingle();
  if (!user) return null;
  console.warn('[auth] LEGACY bearer (userId-as-token) accepted — migrate this device', { userId });
  return { userId, deviceId: null, legacy: true };
}

/** Convenience: authenticate AND require the resolved user to match `expectedUserId`. */
export async function authenticateUser(
  req: NextRequest,
  expectedUserId: string,
): Promise<AuthResult | null> {
  const auth = await authenticate(req);
  if (!auth || auth.userId !== expectedUserId) return null;
  return auth;
}
