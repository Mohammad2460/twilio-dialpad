/**
 * Ledger key for one metered vendor grant (an LLM call, a transcription window).
 *
 * Always unique: every grant must own its reservation so it is held and settled
 * on its own. A client-supplied key is kept only as a sanitized trace prefix —
 * it never decides which ledger row a request maps to.
 */
export function reservationKey(scope: string, clientKey?: unknown): string {
  const trace =
    typeof clientKey === 'string' ? clientKey.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 48) : '';
  return trace ? `${scope}:${trace}:${crypto.randomUUID()}` : `${scope}:${crypto.randomUUID()}`;
}
