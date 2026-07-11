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

/**
 * Capabilities.
 * - Free tier: calling, redial, 20-call history, BYO-key live transcript,
 *   talk-ratio, auto-dial capped 15/day, HubSpot pop, gpt-5-mini chat.
 * - Trial (7d): adds `managed_transcription` (free, no credits).
 * - Paid only: everything else below.
 */
export type Feature =
  | 'managed_transcription'
  | 'autodial_unlimited'
  | 'ai_analysis'
  | 'cloud_history'
  | 'sms'
  | 'recording';

// NOTE: trial now unlocks every feature (see can() below), so there is no
// separate paid-only list. Post-trial, all features require a paid sub.

export interface Entitlements {
  tier: Tier;
  isPro: boolean;
  /** True only for a real paid subscription (active/past_due/cancelled-in-period). */
  paid: boolean;
  trialing: boolean;
  daysLeft?: number;
  fromCache: boolean;
  stale: boolean;
  can: (f: Feature) => boolean;
}

const CACHE_KEY = 'entitlementsCache';
const GRACE_MS = 72 * 60 * 60 * 1000; // honor last-known-good for offline paying users

// In-memory dedupe: several gates mount at once — share one backend request
// per panel session instead of firing N identical fetches.
let inflight: { userId: string; promise: Promise<Subscription | null> } | null = null;

interface Cached {
  sub: Subscription;
  fetchedAt: number;
}

function build(sub: Subscription | null, fromCache: boolean, stale: boolean): Entitlements {
  const trialing = sub?.status === 'trialing' && !!sub?.hasAccess;
  // Paid = elevated access that is NOT the trial (mirrors backend user_is_paid).
  const paid = !!sub?.hasAccess && sub.status !== 'trialing';
  const isPro = paid || trialing; // "has elevated access" — for display only
  return {
    tier: isPro ? 'pro' : 'free',
    isPro,
    paid,
    trialing,
    daysLeft: sub?.daysLeft,
    fromCache,
    stale,
    // Trial = full Pro: every feature unlocked for 7 days, then paid-only.
    // (Matches backend user_has_access, which already allows trialing users.)
    can: () => paid || trialing,
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
 * - Always fetch fresh from the backend (source of truth) — concurrent calls
 *   in the same panel session share one request.
 * - Network failure → honor last-known-good for up to 72h IF the user had
 *   access (don't lock out a payer on a blip); otherwise default to free.
 */
export async function getEntitlements(userId: string | null): Promise<Entitlements> {
  if (!userId) return FREE;

  if (!inflight || inflight.userId !== userId) {
    inflight = {
      userId,
      promise: getSubscription(userId).finally(() => {
        // Allow the next mount/open to fetch fresh again.
        setTimeout(() => { inflight = null; }, 5_000);
      }),
    };
  }
  const sub = await inflight.promise;
  if (sub) {
    await writeCache(sub);
    return build(sub, false, false);
  }

  // Offline / fetch failed — fall back to last-known-good.
  const cached = await readCache();
  if (cached && cached.sub.hasAccess && Date.now() - cached.fetchedAt < GRACE_MS) {
    return build(cached.sub, true, true); // grace: keep paying user unlocked
  }
  return FREE; // expired / unknown → never grant Pro optimistically
}

/** Pure helper for tests + callers holding a Subscription already. */
export function entitlementsFromSubscription(sub: Subscription | null): Entitlements {
  return build(sub, false, false);
}
