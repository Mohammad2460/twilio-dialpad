import type { Settings } from './types';
import { authHeader } from './cloud';

const BASE_URL = 'https://dialler-mcp.vercel.app';

export interface ConfigPatch {
  incomingEnabled?: boolean;
  forwardEnabled?: boolean;
  forwardNumber?: string;
  recordOutgoing?: boolean;
}

export interface ConfigResponse {
  ok: boolean;
  updated?: string[];
  error?: string;
}

/**
 * POST runtime config changes (incoming routing, forwarding, recording).
 *
 * Backend-voice installs: routing lives in the users row server-side, updated
 * via /api/voice/config/[userId] (device-auth). Legacy installs: posted to the
 * user's own Twilio Function /config endpoint (holds the API Key Secret).
 *
 * Throws for legacy installs that predate V1.1 (missing serviceSid/configSecret).
 */
export async function pushConfig(settings: Settings, patch: ConfigPatch): Promise<ConfigResponse> {
  if (settings.backendVoice) {
    const { cloudUserId } = await chrome.storage.local.get('cloudUserId');
    if (typeof cloudUserId !== 'string' || !cloudUserId) {
      throw new Error('Device not registered — run setup first.');
    }
    const res = await fetch(`${BASE_URL}/api/voice/config/${cloudUserId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: await authHeader(cloudUserId),
      },
      body: JSON.stringify(patch),
    });
    const json = (await res.json().catch(() => ({}))) as ConfigResponse;
    if (!res.ok || !json.ok) {
      throw new Error(json.error || `Config update failed (${res.status})`);
    }
    return json;
  }

  if (!settings.functionUrl) throw new Error('No function URL — run setup first.');
  if (!settings.configSecret) {
    throw new Error('Forwarding requires re-running setup (missing config secret).');
  }
  if (!settings.serviceSid || !settings.environmentSid) {
    throw new Error('Forwarding requires re-running setup (missing service/env SIDs).');
  }

  const res = await fetch(`${settings.functionUrl}/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      secret: settings.configSecret,
      ...patch,
    }),
  });
  const json = (await res.json().catch(() => ({}))) as ConfigResponse;
  if (!res.ok || !json.ok) {
    throw new Error(json.error || `Config update failed (${res.status})`);
  }
  return json;
}
