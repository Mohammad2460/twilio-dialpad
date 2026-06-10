/**
 * Deepgram temporary-token minting (managed transcription, P8.3).
 *
 * Our project key (Member+) lives only here, in Vercel env, and is used to mint
 * short-lived JWTs via POST /v1/auth/grant. The JWT (scope usage:write, ~60s TTL)
 * is the only credential that reaches the client. Per Deepgram, the token only
 * needs to be valid at WebSocket *connect* — the stream then persists. We mint a
 * fresh token per metering window so a zero-balance user simply gets no next
 * token and transcription stops (the call is unaffected — separate connection).
 */

const GRANT_URL = 'https://api.deepgram.com/v1/auth/grant';

export interface DeepgramGrant {
  access_token: string;
  expires_in: number;
}

/** Mint a short-lived Deepgram JWT. Throws if the key is missing or Deepgram errors. */
export async function mintDeepgramToken(ttlSeconds = 60): Promise<DeepgramGrant> {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) throw new Error('DEEPGRAM_API_KEY not set');

  const res = await fetch(GRANT_URL, {
    method: 'POST',
    headers: { Authorization: `Token ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ttl_seconds: ttlSeconds }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`deepgram grant failed: ${res.status} ${detail}`);
  }
  const data = (await res.json()) as Partial<DeepgramGrant>;
  if (!data.access_token) throw new Error('deepgram grant returned no access_token');
  return { access_token: data.access_token, expires_in: data.expires_in ?? ttlSeconds };
}
