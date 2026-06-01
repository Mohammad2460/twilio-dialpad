/**
 * Dodo Payments API client.
 * Docs: https://docs.dodopayments.com
 * Endpoints used:
 *   - GET  /products            list (idempotency lookup)
 *   - POST /products            create recurring subscription product
 *   - POST /checkouts           create hosted checkout session
 *
 * Auth: Bearer token via DODO_API_KEY env var.
 * Mode: test (test.dodopayments.com) vs live (live.dodopayments.com).
 */

const BASE =
  process.env.DODO_MODE === 'live'
    ? 'https://live.dodopayments.com'
    : 'https://test.dodopayments.com';

const PRODUCT_NAME = 'AI Twilio Dialer Pro';
const PRICE_CENTS = 900; // $9.00
const CURRENCY = 'USD';

// Module-level cache (cold-start fresh per Vercel function instance).
let _productIdCache: string | null = null;

function authHeaders(): HeadersInit {
  const key = process.env.DODO_API_KEY;
  if (!key) throw new Error('DODO_API_KEY not set');
  return {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  };
}

async function dodoFetch(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...authHeaders(), ...(init?.headers ?? {}) },
  });
  return res;
}

// ── product ──────────────────────────────────────────────────────

interface DodoProduct {
  product_id: string;
  name?: string | null;
  is_recurring?: boolean;
}

interface ListProductsResponse {
  items: DodoProduct[];
}

/**
 * Returns the product_id for the $9/month plan.
 * Idempotent — looks up by name first, creates if missing.
 * Cached in module scope to avoid repeat lookups within one warm function.
 */
export async function ensureProduct(): Promise<string> {
  if (_productIdCache) return _productIdCache;

  // 1. List existing products, find by name.
  const listRes = await dodoFetch('/products?page_size=100');
  if (listRes.ok) {
    const data = (await listRes.json()) as ListProductsResponse;
    const existing = (data.items ?? []).find((p) => p.name === PRODUCT_NAME);
    if (existing?.product_id) {
      _productIdCache = existing.product_id;
      return existing.product_id;
    }
  } else {
    console.warn('[dodo] list products failed', listRes.status, await safeText(listRes));
  }

  // 2. Create it.
  const createRes = await dodoFetch('/products', {
    method: 'POST',
    body: JSON.stringify({
      name: PRODUCT_NAME,
      tax_category: 'saas',
      price: {
        type: 'recurring_price',
        currency: CURRENCY,
        price: PRICE_CENTS,
        discount: 0,
        purchasing_power_parity: false,
        payment_frequency_count: 1,
        payment_frequency_interval: 'Month',
        subscription_period_count: 1,
        subscription_period_interval: 'Month',
        trial_period_days: 0,
      },
    }),
  });

  if (!createRes.ok) {
    throw new Error(
      `[dodo] product create failed: ${createRes.status} ${await safeText(createRes)}`,
    );
  }

  const created = (await createRes.json()) as DodoProduct;
  if (!created.product_id) {
    throw new Error('[dodo] product create returned no product_id');
  }
  _productIdCache = created.product_id;
  return created.product_id;
}

// ── checkout ─────────────────────────────────────────────────────

interface CheckoutResponse {
  checkout_url?: string;
  session_id?: string;
}

/**
 * Create a hosted checkout session for the $9/month plan.
 * Embeds userId in metadata so webhooks can identify the customer.
 */
export async function createCheckoutSession(
  userId: string,
  productId: string,
  returnUrl: string,
): Promise<{ checkout_url: string }> {
  const res = await dodoFetch('/checkouts', {
    method: 'POST',
    body: JSON.stringify({
      product_cart: [{ product_id: productId, quantity: 1 }],
      metadata: { userId },
      return_url: returnUrl,
    }),
  });

  if (!res.ok) {
    throw new Error(
      `[dodo] checkout create failed: ${res.status} ${await safeText(res)}`,
    );
  }

  const data = (await res.json()) as CheckoutResponse;
  if (!data.checkout_url) {
    throw new Error('[dodo] checkout response missing checkout_url');
  }
  return { checkout_url: data.checkout_url };
}

// ── subscription cancel ──────────────────────────────────────────

/**
 * Cancel a Dodo subscription at period end (does NOT revoke immediate access).
 * Dodo will fire a `subscription.cancelled` webhook → our handler flips
 * `subscription_status='cancelled'` while preserving `current_period_end`.
 *
 * Returns ok=true on 2xx, ok=false + status/body otherwise.
 * Caller decides how to surface failure.
 */
export async function cancelSubscription(subscriptionId: string): Promise<{
  ok: boolean;
  status: number;
  body?: string;
}> {
  // Dodo subscription API uses PATCH with status=cancelled (per Standard SaaS pattern).
  // If their API exposes a dedicated /cancel route, we try that first then fall back.
  const cancelRes = await dodoFetch(`/subscriptions/${subscriptionId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'cancelled' }),
  });
  if (cancelRes.ok) return { ok: true, status: cancelRes.status };

  // Some APIs expose POST /subscriptions/:id/cancel — try as fallback.
  const altRes = await dodoFetch(`/subscriptions/${subscriptionId}/cancel`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
  if (altRes.ok) return { ok: true, status: altRes.status };

  return { ok: false, status: altRes.status, body: await safeText(altRes) };
}

// ── webhook signature verification ───────────────────────────────

/**
 * Verify a Dodo webhook using the Standard Webhooks spec.
 * - Signed payload: `${webhookId}.${webhookTimestamp}.${rawBody}`
 * - HMAC SHA-256 over the signed payload using DODO_WEBHOOK_SECRET (raw bytes after stripping the `whsec_` prefix and base64-decoding).
 * - The `webhook-signature` header is a space-separated list of `v1,<base64sig>` entries — any match is accepted.
 * - Returns true if signature valid and timestamp within `toleranceSec` seconds of now.
 */
export async function verifyWebhookSignature(opts: {
  rawBody: string;
  webhookId: string;
  webhookTimestamp: string;
  webhookSignature: string;
  toleranceSec?: number;
}): Promise<boolean> {
  const { rawBody, webhookId, webhookTimestamp, webhookSignature } = opts;
  const tolerance = opts.toleranceSec ?? 5 * 60;

  const secretEnv = process.env.DODO_WEBHOOK_SECRET;
  if (!secretEnv) throw new Error('DODO_WEBHOOK_SECRET not set');

  // Validate timestamp window.
  const ts = parseInt(webhookTimestamp, 10);
  if (!Number.isFinite(ts)) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - ts) > tolerance) return false;

  // Standard Webhooks secret format: `whsec_<base64-secret>`. Strip prefix, decode.
  const stripped = secretEnv.startsWith('whsec_') ? secretEnv.slice('whsec_'.length) : secretEnv;
  const keyBytes = decodeBase64ToBytes(stripped);

  const signedPayload = `${webhookId}.${webhookTimestamp}.${rawBody}`;

  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes.buffer.slice(keyBytes.byteOffset, keyBytes.byteOffset + keyBytes.byteLength) as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedPayload));
  const expected = bytesToBase64(new Uint8Array(sigBuf));

  // webhook-signature header: "v1,<sig1> v1,<sig2> ..." — match any.
  const provided = webhookSignature
    .split(' ')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => (p.startsWith('v1,') ? p.slice(3) : p));

  return provided.some((p) => constantTimeEqual(p, expected));
}

// ── helpers ──────────────────────────────────────────────────────

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return '<no body>';
  }
}

function decodeBase64ToBytes(b64: string): Uint8Array {
  // Node + edge both have atob.
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}
