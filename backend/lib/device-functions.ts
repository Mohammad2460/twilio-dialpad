import { supabase } from './supabase';
import { decryptSecret } from './crypto';

export interface DeviceFunction {
  functionUrl: string;
  configSecret: string;
}

/** Thrown when a row exists but its configSecret can't be decrypted (e.g. a
 *  CONFIG_ENC_KEY mismatch/rotation) — distinct from "no Function registered". */
export class ConfigDecryptError extends Error {
  constructor() {
    super('config_decrypt_failed');
    this.name = 'ConfigDecryptError';
  }
}

/**
 * Latest registered Twilio Function for a user, with configSecret decrypted.
 * Only considers Functions registered to a NON-revoked device — revoking a
 * device must stop its Function from remaining the active path for the user.
 * Returns null when no live registration exists; throws ConfigDecryptError when
 * a row exists but decryption fails (so callers can 500 rather than 409).
 */
export async function getFunctionForUser(userId: string): Promise<DeviceFunction | null> {
  const { data } = await supabase
    .from('device_functions')
    .select('function_url, config_secret_enc, devices!inner(revoked_at)')
    .eq('user_id', userId)
    .is('devices.revoked_at', null)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data?.function_url || !data.config_secret_enc) return null;
  try {
    return { functionUrl: data.function_url, configSecret: decryptSecret(data.config_secret_enc) };
  } catch {
    throw new ConfigDecryptError();
  }
}

/**
 * Resolve a user by their Twilio Account SID and return their function +
 * configSecret. Used by the inbound webhook to verify the shared secret.
 */
export async function getUserAndFunctionBySid(
  accountSid: string,
): Promise<{ userId: string; configSecret: string } | null> {
  const { data: user } = await supabase
    .from('users')
    .select('id')
    .eq('twilio_account_sid', accountSid)
    .maybeSingle();
  if (!user?.id) return null;
  // A decrypt failure here means we can't verify the shared secret anyway →
  // treat as unresolved (caller returns 401) rather than crashing the webhook.
  let fn: DeviceFunction | null;
  try {
    fn = await getFunctionForUser(user.id);
  } catch {
    return null;
  }
  if (!fn) return null;
  return { userId: user.id, configSecret: fn.configSecret };
}
