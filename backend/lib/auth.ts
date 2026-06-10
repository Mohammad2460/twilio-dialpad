/**
 * Phase 0b device authentication.
 *
 * Primary: `Authorization: Bearer <deviceId>.<secret>` — looks up a non-revoked
 * device, constant-time verifies the secret hash.
 *
 * Legacy fallback: a bare `Bearer <userId>` (a UUID, no dot) is accepted only
 * during a bounded migration window AND only for a user who has NOT yet
 * registered any device. Once the user has a non-revoked device they are
 * considered migrated and the bare-userId token is rejected (so a leaked UUID —
 * e.g. embedded in an MCP URL — is not a permanent bearer grant). The window
 * also hard-closes at LEGACY_AUTH_UNTIL. deviceId/secret are base64url + UUID —
 * the first "." cleanly splits.
 */
import type { NextRequest } from 'next/server';
import { supabase } from './supabase';
import { verifySecret } from './crypto';

// Hard cutoff for the legacy bare-userId fallback. Overridable via env; defaults
// to a near-term date so the fallback can never silently live forever.
const LEGACY_AUTH_UNTIL = Date.parse(process.env.LEGACY_AUTH_UNTIL ?? '2026-07-31T00:00:00Z');

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

  // Legacy fallback — bare userId. Bounded + self-disabling.
  const userId = bearer;
  if (Number.isFinite(LEGACY_AUTH_UNTIL) && Date.now() > LEGACY_AUTH_UNTIL) return null;

  const { data: user } = await supabase.from('users').select('id').eq('id', userId).maybeSingle();
  if (!user) return null;

  // If this user already has a non-revoked device, they've migrated — the bare
  // userId is no longer a valid credential (prevents a leaked UUID being a
  // permanent bearer token alongside the real device secret). FAIL CLOSED: a
  // query error leaves count null, so accept legacy ONLY when we positively
  // know the count is zero (no error, count === 0).
  const { count, error: countErr } = await supabase
    .from('devices')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('revoked_at', null);
  if (countErr || count === null || count > 0) return null;

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
