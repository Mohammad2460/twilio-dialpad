/**
 * Twilio REST helpers for provisioning + Serverless deployment.
 * Auth Token is kept in-memory only, never persisted after setup.
 */

const API = 'https://api.twilio.com/2010-04-01';
const SLS = 'https://serverless.twilio.com/v1';
const SLS_UPLOAD = 'https://serverless-upload.twilio.com/v1';

function authHeader(sid: string, token: string): string {
  return 'Basic ' + btoa(`${sid}:${token}`);
}

async function twilioFetch<T>(
  path: string,
  sid: string,
  token: string,
  init: RequestInit & { form?: Record<string, string> } = {},
): Promise<T> {
  const { form, ...rest } = init;
  const headers: Record<string, string> = {
    Authorization: authHeader(sid, token),
    Accept: 'application/json',
    ...((rest.headers as Record<string, string>) ?? {}),
  };
  let body: BodyInit | undefined = rest.body ?? undefined;
  if (form) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    body = new URLSearchParams(form).toString();
  }
  const res = await fetch(`${API}${path}`, { ...rest, headers, body });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Twilio ${res.status}: ${text || res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export interface TwilioAccount {
  sid: string;
  friendly_name: string;
  status: string;
}

export interface TwilioKey {
  sid: string;
  secret: string;
  friendly_name: string;
}

export interface TwimlApp {
  sid: string;
  friendly_name: string;
  voice_url: string;
}

export interface IncomingPhoneNumber {
  sid: string;
  phone_number: string;
  friendly_name: string;
}

export const twilio = {
  async verifyAccount(sid: string, token: string): Promise<TwilioAccount> {
    return twilioFetch<TwilioAccount>(`/Accounts/${sid}.json`, sid, token);
  },

  async createApiKey(sid: string, token: string, friendlyName = 'TwilioDialpad'): Promise<TwilioKey> {
    return twilioFetch<TwilioKey>(`/Accounts/${sid}/Keys.json`, sid, token, {
      method: 'POST',
      form: { FriendlyName: friendlyName },
    });
  },

  async createTwimlApp(sid: string, token: string, friendlyName = 'TwilioDialpad'): Promise<TwimlApp> {
    return twilioFetch<TwimlApp>(`/Accounts/${sid}/Applications.json`, sid, token, {
      method: 'POST',
      form: { FriendlyName: friendlyName, VoiceMethod: 'POST' },
    });
  },

  async updateTwimlAppVoiceUrl(
    sid: string,
    token: string,
    appSid: string,
    voiceUrl: string,
  ): Promise<TwimlApp> {
    return twilioFetch<TwimlApp>(`/Accounts/${sid}/Applications/${appSid}.json`, sid, token, {
      method: 'POST',
      form: { VoiceUrl: voiceUrl, VoiceMethod: 'POST' },
    });
  },

  async listPhoneNumbers(sid: string, token: string): Promise<IncomingPhoneNumber[]> {
    const json = await twilioFetch<{ incoming_phone_numbers: IncomingPhoneNumber[] }>(
      `/Accounts/${sid}/IncomingPhoneNumbers.json?PageSize=50`,
      sid,
      token,
    );
    return json.incoming_phone_numbers ?? [];
  },

  async setNumberVoiceApp(
    sid: string,
    token: string,
    numberSid: string,
    appSid: string,
  ): Promise<IncomingPhoneNumber> {
    return twilioFetch<IncomingPhoneNumber>(
      `/Accounts/${sid}/IncomingPhoneNumbers/${numberSid}.json`,
      sid,
      token,
      { method: 'POST', form: { VoiceApplicationSid: appSid } },
    );
  },

  async setNumberSmsUrl(
    sid: string,
    token: string,
    numberSid: string,
    smsUrl: string,
  ): Promise<IncomingPhoneNumber> {
    return twilioFetch<IncomingPhoneNumber>(
      `/Accounts/${sid}/IncomingPhoneNumbers/${numberSid}.json`,
      sid,
      token,
      { method: 'POST', form: { SmsUrl: smsUrl, SmsMethod: 'POST' } },
    );
  },

};

// ────────────────────────────────────────────────────────────────
// Twilio Serverless API — auto-deploy Functions from the extension
// ────────────────────────────────────────────────────────────────

async function slsFetch<T>(
  path: string,
  sid: string,
  token: string,
  init: RequestInit & { form?: Record<string, string> } = {},
  baseUrl = SLS,
): Promise<T> {
  const { form, ...rest } = init;
  const headers: Record<string, string> = {
    Authorization: 'Basic ' + btoa(`${sid}:${token}`),
    Accept: 'application/json',
    ...((rest.headers as Record<string, string>) ?? {}),
  };
  let body: BodyInit | undefined = rest.body ?? undefined;
  if (form) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    body = new URLSearchParams(form).toString();
  }
  const res = await fetch(`${baseUrl}${path}`, { ...rest, headers, body });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Serverless ${res.status}: ${text || res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export interface SlsService { sid: string; unique_name: string; domain_base: string; }
export interface SlsEnvironment { sid: string; unique_name: string; domain_name: string; }
export interface SlsFunction { sid: string; friendly_name: string; }
export interface SlsFunctionVersion { sid: string; }
export interface SlsVariable { sid: string; key: string; value: string; }
export interface SlsBuild { sid: string; status: 'building' | 'completed' | 'failed'; }
export interface SlsDeployment { sid: string; }

export const serverless = {
  async createService(sid: string, token: string, uniqueName: string): Promise<SlsService> {
    return slsFetch<SlsService>('/Services', sid, token, {
      method: 'POST',
      form: { UniqueName: uniqueName, FriendlyName: 'Twilio Dialpad', IncludeCredentials: 'false' },
    });
  },

  async createEnvironment(sid: string, token: string, serviceSid: string): Promise<SlsEnvironment> {
    return slsFetch<SlsEnvironment>(`/Services/${serviceSid}/Environments`, sid, token, {
      method: 'POST',
      form: { UniqueName: 'production' },
    });
  },

  async getEnvironment(sid: string, token: string, serviceSid: string, envSid: string): Promise<SlsEnvironment> {
    return slsFetch<SlsEnvironment>(`/Services/${serviceSid}/Environments/${envSid}`, sid, token);
  },

  async createFunction(sid: string, token: string, serviceSid: string, path: string): Promise<SlsFunction> {
    return slsFetch<SlsFunction>(`/Services/${serviceSid}/Functions`, sid, token, {
      method: 'POST',
      form: { FriendlyName: path },
    });
  },

  async listFunctions(sid: string, token: string, serviceSid: string): Promise<SlsFunction[]> {
    const json = await slsFetch<{ functions: SlsFunction[] }>(
      `/Services/${serviceSid}/Functions?PageSize=100`,
      sid,
      token,
    );
    return json.functions ?? [];
  },

  async uploadFunctionVersion(
    sid: string,
    token: string,
    serviceSid: string,
    functionSid: string,
    path: string,
    code: string,
    visibility: 'public' | 'protected' | 'private' = 'public',
  ): Promise<SlsFunctionVersion> {
    const body = new FormData();
    body.append('Path', path);
    body.append('Visibility', visibility);
    body.append('Content', new Blob([code], { type: 'application/javascript' }), 'fn.js');
    const res = await fetch(
      `${SLS_UPLOAD}/Services/${serviceSid}/Functions/${functionSid}/Versions`,
      {
        method: 'POST',
        headers: { Authorization: 'Basic ' + btoa(`${sid}:${token}`) },
        body,
      },
    );
    if (!res.ok) throw new Error(`Upload ${res.status}: ${await res.text().catch(() => '')}`);
    return res.json() as Promise<SlsFunctionVersion>;
  },

  async setVariable(
    sid: string,
    token: string,
    serviceSid: string,
    envSid: string,
    key: string,
    value: string,
  ): Promise<SlsVariable> {
    return slsFetch<SlsVariable>(`/Services/${serviceSid}/Environments/${envSid}/Variables`, sid, token, {
      method: 'POST',
      form: { Key: key, Value: value },
    });
  },

  async triggerBuild(
    sid: string,
    token: string,
    serviceSid: string,
    functionVersionSids: string[],
  ): Promise<SlsBuild> {
    const empty = functionVersionSids.filter(Boolean);
    if (empty.length === 0) throw new Error('No valid function version SIDs to build');
    // Twilio requires repeated keys (not bracket notation): FunctionVersions=ZN...&FunctionVersions=ZN...
    const params = new URLSearchParams();
    functionVersionSids.forEach((v) => params.append('FunctionVersions', v));
    const res = await fetch(`${SLS}/Services/${serviceSid}/Builds`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + btoa(`${sid}:${token}`),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
    if (!res.ok) throw new Error(`Build ${res.status}: ${await res.text().catch(() => '')}`);
    return res.json() as Promise<SlsBuild>;
  },

  async getBuild(sid: string, token: string, serviceSid: string, buildSid: string): Promise<SlsBuild> {
    return slsFetch<SlsBuild>(`/Services/${serviceSid}/Builds/${buildSid}`, sid, token);
  },

  async deploy(sid: string, token: string, serviceSid: string, envSid: string, buildSid: string): Promise<SlsDeployment> {
    return slsFetch<SlsDeployment>(`/Services/${serviceSid}/Environments/${envSid}/Deployments`, sid, token, {
      method: 'POST',
      form: { BuildSid: buildSid },
    });
  },
};

export type DeployProgress =
  | { step: 'api-key' }
  | { step: 'twiml-app' }
  | { step: 'create-service' }
  | { step: 'upload-functions' }
  | { step: 'set-env-vars' }
  | { step: 'build'; attempt: number }
  | { step: 'deploy' }
  | { step: 'wire-number' }
  | { step: 'done'; functionUrl: string };

export interface DeployResult {
  apiKeySid: string;
  twimlAppSid: string;
  functionUrl: string;
  serviceSid: string;
  environmentSid: string;
  configSecret: string;
}

/** Generate a 32-char random hex secret using Web Crypto. */
function generateConfigSecret(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Full auto-deploy: creates API Key, TwiML App, deploys Functions, wires phone number. */
export async function autoProvisionAll(
  accountSid: string,
  authToken: string,
  clientIdentity: string,
  callerId: string,
  numberSid: string,
  onProgress: (p: DeployProgress) => void,
): Promise<DeployResult> {
  const uniqueName = `twilio-dialpad-${Date.now()}`;

  onProgress({ step: 'api-key' });
  const key = await twilio.createApiKey(accountSid, authToken);

  onProgress({ step: 'twiml-app' });
  const app = await twilio.createTwimlApp(accountSid, authToken);

  onProgress({ step: 'create-service' });
  const service = await serverless.createService(accountSid, authToken, uniqueName);
  const env = await serverless.createEnvironment(accountSid, authToken, service.sid);

  onProgress({ step: 'upload-functions' });
  const { TOKEN_JS, VOICE_JS, INCOMING_JS, CONFIG_JS } = await import('./function-code');
  const fnToken = await serverless.createFunction(accountSid, authToken, service.sid, '/token');
  const fnVoice = await serverless.createFunction(accountSid, authToken, service.sid, '/voice');
  const fnIncoming = await serverless.createFunction(accountSid, authToken, service.sid, '/incoming');
  const fnConfig = await serverless.createFunction(accountSid, authToken, service.sid, '/config');

  const vToken = await serverless.uploadFunctionVersion(accountSid, authToken, service.sid, fnToken.sid, '/token', TOKEN_JS);
  const vVoice = await serverless.uploadFunctionVersion(accountSid, authToken, service.sid, fnVoice.sid, '/voice', VOICE_JS);
  const vIncoming = await serverless.uploadFunctionVersion(accountSid, authToken, service.sid, fnIncoming.sid, '/incoming', INCOMING_JS);
  const vConfig = await serverless.uploadFunctionVersion(accountSid, authToken, service.sid, fnConfig.sid, '/config', CONFIG_JS);

  // Guard: ensure upload returned valid SIDs before build
  if (!vToken.sid || !vVoice.sid || !vIncoming.sid || !vConfig.sid) {
    throw new Error(`Upload returned empty SID. token=${vToken.sid} voice=${vVoice.sid} incoming=${vIncoming.sid} config=${vConfig.sid}`);
  }

  onProgress({ step: 'set-env-vars' });
  const configSecret = generateConfigSecret();
  const vars: Record<string, string> = {
    ACCOUNT_SID: accountSid,
    API_KEY_SID: key.sid,
    API_KEY_SECRET: key.secret,
    TWIML_APP_SID: app.sid,
    CALLER_ID: callerId,
    CLIENT_IDENTITY: clientIdentity,
    SERVICE_SID: service.sid,
    ENVIRONMENT_SID: env.sid,
    CONFIG_SECRET: configSecret,
    INCOMING_ENABLED: 'true',
    FORWARD_ENABLED: 'false',
    // FORWARD_NUMBER intentionally omitted at init — Twilio Serverless API
    // rejects empty Value. /config endpoint creates it on first set.
  };
  for (const [k, v] of Object.entries(vars)) {
    if (!v) continue; // skip empties (Twilio rejects with "value may not be empty")
    await serverless.setVariable(accountSid, authToken, service.sid, env.sid, k, v);
  }

  onProgress({ step: 'build', attempt: 1 });
  const build = await serverless.triggerBuild(accountSid, authToken, service.sid, [
    vToken.sid, vVoice.sid, vIncoming.sid, vConfig.sid,
  ]);

  // Poll until build completes (up to 2 min)
  let buildStatus = build.status;
  let attempts = 0;
  while (buildStatus === 'building' && attempts < 24) {
    await sleep(5000);
    attempts++;
    onProgress({ step: 'build', attempt: attempts + 1 });
    const b = await serverless.getBuild(accountSid, authToken, service.sid, build.sid);
    buildStatus = b.status;
  }
  if (buildStatus !== 'completed') {
    throw new Error(`Build ${buildStatus} after ${attempts} polls. Check Twilio Functions console.`);
  }

  onProgress({ step: 'deploy' });
  await serverless.deploy(accountSid, authToken, service.sid, env.sid, build.sid);

  // Get the deployed environment URL
  const deployedEnv = await serverless.getEnvironment(accountSid, authToken, service.sid, env.sid);
  const functionUrl = `https://${deployedEnv.domain_name}`;

  // Wire TwiML App voice URL — used by Device.connect for OUTBOUND only.
  await twilio.updateTwimlAppVoiceUrl(accountSid, authToken, app.sid, `${functionUrl}/voice`);

  onProgress({ step: 'wire-number' });
  // Wire phone number to TwiML App (same as V0). Inbound calls hit /voice via the App.
  // /voice now detects inbound via event.Direction and runs cascade routing inline —
  // so we don't need to clear VoiceApplicationSid (Twilio rejects empty values).
  await twilio.setNumberVoiceApp(accountSid, authToken, numberSid, app.sid);

  onProgress({ step: 'done', functionUrl });
  return {
    apiKeySid: key.sid,
    twimlAppSid: app.sid,
    functionUrl,
    serviceSid: service.sid,
    environmentSid: env.sid,
    configSecret,
  };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function maskSid(sid: string): string {
  if (sid.length < 6) return '***';
  return `${sid.slice(0, 2)}***${sid.slice(-4)}`;
}

// ────────────────────────────────────────────────────────────────
// SMS add-on provisioning — deploy /sms + /incoming-sms onto an
// already-provisioned service, then wire the number's Messaging webhook.
// One-time Auth Token (passed in, never stored). Idempotent.
// ────────────────────────────────────────────────────────────────

export type SmsProvisionStep =
  | 'list' | 'create-fns' | 'set-env' | 'upload' | 'build' | 'deploy' | 'wire-number' | 'done';

export async function provisionMessagingAddon(
  accountSid: string,
  authToken: string,
  opts: { serviceSid: string; environmentSid: string; functionUrl: string; callerId: string },
  onProgress?: (s: SmsProvisionStep) => void,
): Promise<void> {
  const { serviceSid, environmentSid, functionUrl, callerId } = opts;
  if (!serviceSid || !environmentSid || !functionUrl) {
    throw new Error('SMS needs a full re-run of setup (missing service/env/function URL).');
  }
  const p = (s: SmsProvisionStep) => onProgress?.(s);

  const { TOKEN_JS, VOICE_JS, INCOMING_JS, CONFIG_JS, SMS_JS, INCOMING_SMS_JS, RECORDING_STATUS_JS, DELETE_RECORDING_JS } =
    await import('./function-code');

  p('list');
  const existing = await serverless.listFunctions(accountSid, authToken, serviceSid);
  const byPath = new Map(existing.map((f) => [f.friendly_name, f.sid]));
  const ensureFn = async (path: string): Promise<string> => {
    const found = byPath.get(path);
    if (found) return found;
    const created = await serverless.createFunction(accountSid, authToken, serviceSid, path);
    byPath.set(path, created.sid);
    return created.sid;
  };

  p('create-fns');
  const fnToken = await ensureFn('/token');
  const fnVoice = await ensureFn('/voice');
  const fnIncoming = await ensureFn('/incoming');
  const fnConfig = await ensureFn('/config');
  const fnSms = await ensureFn('/sms');
  const fnIncomingSms = await ensureFn('/incoming-sms');
  const fnRecording = await ensureFn('/recording-status');
  const fnDeleteRec = await ensureFn('/delete-recording');

  p('set-env');
  // /incoming-sms + /recording-status forward to our backend.
  await serverless
    .setVariable(accountSid, authToken, serviceSid, environmentSid, 'BACKEND_URL', 'https://dialler-mcp.vercel.app')
    .catch(() => undefined);
  // Recording status callback target (used by /voice when RECORD_OUTGOING=true).
  await serverless
    .setVariable(accountSid, authToken, serviceSid, environmentSid, 'RECORDING_CALLBACK', `${functionUrl}/recording-status`)
    .catch(() => undefined);

  p('upload');
  // Re-upload ALL functions (a Twilio build is the full live set) from current source.
  const vToken = await serverless.uploadFunctionVersion(accountSid, authToken, serviceSid, fnToken, '/token', TOKEN_JS);
  const vVoice = await serverless.uploadFunctionVersion(accountSid, authToken, serviceSid, fnVoice, '/voice', VOICE_JS);
  const vIncoming = await serverless.uploadFunctionVersion(accountSid, authToken, serviceSid, fnIncoming, '/incoming', INCOMING_JS);
  const vConfig = await serverless.uploadFunctionVersion(accountSid, authToken, serviceSid, fnConfig, '/config', CONFIG_JS);
  const vSms = await serverless.uploadFunctionVersion(accountSid, authToken, serviceSid, fnSms, '/sms', SMS_JS);
  const vIncomingSms = await serverless.uploadFunctionVersion(accountSid, authToken, serviceSid, fnIncomingSms, '/incoming-sms', INCOMING_SMS_JS, 'protected');
  const vRecording = await serverless.uploadFunctionVersion(accountSid, authToken, serviceSid, fnRecording, '/recording-status', RECORDING_STATUS_JS);
  // Public visibility (like /sms): our backend calls it with the configSecret;
  // Twilio never calls it, so no Protected/X-Twilio-Signature gate.
  const vDeleteRec = await serverless.uploadFunctionVersion(accountSid, authToken, serviceSid, fnDeleteRec, '/delete-recording', DELETE_RECORDING_JS);

  const versionSids = [vToken, vVoice, vIncoming, vConfig, vSms, vIncomingSms, vRecording, vDeleteRec].map((v) => v.sid);
  if (versionSids.some((s) => !s)) throw new Error('Function upload returned an empty version SID.');

  p('build');
  const build = await serverless.triggerBuild(accountSid, authToken, serviceSid, versionSids);
  let status = build.status;
  let attempts = 0;
  while (status === 'building' && attempts < 24) {
    await sleep(5000);
    attempts++;
    const b = await serverless.getBuild(accountSid, authToken, serviceSid, build.sid);
    status = b.status;
  }
  if (status !== 'completed') throw new Error(`SMS build ${status} — check Twilio Functions logs.`);

  p('deploy');
  await serverless.deploy(accountSid, authToken, serviceSid, environmentSid, build.sid);

  p('wire-number');
  const numbers = await twilio.listPhoneNumbers(accountSid, authToken);
  const match = numbers.find((n) => n.phone_number === callerId);
  if (match) {
    await twilio.setNumberSmsUrl(accountSid, authToken, match.sid, `${functionUrl}/incoming-sms`);
  }

  p('done');
}
