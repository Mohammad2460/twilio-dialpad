# Twilio Functions (server side)

These three files run on Twilio Serverless. The extension never holds your Twilio Auth Token or API Key Secret — that all lives here.

## Files

| File           | Path             | Purpose                                                       |
| -------------- | ---------------- | ------------------------------------------------------------- |
| `token.js`     | `/token`         | Mints a short-lived Voice Access Token (JWT) for the SDK.     |
| `voice.js`     | `/voice`         | TwiML for outbound calls (`Device.connect`). Used by TwiML App. |
| `incoming.js`  | `/incoming`      | Optional: route PSTN inbound calls to your extension client.  |

## Required environment variables

Set under **Functions & Assets → Settings → Environment Variables**:

| Var               | Where to find it                                                                       |
| ----------------- | -------------------------------------------------------------------------------------- |
| `ACCOUNT_SID`     | Twilio Console home — starts with `AC...`                                              |
| `API_KEY_SID`     | The `SK...` SID created by the extension's setup wizard (Step 2).                      |
| `API_KEY_SECRET`  | Shown **once** by the wizard — paste here.                                             |
| `TWIML_APP_SID`   | The `AP...` SID created by the wizard (Step 2).                                        |
| `CALLER_ID`       | The E.164 Twilio number to show on outbound calls (e.g. `+14155551234`).               |
| `CLIENT_IDENTITY` | (Optional, for `incoming.js`) The extension client name — must match the wizard input. |

## Deploying

See `../docs/DEPLOY_FUNCTION.md` for a click-by-click guide.

## Smoke test

```bash
curl "https://<your-service>.twil.io/token?identity=test"
# → {"token":"eyJhbGciOi...","identity":"test"}
```

If you get `401`/`403`, your `API_KEY_SECRET` is wrong.
