/**
 * Product-analytics telemetry — anonymous, fire-and-forget, MV3-safe.
 *
 * Design constraints:
 * - MV3 service worker is ephemeral: no in-memory queue survives. The pending
 *   queue lives in chrome.storage.local and is flushed on every track() + on
 *   service-worker wake.
 * - Never block or break product flow: all network + storage failures swallowed.
 * - Anonymous: keyed by a per-install UUID. user_id attached once known so the
 *   bottom of the funnel can dedup to real accounts.
 * - PII-free: callers pass only small, safe meta. Backend re-sanitizes anyway.
 *
 * Keep event names in sync with backend/lib/telemetry-schema.ts.
 */

const BASE_URL = 'https://dialler-mcp.vercel.app';
const QUEUE_KEY = 'telemetryQueue';
const INSTALL_KEY = 'installId';
const QUEUE_CAP = 200; // hard cap so a broken backend can't grow storage unbounded

export type TelemetryEventName =
  | 'extension_installed'
  | 'panel_opened'
  | 'wizard_started'
  | 'twilio_creds_submitted'
  | 'autodeploy_succeeded'
  | 'autodeploy_failed'
  | 'device_ready'
  | 'first_call_synced'
  | 'transcript_enabled';

type MetaValue = string | number | boolean;

interface QueuedEvent {
  id: string;
  name: TelemetryEventName;
  ts: number;
  meta?: Record<string, MetaValue>;
}

// ── install id ───────────────────────────────────────────────────────────────

/**
 * Returns the anonymous install id, creating one on first call.
 * Safe to call from service worker, side panel, or options page.
 */
export async function getInstallId(): Promise<string> {
  const got = await chrome.storage.local.get(INSTALL_KEY);
  const existing = got[INSTALL_KEY];
  if (typeof existing === 'string' && existing) return existing;
  const id = crypto.randomUUID();
  await chrome.storage.local.set({ [INSTALL_KEY]: id });
  return id;
}

// ── public API ────────────────────────────────────────────────────────────────

/**
 * Record a product event. Enqueues then attempts an immediate flush.
 * Fire-and-forget: never throws, never blocks UI.
 */
export function track(name: TelemetryEventName, meta?: Record<string, MetaValue>): void {
  void enqueue(name, meta).then(() => flush()).catch(() => {});
}

/**
 * Flush any queued events. Call on service-worker startup to drain events that
 * were enqueued while offline or across a worker restart.
 */
export async function flushTelemetry(): Promise<void> {
  await flush();
}

// ── internals ─────────────────────────────────────────────────────────────────

async function enqueue(name: TelemetryEventName, meta?: Record<string, MetaValue>): Promise<void> {
  try {
    const q = await readQueue();
    q.push({ id: crypto.randomUUID(), name, ts: Date.now(), meta });
    // Drop oldest if we somehow exceed the cap (backend down for a long time).
    const trimmed = q.length > QUEUE_CAP ? q.slice(q.length - QUEUE_CAP) : q;
    await chrome.storage.local.set({ [QUEUE_KEY]: trimmed });
  } catch {
    /* storage unavailable — drop silently */
  }
}

let flushing = false;

async function flush(): Promise<void> {
  if (flushing) return; // simple in-process lock; storage is the durable source
  flushing = true;
  try {
    const q = await readQueue();
    if (q.length === 0) return;

    const installId = await getInstallId();
    const userId = await getLinkedUserId();

    // Send in batches of 50 (backend cap).
    const batch = q.slice(0, 50);
    const res = await fetch(`${BASE_URL}/api/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        installId,
        userId: userId ?? null,
        events: batch.map((e) => ({ id: e.id, name: e.name, ts: e.ts, meta: e.meta })),
      }),
    });

    if (res.ok) {
      // Remove the sent batch; keep the rest for the next flush.
      const remaining = q.slice(batch.length);
      await chrome.storage.local.set({ [QUEUE_KEY]: remaining });
      if (remaining.length > 0) {
        // More to send — schedule another pass without recursing under the lock.
        flushing = false;
        void flush();
        return;
      }
    } else if (res.status === 422) {
      // Malformed/blocklisted events will never succeed — drop this batch so a
      // poison event can't wedge the queue forever.
      await chrome.storage.local.set({ [QUEUE_KEY]: q.slice(batch.length) });
    }
    // Other statuses (5xx, network): leave queue intact, retry on next track/wake.
  } catch {
    /* network/storage error — keep queue, retry later */
  } finally {
    flushing = false;
  }
}

async function readQueue(): Promise<QueuedEvent[]> {
  try {
    const got = await chrome.storage.local.get(QUEUE_KEY);
    const q = got[QUEUE_KEY];
    return Array.isArray(q) ? (q as QueuedEvent[]) : [];
  } catch {
    return [];
  }
}

/**
 * The cloud user id, set by cloud.ts once an account exists. Lets us attribute
 * late-funnel events (and revenue) to the same person. Null before activation.
 */
async function getLinkedUserId(): Promise<string | null> {
  try {
    const { cloudUserId } = await chrome.storage.local.get('cloudUserId');
    return typeof cloudUserId === 'string' ? cloudUserId : null;
  } catch {
    return null;
  }
}
