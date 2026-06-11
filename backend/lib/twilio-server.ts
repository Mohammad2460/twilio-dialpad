// Minimal server-side Twilio REST (Basic auth). Used for provisioning, SMS send,
// recording media/delete. Credentials are passed per-call (Auth Token during
// provisioning; API Key SID:Secret thereafter) — never module-global.

const API = 'https://api.twilio.com/2010-04-01';

function basic(user: string, pass: string): string {
  return 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
}

async function form<T>(url: string, auth: string, body?: Record<string, string>): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body ? new URLSearchParams(body).toString() : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (!res.ok) throw new Error(`twilio ${res.status}: ${json?.message ?? 'error'}`);
  return json;
}

/** Provisioning (Auth Token). */
export async function createApiKey(sid: string, token: string) {
  return form<{ sid: string; secret: string }>(`${API}/Accounts/${sid}/Keys.json`, basic(sid, token), {
    FriendlyName: 'TwilioDialpad',
  });
}
export async function createTwimlApp(sid: string, token: string, voiceUrl: string) {
  return form<{ sid: string }>(`${API}/Accounts/${sid}/Applications.json`, basic(sid, token), {
    FriendlyName: 'TwilioDialpad', VoiceUrl: voiceUrl, VoiceMethod: 'POST',
  });
}
export async function updateTwimlAppVoiceUrl(sid: string, token: string, appSid: string, voiceUrl: string) {
  return form(`${API}/Accounts/${sid}/Applications/${appSid}.json`, basic(sid, token), {
    VoiceUrl: voiceUrl, VoiceMethod: 'POST',
  });
}
export async function wireNumber(
  sid: string, token: string, numberSid: string, appSid: string, smsUrl: string,
) {
  return form(`${API}/Accounts/${sid}/IncomingPhoneNumbers/${numberSid}.json`, basic(sid, token), {
    VoiceApplicationSid: appSid, SmsUrl: smsUrl, SmsMethod: 'POST',
  });
}

/** Runtime (API Key). */
export async function sendSms(
  apiKeySid: string, apiKeySecret: string, accountSid: string, to: string, from: string, body: string,
) {
  return form<{ sid: string }>(`${API}/Accounts/${accountSid}/Messages.json`, basic(apiKeySid, apiKeySecret), {
    To: to, From: from, Body: body,
  });
}
export async function downloadRecording(
  apiKeySid: string, apiKeySecret: string, recordingUrl: string,
): Promise<ArrayBuffer> {
  const res = await fetch(recordingUrl + '.mp3', { headers: { Authorization: basic(apiKeySid, apiKeySecret) } });
  if (!res.ok) throw new Error(`recording download ${res.status}`);
  return res.arrayBuffer();
}
export async function deleteRecording(
  apiKeySid: string, apiKeySecret: string, accountSid: string, recordingSid: string,
): Promise<void> {
  const res = await fetch(`${API}/Accounts/${accountSid}/Recordings/${recordingSid}.json`, {
    method: 'DELETE', headers: { Authorization: basic(apiKeySid, apiKeySecret) },
  });
  if (res.status !== 204 && res.status !== 404) throw new Error(`recording delete ${res.status}`);
}
