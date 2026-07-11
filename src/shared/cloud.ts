/**
 * Cloud sync — sends call data to the Dialler backend after each call ends.
 * Non-technical users get a personal MCP connector URL automatically.
 *
 * Design principles:
 * - Never break call flow: all network calls are fire-and-forget with silent catch
 * - Additive: local IndexedDB storage still happens independently
 * - Idempotent: upsert on server side so retries are safe
 */
import type { CallRecord, Transcript } from './types';

const BASE_URL = 'https://dialler-mcp.vercel.app';

// ── user account ─────────────────────────────────────────────────

export interface CloudAccount {
  userId: string;
  mcpUrl: string;
}

/**
 * Returns the user's cloud account, creating one if it doesn't exist yet.
 * Stores result in chrome.storage.local.
 * Safe to call repeatedly — idempotent.
 *
 * Sends the user's Twilio Account SID so the backend can dedup users who
 * uninstall + reinstall (otherwise each reinstall would mint a new userId
 * and reset the 7-day trial).
 *
 * Throws if no Twilio settings exist yet (caller should run wizard first).
 */
export async function ensureCloudAccount(): Promise<CloudAccount> {
  // Cached account (set by registerDevice during provisioning, or a legacy
  // install). We no longer mint accounts here via the SID-only path — that was
  // the forgeable hole. Account creation now happens only in registerDevice()
  // behind genuine Twilio ownership verification (Phase 0b).
  const cached = await getStoredAccount();
  if (cached) return cached;
  throw new Error('device_not_registered');
}

async function getStoredAccount(): Promise<CloudAccount | null> {
  const { cloudUserId, cloudMcpUrl } = await chrome.storage.local.get(['cloudUserId', 'cloudMcpUrl']);
  if (typeof cloudUserId === 'string' && typeof cloudMcpUrl === 'string') {
    return { userId: cloudUserId, mcpUrl: cloudMcpUrl };
  }
  return null;
}

/**
 * Register THIS device with genuine Twilio ownership proof (Phase 0b).
 * Sends accountSid + authToken (verified server-side against Twilio, then
 * discarded — never stored) and receives a per-device secret stored locally.
 * Call from the provisioning wizard / "secure this device" migration, where
 * the Auth Token is available in memory.
 */
export async function registerDevice(opts: {
  accountSid: string;
  authToken: string;
  functionUrl?: string;
  configSecret?: string;
  label?: string;
  // Backend-voice provisioning (new installs): create API key + TwiML app + wire
  // number + store email — all server-side in the same ownership-verified call.
  numberSid?: string;
  callerId?: string;
  clientIdentity?: string;
  name?: string;
  email?: string;
  marketingConsent?: boolean;
  provision?: boolean;
}): Promise<CloudAccount> {
  const res = await fetch(`${BASE_URL}/api/devices/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
  });
  if (!res.ok) throw new Error(`[cloud] device register failed: ${res.status}`);
  const data = (await res.json()) as {
    userId: string;
    deviceId: string;
    deviceSecret: string;
    mcpUrl: string;
  };
  await chrome.storage.local.set({
    cloudUserId: data.userId,
    cloudMcpUrl: data.mcpUrl,
    cloudDeviceId: data.deviceId,
    cloudDeviceSecret: data.deviceSecret,
  });
  return { userId: data.userId, mcpUrl: data.mcpUrl };
}

/** True once this device has a per-device secret (i.e. is migrated to Phase 0b auth). */
export async function isDeviceRegistered(): Promise<boolean> {
  const { cloudDeviceId, cloudDeviceSecret } = await chrome.storage.local.get([
    'cloudDeviceId',
    'cloudDeviceSecret',
  ]);
  return typeof cloudDeviceId === 'string' && typeof cloudDeviceSecret === 'string';
}

/**
 * Authorization header for private backend calls.
 * Device bearer `<deviceId>.<secret>` when registered; otherwise the legacy
 * bare `<userId>` (accepted only during the backend migration window).
 */
export async function authHeader(userId: string): Promise<string> {
  const { cloudDeviceId, cloudDeviceSecret } = await chrome.storage.local.get([
    'cloudDeviceId',
    'cloudDeviceSecret',
  ]);
  if (typeof cloudDeviceId === 'string' && typeof cloudDeviceSecret === 'string') {
    return `Bearer ${cloudDeviceId}.${cloudDeviceSecret}`;
  }
  return `Bearer ${userId}`;
}

// ── call sync ────────────────────────────────────────────────────

/**
 * Syncs a completed call (and optional transcript) to the cloud backend.
 * Fire-and-forget — rejects are silently swallowed.
 */
export function syncCallToCloud(
  userId: string,
  record: CallRecord,
  transcript?: Transcript | null,
): void {
  // Build the payload matching IngestCallSchema on the backend
  const payload = {
    meta: {
      callSid: record.sid ?? record.id,
      direction: record.direction,
      number: record.number,
      startedAt: record.startedAt,
      durationSec: record.durationSec,
      status: record.status,
      contact: record.contact ?? undefined,
    },
    transcript: transcript
      ? {
          segments: transcript.segments,
          startedAt: transcript.startedAt,
          endedAt: transcript.endedAt,
        }
      : undefined,
  };

  authHeader(userId)
    .then((auth) =>
      fetch(`${BASE_URL}/api/calls/${userId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: auth,
        },
        body: JSON.stringify(payload),
      }),
    )
    .then((res) => {
      // Surface 402 (subscription expired) to options page via local flag.
      if (res.status === 402) {
        chrome.storage.local.set({ cloudSyncBlocked: true }).catch(() => {});
      } else if (res.ok) {
        chrome.storage.local.set({ cloudSyncBlocked: false }).catch(() => {});
      }
    })
    .catch(() => {}); // silent — never throw, never block UI
}

// ── subscription ─────────────────────────────────────────────────

export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'cancelled' | 'expired';

export interface Subscription {
  status: SubscriptionStatus;
  hasAccess: boolean;
  daysLeft?: number;
  trialEndsAt?: string;
  currentPeriodEnd?: string;
}

/**
 * Fetch the user's current subscription state.
 * Returns null if the network fails — caller can decide how to render.
 */
export async function getSubscription(userId: string): Promise<Subscription | null> {
  try {
    const res = await fetch(`${BASE_URL}/api/subscription/${userId}`, {
      headers: { Authorization: await authHeader(userId) },
    });
    if (!res.ok) return null;
    return (await res.json()) as Subscription;
  } catch {
    return null;
  }
}

/**
 * Create a Dodo checkout session and return the hosted payment URL.
 * Caller opens the URL in a new tab.
 */
export async function getCheckoutUrl(userId: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/checkout/${userId}`, {
    method: 'POST',
    headers: { Authorization: await authHeader(userId) },
  });
  if (!res.ok) {
    let detail = '';
    try {
      const j = (await res.json()) as { error?: string; detail?: string };
      detail = j.detail ?? j.error ?? '';
    } catch {
      /* noop */
    }
    throw new Error(`Checkout failed (${res.status})${detail ? `: ${detail}` : ''}`);
  }
  const data = (await res.json()) as { checkout_url: string };
  return data.checkout_url;
}

/**
 * Cancel the user's subscription at period end.
 * Server flips status to 'cancelled' optimistically + webhook re-confirms.
 * Returns `cancelsAt` ISO date — access continues until then.
 */
export async function cancelSubscription(userId: string): Promise<{
  ok: boolean;
  cancelsAt?: string;
  error?: string;
}> {
  try {
    const res = await fetch(`${BASE_URL}/api/subscription/${userId}`, {
      method: 'DELETE',
      headers: { Authorization: await authHeader(userId) },
    });
    if (!res.ok) {
      let detail = '';
      try {
        const j = (await res.json()) as { error?: string; detail?: string };
        detail = j.detail ?? j.error ?? '';
      } catch {
        /* noop */
      }
      return { ok: false, error: detail || `Cancel failed (${res.status})` };
    }
    const data = (await res.json()) as { ok: boolean; cancelsAt?: string };
    return { ok: true, cancelsAt: data.cancelsAt };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Network error' };
  }
}

// ── email capture ─────────────────────────────────────────────────

/**
 * Submit the user's email for product transactional emails (and optionally
 * marketing). Returns a devCode in non-production environments for convenience.
 * Requires productConsent: true — enforced by the backend.
 */
export async function setEmail(
  userId: string,
  opts: { email: string; productConsent: boolean; marketingConsent?: boolean },
): Promise<{ ok: boolean; devCode?: string }> {
  const res = await fetch(`${BASE_URL}/api/email/${userId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: await authHeader(userId),
    },
    body: JSON.stringify(opts),
  });
  if (!res.ok) {
    let detail = '';
    try {
      const j = (await res.json()) as { error?: string; detail?: string };
      detail = j.detail ?? j.error ?? '';
    } catch {
      /* noop */
    }
    throw new Error(`setEmail failed (${res.status})${detail ? `: ${detail}` : ''}`);
  }
  return (await res.json()) as { ok: boolean; devCode?: string };
}

/**
 * Verify the 6-digit code sent to the user's email.
 */
export async function verifyEmail(userId: string, code: string): Promise<{ ok: boolean }> {
  const res = await fetch(`${BASE_URL}/api/email/${userId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: await authHeader(userId),
    },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) {
    let detail = '';
    try {
      const j = (await res.json()) as { error?: string; detail?: string };
      detail = j.detail ?? j.error ?? '';
    } catch {
      /* noop */
    }
    throw new Error(`verifyEmail failed (${res.status})${detail ? `: ${detail}` : ''}`);
  }
  return (await res.json()) as { ok: boolean };
}

// ── health check ─────────────────────────────────────────────────

export async function checkCloudHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/api/health`, { method: 'GET' });
    return res.ok;
  } catch {
    return false;
  }
}
