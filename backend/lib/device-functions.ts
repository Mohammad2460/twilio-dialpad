import { supabase } from './supabase';
import { decryptSecret } from './crypto';

export interface DeviceFunction {
  functionUrl: string;
  configSecret: string;
}

/** Latest registered Twilio Function for a user, with configSecret decrypted. */
export async function getFunctionForUser(userId: string): Promise<DeviceFunction | null> {
  const { data } = await supabase
    .from('device_functions')
    .select('function_url, config_secret_enc')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data?.function_url || !data.config_secret_enc) return null;
  try {
    return { functionUrl: data.function_url, configSecret: decryptSecret(data.config_secret_enc) };
  } catch {
    return null;
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
  const fn = await getFunctionForUser(user.id);
  if (!fn) return null;
  return { userId: user.id, configSecret: fn.configSecret };
}
