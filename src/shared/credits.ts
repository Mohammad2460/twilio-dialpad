/**
 * Managed-AI credits — client (extension side).
 *
 * Thin wrapper over the backend credit endpoints. The BACKEND ledger is the
 * source of truth; this module only caches the last-seen balance for UX and
 * streams the managed Claude chatbox. Never gate spend client-side — the
 * backend reserves/settles atomically and returns 402 when out of credits.
 */
import { authHeader } from './cloud';

const BASE_URL = 'https://dialler-mcp.vercel.app';

export interface CreditState {
  balance: number;
  models: { id: string }[];
  pricingVersion: number;
}

const CACHE_KEY = 'creditState';

/** Last-known balance for instant render; refreshed by getCreditBalance(). */
export async function getCachedCreditState(): Promise<CreditState | null> {
  const { [CACHE_KEY]: cached } = await chrome.storage.local.get(CACHE_KEY);
  return (cached as CreditState | undefined) ?? null;
}

/** Fetch live balance + model list; updates the cache. */
export async function getCreditBalance(userId: string): Promise<CreditState> {
  const res = await fetch(`${BASE_URL}/api/credits/${userId}`, {
    headers: { Authorization: await authHeader(userId) },
  });
  if (!res.ok) throw new Error(`credits ${res.status}`);
  const state = (await res.json()) as CreditState;
  await chrome.storage.local.set({ [CACHE_KEY]: state });
  return state;
}

/** Allowed top-up packs (must match the backend allowlist). */
export const TOPUP_PACKS = [1000, 2500, 5000] as const;

/**
 * Start a one-time credit top-up checkout and open the hosted Dodo page in a
 * new tab. `credits` must be one of TOPUP_PACKS. Returns false on failure.
 */
export async function startTopUp(userId: string, credits: number): Promise<boolean> {
  const res = await fetch(`${BASE_URL}/api/checkout/topup/${userId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: await authHeader(userId) },
    body: JSON.stringify({ credits }),
  });
  if (!res.ok) return false;
  const { checkout_url } = (await res.json()) as { checkout_url?: string };
  if (!checkout_url) return false;
  await chrome.tabs.create({ url: checkout_url });
  return true;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export type ChatEvent =
  | { type: 'delta'; text: string }
  | { type: 'done'; credits: number; balance: number }
  | { type: 'error'; error: string; balance?: number; status?: number };

/**
 * Stream a managed-Claude answer over a call transcript.
 * Yields delta/done/error events. On 402 (insufficient credits / pro required)
 * yields a single error event carrying the HTTP status so the UI can upsell.
 */
export async function* streamChat(
  userId: string,
  opts: {
    model: string;
    transcript?: string;
    messages: ChatTurn[];
    idempotencyKey?: string;
    mode?: 'call' | 'general';
  },
): AsyncGenerator<ChatEvent> {
  const res = await fetch(`${BASE_URL}/api/ai/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: await authHeader(userId),
    },
    body: JSON.stringify(opts),
  });

  if (!res.ok || !res.body) {
    let err = 'request_failed';
    try {
      err = ((await res.json()) as { error?: string }).error ?? err;
    } catch {
      /* non-JSON */
    }
    yield { type: 'error', error: err, status: res.status };
    return;
  }

  // Parse the SSE stream (event: <name>\ndata: <json>\n\n).
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const raw = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      let event = 'message';
      let dataLine = '';
      for (const line of raw.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLine = line.slice(5).trim();
      }
      if (!dataLine) continue;
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(dataLine);
      } catch {
        continue;
      }
      if (event === 'delta') yield { type: 'delta', text: String(data.text ?? '') };
      else if (event === 'done')
        yield { type: 'done', credits: Number(data.credits ?? 0), balance: Number(data.balance ?? 0) };
      else if (event === 'error')
        yield { type: 'error', error: String(data.error ?? 'error'), balance: data.balance as number | undefined };
    }
  }
}
