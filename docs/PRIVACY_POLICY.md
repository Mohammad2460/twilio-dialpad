# Privacy Policy — Twilio Dialpad

**Last updated: May 2026**

## What This Extension Does

Twilio Dialpad is a browser extension that lets you make and receive phone calls directly from Chrome using your own Twilio account. All calls are routed through your personal Twilio account — not through any third-party service operated by us.

---

## Data We Collect

**We collect nothing.** This extension has no backend, no analytics, no crash reporting, and no telemetry. No data ever leaves your browser to servers we operate.

### Data stored locally on your device (`chrome.storage.local`)

| Data | Purpose | Leaves your device? |
|------|---------|-------------------|
| Twilio Function URL | Connects to your deployed token endpoint | Only to your own Twilio Function |
| Twilio Account SID | Identifies your Twilio account (read-only) | No |
| Twilio API Key SID | Reference only (secret never stored) | No |
| Twilio TwiML App SID | Routes outbound calls | No |
| Client identity | Your Twilio Client name | To your Twilio Function |
| Caller ID numbers | Your Twilio phone numbers for outbound calls | No |
| Call history | Last 20 call records (number, duration, direction) | No |

### Data sent to Twilio

When you make or receive a call, the extension communicates directly with:
- **Your deployed Twilio Function** — to mint a short-lived access token
- **Twilio Voice Edge servers** — for the WebRTC media stream
- **Twilio Event Gateway** — for signalling

This is standard Twilio Voice SDK behaviour. Refer to [Twilio's Privacy Policy](https://www.twilio.com/en-us/legal/privacy) for how Twilio handles call data.

---

## Data We Do NOT Collect

- We do not collect or transmit your Twilio Auth Token (discarded after provisioning)
- We do not record audio
- We do not store call content
- We do not use cookies or tracking pixels
- We do not sell or share any data

---

## Permissions Explained

| Permission | Why needed |
|-----------|-----------|
| `storage` | Save your settings and call history locally |
| `sidePanel` | Display the dialpad in Chrome's side panel |
| `notifications` | Show a desktop notification for incoming calls |
| Host permission `*.twilio.com` | Connect to Twilio's voice infrastructure for WebRTC calls |
| Host permission `*.twil.io` | Connect to your deployed Twilio Functions |

---

## Data Retention

All data is stored locally in `chrome.storage.local` and is deleted when you uninstall the extension. Call history is capped at 20 records and automatically rotates.

---

## Children's Privacy

This extension is not directed at children under 13 and we do not knowingly collect data from children.

---

## Changes to This Policy

If material changes are made, the extension version will be updated and the "Last updated" date above will change.

---

## Contact

Questions? Open an issue at: **[your GitHub repo URL here]**
