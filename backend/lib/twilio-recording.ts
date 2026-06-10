import { getFunctionForUser } from './device-functions';

/**
 * Delete a recording on the user's Twilio account by calling their
 * `/delete-recording` Function (which holds the API-Key creds; our backend does
 * not). Authenticated with the shared configSecret. Best-effort: returns false
 * on any failure so callers can still purge our own copy.
 */
export async function deleteTwilioRecording(userId: string, recordingSid: string): Promise<boolean> {
  if (!recordingSid) return false;
  let fn;
  try {
    fn = await getFunctionForUser(userId);
  } catch {
    return false; // decrypt failure — can't authenticate to the Function
  }
  if (!fn) return false;
  try {
    const res = await fetch(`${fn.functionUrl}/delete-recording`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: fn.configSecret, recordingSid }),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean };
    return res.ok && data.ok === true;
  } catch {
    return false;
  }
}
