/**
 * SMS client — talks to our backend (never Twilio directly). The backend
 * device-authenticates, enforces Pro, and relays through the user's Twilio
 * Function. Inbound messages are stored server-side and fetched here.
 */
import { authHeader } from './cloud';

const BASE_URL = 'https://dialler-mcp.vercel.app';

export interface SmsMessage {
  id: string;
  direction: 'in' | 'out';
  from_number: string;
  to_number: string;
  body: string;
  status?: string;
  thread_key: string;
  created_at: string;
}

export interface SmsThread {
  peer: string;
  messages: SmsMessage[];
}

export async function listThreads(userId: string): Promise<SmsThread[]> {
  try {
    const res = await fetch(`${BASE_URL}/api/sms/${userId}`, {
      headers: { Authorization: await authHeader(userId) },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { threads?: SmsThread[] };
    return data.threads ?? [];
  } catch {
    return [];
  }
}

export async function sendSms(
  userId: string,
  to: string,
  body: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${BASE_URL}/api/sms/${userId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: await authHeader(userId) },
      body: JSON.stringify({ to, body }),
    });
    if (res.status === 402) return { ok: false, error: 'subscription_required' };
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    return { ok: res.ok && !!data.ok, error: data.error };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'network_error' };
  }
}
