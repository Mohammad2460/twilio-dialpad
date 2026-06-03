/**
 * Product-analytics telemetry — anonymous, fire-and-forget, MV3-safe.
 *
 * Design (post red-team):
 * - SINGLE WRITER: only the service worker mutates the persisted queue. Pages
 *   (side panel, options) never touch chrome.storage for telemetry — they hand
 *   events to the SW via runtime message. This removes the cross-context
 *   read-modify-write race that could silently drop events.
 * - MV3-safe: queue lives in chrome.storage.local; flushed on SW wake + on each
 *   ingested event. SW death mid-flush = resend (idempotent), never loss.
 * - Never blocks/breaks product flow: all failures swallowed.
 * - Anonymous install id; user_id attached once an account exists.
 * - PII-free: meta is allowlisted client + server.
 *
 * Keep event names in sync with backend/lib/telemetry-schema.ts.
 */

const BASE_URL = 'https://dialler-mcp.vercel.app';
const QUEUE_KEY = 'telemetryQueue';
const INSTALL_KEY = 'installId';
const QUEUE_CAP = 500;

// Non-secret shared tag. NOT auth — just a cheap filter so random internet
// scripts hitting /api/events get rejected. Must match TEL_INGEST_KEY on backend.
export const TELEMETRY_INGEST_KEY = 'tdp_tel_b7f4c1a9e2d6483a';

// Runtime-message envelope pages use to hand an event to the service worker.
export const TELEMETRY_MSG = 'telemetry.event' as const;

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

export interface QueuedEvent {
  id: string;
  name: TelemetryEventName;
  ts: number;
  meta?: Record<string, MetaValue>;
}

interface TelemetryMessage {
  type: typeof TELEMETRY_MSG;
  event: QueuedEvent;
}

// In a page (side panel / options) `window` exists; in the MV3 service worker it
// does not. This decides who owns the queue.
const IN_PAGE = typeof window !== 'undefined';

// ── install id ───────────────────────────────────────────────────────────────

export async function getInstallId(): Promise<string> {
  const got = await chrome.storage.local.get(INSTALL_KEY);
  const existing = got[INSTALL_KEY];
  if (typeof existing === 'string' && existing) return existing;
  const id = crypto.randomUUID();
  await chrome.storage.local.set({ [INSTALL_KEY]: id });
  return id;
}

/** Has an install id ever been minted? Used for one-time backfill of existing installs. */
export async function hasInstallId(): Promise<boolean> {
  const got = await chrome.storage.local.get(INSTALL_KEY);
  return typeof got[INSTALL_KEY] === 'string' && !!got[INSTALL_KEY];
}

// ── public API ────────────────────────────────────────────────────────────────

/**
 * Record a product event. Fire-and-forget; never throws.
 * - In a page: hand the event to the service worker (single writer).
 * - In the service worker: enqueue + flush directly.
 */
export function track(name: TelemetryEventName, meta?: Record<string, MetaValue>): void {
  const event: QueuedEvent = { id: crypto.randomUUID(), name, ts: Date.now(), meta };
  if (IN_PAGE) {
    // Hand to SW. sendMessage wakes the worker if asleep.
    try {
      const msg: TelemetryMessage = { type: TELEMETRY_MSG, event };
      const p = chrome.runtime.sendMessage(msg);
      // sendMessage may return a promise (MV3) or throw synchronously if no
      // receiver. Fall back to writing locally so the event isn't lost.
      if (p && typeof (p as Promise<unknown>).catch === 'function') {
        (p as Promise<unknown>).catch(() => void ingestEvent(event));
      }
    } catch {
      void ingestEvent(event);
    }
  } else {
    void ingestEvent(event);
  }
}

// Serializes enqueue across concurrently-arriving events in the SAME context.
// chrome.storage read-modify-write is not atomic, so two near-simultaneous
// ingestEvent calls could otherwise clobber each other's append. The chain
// forces enqueues to run one-at-a-time.
let writeChain: Promise<void> = Promise.resolve();

/**
 * Enqueue an event and attempt a flush. ONLY called in the service-worker
 * context (directly, or from the runtime-message handler). Single writer +
 * serialized appends.
 */
export async function ingestEvent(event: QueuedEvent): Promise<void> {
  writeChain = writeChain.then(() => enqueue(event)).catch(() => {});
  await writeChain;
  await flush();
}

/** Type guard for the SW message listener. */
export function isTelemetryMessage(raw: unknown): raw is TelemetryMessage {
  return (
    typeof raw === 'object' &&
    raw !== null &&
    (raw as { type?: unknown }).type === TELEMETRY_MSG &&
    typeof (raw as { event?: unknown }).event === 'object'
  );
}

/** Drain the queue. Call on service-worker startup. */
export async function flushTelemetry(): Promise<void> {
  await flush();
}

// ── internals ─────────────────────────────────────────────────────────────────

async function enqueue(event: QueuedEvent): Promise<void> {
  try {
    const q = await readQueue();
    q.push(event);
    // Overflow: drop NEWEST (keep oldest funnel-entry events, which matter most).
    const trimmed = q.length > QUEUE_CAP ? q.slice(0, QUEUE_CAP) : q;
    await chrome.storage.local.set({ [QUEUE_KEY]: trimmed });
  } catch {
    /* storage unavailable — drop silently */
  }
}

let flushing = false;

async function flush(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    const q = await readQueue();
    if (q.length === 0) return;

    const installId = await getInstallId();
    const userId = await getLinkedUserId();

    const batch = q.slice(0, 50);
    const res = await fetch(`${BASE_URL}/api/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-tel-key': TELEMETRY_INGEST_KEY,
      },
      body: JSON.stringify({
        installId,
        userId: userId ?? null,
        events: batch.map((e) => ({ id: e.id, name: e.name, ts: e.ts, meta: e.meta })),
      }),
    });

    if (res.ok || res.status === 422) {
      // ok → delivered. 422 → permanently malformed; drop so it can't wedge the
      // queue. Re-read the queue first so events enqueued during the request are
      // preserved (single-writer, but SW could have re-entered via wake).
      const fresh = await readQueue();
      const sentIds = new Set(batch.map((e) => e.id));
      const remaining = fresh.filter((e) => !sentIds.has(e.id));
      await chrome.storage.local.set({ [QUEUE_KEY]: remaining });
      if (remaining.length > 0) {
        flushing = false;
        void flush();
        return;
      }
    }
    // 401/429/5xx/network: keep queue, retry on next event/wake.
  } catch {
    /* keep queue, retry later */
  } finally {
    flushing = false;
  }
}

async function readQueue(): Promise<QueuedEvent[]> {
  try {
    const got = await chrome.storage.local.get(QUEUE_KEY);
    const q = got[QUEUE_KEY];
    if (!Array.isArray(q)) return [];
    // Drop corrupt/legacy elements so one bad row can't 422 a whole batch.
    return (q as unknown[]).filter(isValidEvent) as QueuedEvent[];
  } catch {
    return [];
  }
}

function isValidEvent(e: unknown): e is QueuedEvent {
  if (typeof e !== 'object' || e === null) return false;
  const o = e as Record<string, unknown>;
  return typeof o.id === 'string' && typeof o.name === 'string' && typeof o.ts === 'number';
}

async function getLinkedUserId(): Promise<string | null> {
  try {
    const { cloudUserId } = await chrome.storage.local.get('cloudUserId');
    return typeof cloudUserId === 'string' ? cloudUserId : null;
  } catch {
    return null;
  }
}
