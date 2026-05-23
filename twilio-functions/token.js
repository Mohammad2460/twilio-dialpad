/**
 * Mints a Twilio Voice Access Token for the extension client.
 *
 * Env vars required (set in Twilio Functions service):
 *   ACCOUNT_SID     — ACxxxxxxxxxxxxxxxx
 *   API_KEY_SID     — SKxxxxxxxxxxxxxxxx
 *   API_KEY_SECRET  — (Twilio API Key secret, shown once at creation)
 *   TWIML_APP_SID   — APxxxxxxxxxxxxxxxx (the TwiML App whose VoiceUrl = this Function's /voice)
 *
 * Query / form params:
 *   identity  — Twilio Client identity (extension user)
 *
 * Returns: { token: string, identity: string }
 */
exports.handler = function (context, event, callback) {
  const AccessToken = Twilio.jwt.AccessToken;
  const VoiceGrant = AccessToken.VoiceGrant;

  const identity = (event.identity || 'default').toString().slice(0, 121);

  const token = new AccessToken(
    context.ACCOUNT_SID,
    context.API_KEY_SID,
    context.API_KEY_SECRET,
    { identity: identity, ttl: 3600 },
  );

  token.addGrant(
    new VoiceGrant({
      outgoingApplicationSid: context.TWIML_APP_SID,
      incomingAllow: true,
    }),
  );

  const res = new Twilio.Response();
  res.appendHeader('Access-Control-Allow-Origin', '*');
  res.appendHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.appendHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.appendHeader('Content-Type', 'application/json');
  res.setBody({ token: token.toJwt(), identity: identity });
  callback(null, res);
};
