# Troubleshooting

## "Token endpoint returned 401" during Step 3

Your Twilio Function env vars are wrong. Open the Function service → **Environment Variables** and verify all five values exactly match Step 2 of the wizard. `API_KEY_SECRET` is shown only once — if you lost it, click **Reconfigure** in the extension's options page and re-provision.

## Status pill stuck on "Connecting…"

- Open `chrome://extensions` → click **Service Worker** under the extension to view background console.
- Open `chrome://extensions` → click **Inspect views: offscreen.html** to view offscreen console.
- Look for `Twilio Device error` lines.

Common causes:

| Symptom                              | Fix                                                                 |
| ------------------------------------ | ------------------------------------------------------------------- |
| `AccessTokenInvalid`                 | Function env var mismatch — see above.                              |
| `signaling connection error`         | Corporate firewall blocking `wss://*.twilio.com`. Try off-VPN.       |
| `Microphone permission denied`       | See `MICROPHONE_PERMISSION.md`.                                     |

## Call connects but no audio

1. Verify mic permission (above).
2. Open `chrome://settings/content/sound` — extension must not be muted.
3. Check the offscreen console for `Failed to acquire audio context`.

## Outbound call rings but says "Application error"

The TwiML App's Voice URL is not pointing at `/voice`. Re-run the wizard's Step 3 — it PATCHes the TwiML App.

## Inbound calls don't ring

You did not deploy the optional `/incoming` Function, or you did not point your Twilio number's voice webhook at it. See `DEPLOY_FUNCTION.md` step 8.
