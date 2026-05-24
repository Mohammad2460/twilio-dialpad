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
 */
export async function ensureCloudAccount(): Promise<CloudAccount> {
  // Check cache first
  const cached = await getStoredAccount();
  if (cached) return cached;

  // First install — register with backend
  const res = await fetch(`${BASE_URL}/api/users`, { method: 'POST' });
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
  }).catch(() => {}); // silent — never throw, never block UI
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
