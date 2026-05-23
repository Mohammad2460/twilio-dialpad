/**
 * Inbound PSTN routing for the user's Twilio phone number.
 * Set as the "A call comes in" Voice URL directly on the IncomingPhoneNumber.
 *
 * Env vars (runtime-readable, updated via /config endpoint without redeploy):
 *   CLIENT_IDENTITY  — extension client name
 *   INCOMING_ENABLED — 'true'|'false' — accept calls on the extension?
 *   FORWARD_ENABLED  — 'true'|'false' — fallback/forward to FORWARD_NUMBER?
 *   FORWARD_NUMBER   — E.164 personal phone for forwarding
 */
exports.handler = function (context, event, callback) {
  const twiml = new Twilio.twiml.VoiceResponse();
  const identity = context.CLIENT_IDENTITY || 'default';
  const incomingOn = String(context.INCOMING_ENABLED || 'true').toLowerCase() === 'true';
  const forwardOn = String(context.FORWARD_ENABLED || 'false').toLowerCase() === 'true';
  const forwardTo = (context.FORWARD_NUMBER || '').toString().trim();

  if (incomingOn) {
    twiml.dial({ answerOnBridge: true, timeout: 20 }).client(identity);
    if (forwardOn && forwardTo) {
      twiml.dial({ answerOnBridge: true, timeout: 25 }).number(forwardTo);
    }
  } else if (forwardOn && forwardTo) {
    twiml.dial({ answerOnBridge: true, timeout: 25 }).number(forwardTo);
  } else {
    twiml.reject({ reason: 'busy' });
  }

  callback(null, twiml);
};
