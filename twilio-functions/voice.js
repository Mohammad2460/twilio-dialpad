/**
 * Unified TwiML handler — wired as the TwiML App's VoiceUrl.
 * Handles BOTH directions:
 *   - Inbound (PSTN → user's Twilio number → TwiML App → here): event.Direction === 'inbound'
 *     Runs cascade routing using INCOMING_ENABLED / FORWARD_ENABLED / FORWARD_NUMBER.
 *   - Outbound (Device.connect from extension): runs original dial logic.
 *
 * Env vars:
 *   CALLER_ID         — default outbound caller ID (overridable per-call via event.CallerId)
 *   CLIENT_IDENTITY   — extension client name (inbound destination)
 *   INCOMING_ENABLED  — 'true' | 'false'
 *   FORWARD_ENABLED   — 'true' | 'false'
 *   FORWARD_NUMBER    — E.164 personal phone, or 'none' to disable
 */
exports.handler = function (context, event, callback) {
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

  if (!isClientOutbound) {
    const identity = context.CLIENT_IDENTITY || 'default';
    const incomingOn = String(context.INCOMING_ENABLED || 'true').toLowerCase() === 'true';
    const forwardOn = String(context.FORWARD_ENABLED || 'false').toLowerCase() === 'true';
    const forwardToRaw = (context.FORWARD_NUMBER || '').toString().trim();
    // Reject placeholder + bare non-E.164 strings.
    const forwardTo = /^\+\d{6,}$/.test(forwardToRaw) ? forwardToRaw : '';

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

  const to = (event.To || '').toString().trim();
  if (!to) {
    twiml.say({ voice: 'alice' }, 'No destination provided.');
    return callback(null, twiml);
  }
  const callerId = (event.CallerId || context.CALLER_ID || '').toString().trim();

  // Twilio rejects calls where callerId == destination. Fail loud so UI doesn't hang.
  if (callerId && callerId === to) {
    twiml.say({ voice: 'alice' }, 'You cannot dial your own Twilio number from this device. Please dial a different number.');
    return callback(null, twiml);
  }

  const dial = twiml.dial({ callerId: callerId, answerOnBridge: true, timeout: 30 });
  if (/^\+?\d{6,}$/.test(to.replace(/[\s\-()]/g, ''))) {
    dial.number(to);
  } else {
    dial.client(to);
  }
  callback(null, twiml);
};
