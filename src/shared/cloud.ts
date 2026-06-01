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
import { storage } from './storage';

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
  // Check cache first
  const cached = await getStoredAccount();
  if (cached) return cached;

  // Read Twilio SID from settings — required for dedup.
  // Without it, registration is deferred until the wizard finishes.
  const settings = await storage.getSettings();
  if (!settings?.accountSid) {
    throw new Error('twilio_not_configured');
  }

  // First install — register with backend (or recover existing row by SID).
  const res = await fetch(`${BASE_URL}/api/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ twilioAccountSid: settings.accountSid }),
  });
  if (!res.ok) throw new Error(`[cloud] register failed: ${res.status}`);

  const data = (await res.json()) as { userId: string; mcpUrl: string };
  const account: CloudAccount = { userId: data.userId, mcpUrl: data.mcpUrl };

  await chrome.storage.local.set({ cloudUserId: account.userId, cloudMcpUrl: account.mcpUrl });
  return account;
}

async function getStoredAccount(): Promise<CloudAccount | null> {
  const { cloudUserId, cloudMcpUrl } = await chrome.storage.local.get(['cloudUserId', 'cloudMcpUrl']);
  if (typeof cloudUserId === 'string' && typeof cloudMcpUrl === 'string') {
    return { userId: cloudUserId, mcpUrl: cloudMcpUrl };
  }
  return null;
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

  fetch(`${BASE_URL}/api/calls/${userId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${userId}`,
    },
    body: JSON.stringify(payload),
  })
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
      headers: { Authorization: `Bearer ${userId}` },
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
    headers: { Authorization: `Bearer ${userId}` },
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
      headers: { Authorization: `Bearer ${userId}` },
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

// ── health check ─────────────────────────────────────────────────

export async function checkCloudHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/api/health`, { method: 'GET' });
    return res.ok;
  } catch {
    return false;
  }
}
