import type { Settings } from './types';

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
 * POST runtime config changes to the user's Twilio Function /config endpoint.
 * Function holds API Key Secret and updates Service Environment variables on our behalf —
 * extension itself only knows the public functionUrl + configSecret.
 *
 * Throws if the user's installation predates V1.1 (missing serviceSid/configSecret).
 */
export async function pushConfig(settings: Settings, patch: ConfigPatch): Promise<ConfigResponse> {
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
