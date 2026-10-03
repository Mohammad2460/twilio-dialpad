/**
 * Ledger key for one metered vendor grant (an LLM call, a transcription window).
 *
 * Always unique: every grant must own its reservation so it is held and settled
 * on its own. A client-supplied key is kept only as a sanitized trace prefix —
 * on its own it never decides which ledger row a request maps to.
 */
export function reservationKey(scope: string, clientKey?: unknown): string {
  return `${reservationKeyPrefix(scope, clientKey) ?? `${scope}:`}${crypto.randomUUID()}`;
}

/** `scope:trace:` for a usable client key, else null. Every key reservationKey
 *  builds from that client key starts with it. */
export function reservationKeyPrefix(scope: string, clientKey?: unknown): string | null {
  const trace =
    typeof clientKey === 'string' ? clientKey.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 48) : '';
  return trace ? `${scope}:${trace}:` : null;
}
