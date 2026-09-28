/**
 * Turn whatever the Twilio Voice SDK (or our token fetch) threw into a message a
 * user can act on. The SDK sometimes rejects with non-Error values or errors
 * whose `message` is empty — which previously rendered as the literal
 * "undefined" in the status bar.
 */

const FALLBACK =
  "Couldn't connect to Twilio. Check that your Twilio account is active, then press Connect.";

// https://www.twilio.com/docs/api/errors — the ones a dialer user actually hits.
const KNOWN: Record<number, string> = {
  20003: 'Twilio rejected the credentials. Reconnect your account in Settings.',
  20005: 'Your Twilio account is not active (suspended or closed). Reactivate it at console.twilio.com.',
  20101: 'Twilio rejected the calling token. Check that your Twilio account is active.',
  20104: 'Calling token expired — press Connect to refresh.',
  31204: 'Twilio rejected the calling token. Check that your Twilio account is active.',
  31205: 'Calling token expired — press Connect to refresh.',
  31005: "Lost connection to Twilio's servers. Check your internet, then press Connect.",
  31009: "Lost connection to Twilio's servers. Check your internet, then press Connect.",
  31208: 'Microphone blocked — allow microphone access for this extension.',
  31401: 'Microphone blocked — allow microphone access for this extension.',
};

function usable(text: unknown): text is string {
  return typeof text === 'string' && text.trim() !== '' && text.trim() !== 'undefined' && text.trim() !== 'null';
}

export function describeDeviceError(err: unknown): string {
  if (err == null) return FALLBACK;
  if (typeof err === 'string') return usable(err) ? err : FALLBACK;

  const e = err as { code?: unknown; message?: unknown; description?: unknown };
  const code = typeof e.code === 'number' ? e.code : Number(e.code);
  if (Number.isFinite(code) && KNOWN[code]) return KNOWN[code];

  const text = usable(e.message) ? e.message : usable(e.description) ? e.description : null;
  if (!text) return FALLBACK;
  return Number.isFinite(code) && code > 0 ? `${text} (Twilio ${code})` : text;
}
