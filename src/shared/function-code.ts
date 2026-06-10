/** Twilio Function source code — embedded so the extension auto-deploys without user copying files. */

export const TOKEN_JS = `
exports.handler = function (context, event, callback) {
  const AccessToken = Twilio.jwt.AccessToken;
  const VoiceGrant = AccessToken.VoiceGrant;
  const identity = (event.identity || 'default').toString().slice(0, 121);
  const token = new AccessToken(
    context.ACCOUNT_SID,
    context.API_KEY_SID,
    context.API_KEY_SECRET,
    { identity: identity, ttl: 3600 }
  );
  token.addGrant(new VoiceGrant({
    outgoingApplicationSid: context.TWIML_APP_SID,
    incomingAllow: true,
  }));
  const res = new Twilio.Response();
  res.appendHeader('Access-Control-Allow-Origin', '*');
  res.appendHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.appendHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.appendHeader('Content-Type', 'application/json');
  res.setBody({ token: token.toJwt(), identity: identity });
  callback(null, res);
};
`.trim();

export const VOICE_JS = `
/**
 * Unified TwiML handler — wired as the TwiML App's VoiceUrl.
 * Handles BOTH directions:
 *   - Inbound (PSTN → user's Twilio number → TwiML App → here): event.Direction === 'inbound'
 *     Runs cascade routing using INCOMING_ENABLED / FORWARD_ENABLED / FORWARD_NUMBER.
 *   - Outbound (Device.connect from extension): runs original dial logic.
 */
exports.handler = function (context, event, callback) {
  // Log every invocation — visible in Twilio Console → Functions → Logs.
  console.log('[voice]', JSON.stringify({
    Direction: event.Direction,
    To: event.To,
    From: event.From,
    CallerId: event.CallerId,
    CallSid: event.CallSid,
  }));

  const twiml = new Twilio.twiml.VoiceResponse();
  // CRITICAL: Direction='inbound' for BOTH true PSTN inbound AND Voice SDK Client outbound,
  // because the TwiML App is receiving the call in both cases. Use From= to distinguish:
  //   - From='client:<identity>' → Voice SDK Client placed an outbound call
  //   - From='+E.164' → PSTN caller dialed our Twilio number
  const from = (event.From || '').toString();
  const isClientOutbound = from.toLowerCase().startsWith('client:');

  // ── PSTN inbound — cascade routing
  if (!isClientOutbound) {
    const identity = context.CLIENT_IDENTITY || 'default';
    const incomingOn = String(context.INCOMING_ENABLED || 'true').toLowerCase() === 'true';
    const forwardOn = String(context.FORWARD_ENABLED || 'false').toLowerCase() === 'true';
    const forwardToRaw = (context.FORWARD_NUMBER || '').toString().trim();
    // Reject placeholder 'none' + non-E.164 strings — accept only +<digits>.
    const forwardTo = /^\\+\\d{6,}$/.test(forwardToRaw) ? forwardToRaw : '';

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
    return callback(null, twiml);
  }

  // ── Outbound (from Device.connect)
  const to = (event.To || '').toString().trim();
  if (!to) {
    twiml.say({ voice: 'alice' }, 'No destination provided.');
    return callback(null, twiml);
  }
  const callerId = (event.CallerId || context.CALLER_ID || '').toString().trim();

  // Hard guard: missing caller ID → Twilio rejects the dial silently. Fail loud.
  if (!callerId) {
    console.log('[voice] ERROR: no caller ID');
    twiml.say({ voice: 'alice' }, 'Configuration error. The caller ID is missing. Please re-run setup.');
    return callback(null, twiml);
  }

  // Twilio refuses calls where callerId equals destination. Catch early.
  if (callerId === to) {
    twiml.say({ voice: 'alice' }, 'You cannot dial your own Twilio number from this device. Please dial a different number.');
    return callback(null, twiml);
  }

  const dial = twiml.dial({ callerId: callerId, answerOnBridge: true, timeout: 30 });
  if (/^\\+?\\d{6,}$/.test(to.replace(/[\\s\\-()]/g, ''))) {
    dial.number(to);
  } else {
    dial.client(to);
  }
  callback(null, twiml);
};
`.trim();

export const INCOMING_JS = `
/**
 * Inbound PSTN routing for the user's Twilio phone number.
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
    // Ring the extension client first; fall back to PSTN forward if no answer.
    twiml.dial({ answerOnBridge: true, timeout: 20 }).client(identity);
    if (forwardOn && forwardTo) {
      // Cascading: if client dial finishes without bridge, this fires next.
      twiml.dial({ answerOnBridge: true, timeout: 25 }).number(forwardTo);
    }
  } else if (forwardOn && forwardTo) {
    // Extension disabled → forward immediately.
    twiml.dial({ answerOnBridge: true, timeout: 25 }).number(forwardTo);
  } else {
    // Both off — politely reject so caller hears busy signal.
    twiml.reject({ reason: 'busy' });
  }

  callback(null, twiml);
};
`.trim();

export const CONFIG_JS = `
/**
 * Runtime update of Twilio Function env vars from the extension.
 * Updates INCOMING_ENABLED / FORWARD_ENABLED / FORWARD_NUMBER on the Service Environment.
 * Auth: shared secret (CONFIG_SECRET) — extension passes it as event.secret.
 *
 * Required env vars (set during provisioning):
 *   ACCOUNT_SID
 *   API_KEY_SID
 *   API_KEY_SECRET
 *   SERVICE_SID
 *   ENVIRONMENT_SID
 *   CONFIG_SECRET
 */
exports.handler = async function (context, event, callback) {
  const res = new Twilio.Response();
  res.appendHeader('Access-Control-Allow-Origin', '*');
  res.appendHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.appendHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.appendHeader('Content-Type', 'application/json');

  try {
    if (!event.secret || event.secret !== context.CONFIG_SECRET) {
      res.setStatusCode(401);
      res.setBody({ ok: false, error: 'unauthorized' });
      return callback(null, res);
    }

    const updates = {};
    if (typeof event.incomingEnabled === 'boolean' || event.incomingEnabled === 'true' || event.incomingEnabled === 'false') {
      updates.INCOMING_ENABLED = String(event.incomingEnabled);
    }
    if (typeof event.forwardEnabled === 'boolean' || event.forwardEnabled === 'true' || event.forwardEnabled === 'false') {
      updates.FORWARD_ENABLED = String(event.forwardEnabled);
    }
    // Twilio Serverless rejects empty Value. If user clears the number,
    // set placeholder 'none' — /voice treats anything falsy/non-E.164 as no forward.
    if (typeof event.forwardNumber === 'string') {
      updates.FORWARD_NUMBER = event.forwardNumber.trim() || 'none';
    }

    if (Object.keys(updates).length === 0) {
      res.setBody({ ok: true, updated: [] });
      return callback(null, res);
    }

    const auth = Buffer.from(context.API_KEY_SID + ':' + context.API_KEY_SECRET).toString('base64');
    const base = 'https://serverless.twilio.com/v1/Services/' + context.SERVICE_SID + '/Environments/' + context.ENVIRONMENT_SID + '/Variables';

    // List existing variables to know whether to POST (create) or POST /{Sid} (update).
    const listRes = await fetch(base + '?PageSize=100', {
      headers: { Authorization: 'Basic ' + auth },
    });
    if (!listRes.ok) {
      const t = await listRes.text();
      res.setStatusCode(502);
      res.setBody({ ok: false, error: 'list_failed', detail: t });
      return callback(null, res);
    }
    const listJson = await listRes.json();
    const existing = {};
    (listJson.variables || []).forEach(function (v) { existing[v.key] = v.sid; });

    const updated = [];
    for (const key of Object.keys(updates)) {
      const value = updates[key];
      const url = existing[key] ? (base + '/' + existing[key]) : base;
      const body = existing[key]
        ? 'Value=' + encodeURIComponent(value)
        : 'Key=' + encodeURIComponent(key) + '&Value=' + encodeURIComponent(value);
      const upRes = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: 'Basic ' + auth,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body,
      });
      if (!upRes.ok) {
        const t = await upRes.text();
        res.setStatusCode(502);
        res.setBody({ ok: false, error: 'update_failed', key: key, detail: t });
        return callback(null, res);
      }
      updated.push(key);
    }

    res.setBody({ ok: true, updated: updated });
    return callback(null, res);
  } catch (e) {
    res.setStatusCode(500);
    res.setBody({ ok: false, error: String(e && e.message || e) });
    return callback(null, res);
  }
};
`.trim();

export const SMS_JS = `
/**
 * Outbound SMS sender. Called by our backend (which holds the decrypted
 * configSecret). Auth: event.secret === CONFIG_SECRET. Sends via the Twilio
 * Messages API using the API Key SID/Secret already in env (no Auth Token).
 */
exports.handler = async function (context, event, callback) {
  const res = new Twilio.Response();
  res.appendHeader('Access-Control-Allow-Origin', '*');
  res.appendHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.appendHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.appendHeader('Content-Type', 'application/json');
  try {
    if (!event.secret || event.secret !== context.CONFIG_SECRET) {
      res.setStatusCode(401); res.setBody({ ok: false, error: 'unauthorized' }); return callback(null, res);
    }
    const to = (event.To || '').toString().trim();
    const body = (event.Body || '').toString();
    const from = (context.CALLER_ID || '').toString().trim();
    if (!to || !body) { res.setStatusCode(400); res.setBody({ ok: false, error: 'missing To/Body' }); return callback(null, res); }
    if (!from) { res.setStatusCode(500); res.setBody({ ok: false, error: 'no CALLER_ID configured' }); return callback(null, res); }
    const auth = Buffer.from(context.API_KEY_SID + ':' + context.API_KEY_SECRET).toString('base64');
    const params = new URLSearchParams({ To: to, From: from, Body: body });
    const r = await fetch('https://api.twilio.com/2010-04-01/Accounts/' + context.ACCOUNT_SID + '/Messages.json', {
      method: 'POST',
      headers: { Authorization: 'Basic ' + auth, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    const data = await r.json();
    if (!r.ok) { res.setStatusCode(502); res.setBody({ ok: false, error: (data && data.message) || ('send failed ' + r.status) }); return callback(null, res); }
    res.setBody({ ok: true, sid: data.sid, from: from });
    return callback(null, res);
  } catch (e) {
    res.setStatusCode(500); res.setBody({ ok: false, error: String((e && e.message) || e) }); return callback(null, res);
  }
};
`.trim();

export const INCOMING_SMS_JS = `
/**
 * Inbound SMS webhook. Deploy with PROTECTED visibility so Twilio validates the
 * X-Twilio-Signature before this runs (we never handle the Auth Token).
 * Forwards the message to our backend for storage (auth = shared CONFIG_SECRET).
 */
exports.handler = async function (context, event, callback) {
  const from = (event.From || '').toString();
  const to = (event.To || '').toString();
  const body = (event.Body || '').toString();
  const messageSid = (event.MessageSid || event.SmsSid || '').toString();
  const twiml = new Twilio.twiml.MessagingResponse();
  try {
    await fetch((context.BACKEND_URL || 'https://dialler-mcp.vercel.app') + '/api/sms/inbound', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountSid: context.ACCOUNT_SID, from: from, to: to, body: body, messageSid: messageSid, secret: context.CONFIG_SECRET }),
    });
  } catch (e) {
    console.error('[incoming-sms] forward failed', e);
  }
  // Compliance: Twilio Advanced Opt-Out handles STOP/START/HELP at the account
  // level. Provide a HELP reply as a fallback.
  if (body.trim().toUpperCase() === 'HELP') {
    twiml.message('Reply STOP to unsubscribe. Msg & data rates may apply.');
  }
  return callback(null, twiml);
};
`.trim();
