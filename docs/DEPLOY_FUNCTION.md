# Deploy the Twilio Functions

The Chrome extension speaks to a tiny Twilio Functions service that you host inside your own Twilio account. It mints calling tokens and returns TwiML for outbound calls. Your Twilio secrets stay on Twilio — the extension never sees them.

## Prereqs

- A Twilio account (any plan).
- At least one Twilio phone number (for outbound caller ID).
- The setup wizard run through **Step 2** so you have:
  - `API_KEY_SID` and `API_KEY_SECRET`
  - `TWIML_APP_SID`

## Steps

1. Open <https://console.twilio.com/us1/develop/functions/services> → **Create Service**.
   Name it `twilio-dialpad` and click **Next**.

2. **Add Function** → name `/token` → paste the contents of [`twilio-functions/token.js`](../twilio-functions/token.js).
   Set **Visibility** to **Public**.

3. **Add Function** → name `/voice` → paste [`twilio-functions/voice.js`](../twilio-functions/voice.js).
   Set **Visibility** to **Public**.

4. (Optional, for inbound PSTN) **Add Function** → name `/incoming` → paste [`twilio-functions/incoming.js`](../twilio-functions/incoming.js). **Public**.

5. **Environment Variables** (left sidebar of the service):

   | Key               | Value                                          |
   | ----------------- | ---------------------------------------------- |
   | `ACCOUNT_SID`     | `ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`           |
   | `API_KEY_SID`     | `SKxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`           |
   | `API_KEY_SECRET`  | (the secret shown once by the wizard)          |
   | `TWIML_APP_SID`   | `APxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`           |
   | `CALLER_ID`       | `+14155551234` (your Twilio number, E.164)     |
   | `CLIENT_IDENTITY` | (optional) the client name from the wizard     |

   Uncheck **Add my Twilio Credentials (ACCOUNT_SID) and (AUTH_TOKEN) to ENV** — not needed here.

6. **Deploy All**.

7. After deploy completes, copy the service base URL (looks like `https://twilio-dialpad-1234.twil.io`) and paste it into the wizard's Step 3.

8. (Optional inbound PSTN) In the Twilio Console, open your phone number → **Voice & Fax → A Call Comes In → Webhook** → paste `https://<service>.twil.io/incoming` → **HTTP POST** → **Save**.

## Verifying

The wizard's Step 4 will call your own number through the service end-to-end. If you'd rather check by hand:

```bash
curl "https://<your-service>.twil.io/token?identity=test"
```

Expected: `{"token":"eyJ...","identity":"test"}`.

## Cost

Twilio Functions: 10k invocations/month free, then $0.0001 each. Voice minutes billed at your normal Twilio rate.
