/**
 * Client entitlements — a UX/cache layer over the backend subscription state.
 *
 * IMPORTANT: the backend is the source of truth. Every paid server capability
 * (call-sync, MCP, SMS, AI) is enforced server-side. This module only decides
 * what the UI offers/gates; it can fail-open for a paying user during a network
 * blip without granting actual paid server access.
 */
import { getSubscription, type Subscription } from './cloud';

export type Tier = 'free' | 'pro';

/** Pro-only capabilities (free tier: calling, redial, 20-call history, BYO-key
 *  live transcript, talk-ratio, auto-dial capped 15/day, HubSpot pop). */
export type Feature =
  | 'autodial_unlimited'
  | 'ai_analysis'
  | 'cloud_history'
  | 'sms'
  | 'recording';

const PRO_FEATURES: readonly Feature[] = [
  'autodial_unlimited',
  'ai_analysis',
  'cloud_history',
  'sms',
  'recording',
];

export interface Entitlements {
  tier: Tier;
  isPro: boolean;
  trialing: boolean;
  daysLeft?: number;
  fromCache: boolean;
  stale: boolean;
  can: (f: Feature) => boolean;
}

const CACHE_KEY = 'entitlementsCache';
const REFRESH_MS = 15 * 60 * 1000; // re-fetch if cache older than this
const GRACE_MS = 72 * 60 * 60 * 1000; // honor last-known-good for offline paying users

interface Cached {
  sub: Subscription;
  fetchedAt: number;
}

function build(sub: Subscription | null, fromCache: boolean, stale: boolean): Entitlements {
  const isPro = !!sub?.hasAccess; // trial-with-access counts as Pro (trial unlocks all)
  return {
    tier: isPro ? 'pro' : 'free',
    isPro,
    trialing: sub?.status === 'trialing' && !!sub?.hasAccess,
    daysLeft: sub?.daysLeft,
    fromCache,
    stale,
    can: (f) => isPro && PRO_FEATURES.includes(f),
  };
}

const FREE: Entitlements = build(null, false, false);

async function readCache(): Promise<Cached | null> {
  const got = await chrome.storage.local.get(CACHE_KEY);
  const c = got[CACHE_KEY] as Cached | undefined;
  if (c && typeof c.fetchedAt === 'number' && c.sub) return c;
  return null;
}

async function writeCache(sub: Subscription): Promise<void> {
  await chrome.storage.local.set({ [CACHE_KEY]: { sub, fetchedAt: Date.now() } satisfies Cached });
}

/**
 * Resolve entitlements for the given cloud userId.
 * - Fresh cache (< 15 min) → use it.
 * - Else live fetch → cache + return.
 * - Network failure → honor last-known-good for up to 72h IF the user had
 *   access (don't lock out a payer on a blip); otherwise default to free.
 */
export async function getEntitlements(userId: string | null): Promise<Entitlements> {
  if (!userId) return FREE;

  const cached = await readCache();
  if (cached && Date.now() - cached.fetchedAt < REFRESH_MS) {
    return build(cached.sub, true, false);
  }

  const sub = await getSubscription(userId);
  if (sub) {
    await writeCache(sub);
    return build(sub, false, false);
  }

  // Offline / fetch failed.
  if (cached && cached.sub.hasAccess && Date.now() - cached.fetchedAt < GRACE_MS) {
    return build(cached.sub, true, true); // grace: keep paying user unlocked
  }
  return FREE; // expired / unknown → never grant Pro optimistically
}

/** Pure helper for tests + callers holding a Subscription already. */
export function entitlementsFromSubscription(sub: Subscription | null): Entitlements {
  return build(sub, false, false);
}
