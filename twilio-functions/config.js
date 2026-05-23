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
    // set placeholder 'none' — /voice treats anything non-E.164 as no forward.
    if (typeof event.forwardNumber === 'string') {
      updates.FORWARD_NUMBER = event.forwardNumber.trim() || 'none';
    }

    if (Object.keys(updates).length === 0) {
      res.setBody({ ok: true, updated: [] });
      return callback(null, res);
    }

    const auth = Buffer.from(context.API_KEY_SID + ':' + context.API_KEY_SECRET).toString('base64');
    const base = 'https://serverless.twilio.com/v1/Services/' + context.SERVICE_SID + '/Environments/' + context.ENVIRONMENT_SID + '/Variables';

    const listRes = await fetch(base + '?PageSize=100', {
      headers: { Authorization: 'Basic ' + auth },
    });
    if (!listRes.ok) {
      res.setStatusCode(502);
      res.setBody({ ok: false, error: 'list_failed', detail: await listRes.text() });
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
        res.setStatusCode(502);
        res.setBody({ ok: false, error: 'update_failed', key: key, detail: await upRes.text() });
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
