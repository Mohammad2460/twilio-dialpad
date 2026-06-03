# Privacy Policy — Twilio Dialpad

**Last updated: June 2026**

## What This Extension Does

Twilio Dialpad ("the extension") is a browser-based dialler that lets you make and receive phone calls from Chrome using your own Twilio account. It also offers an optional cloud sync feature so that an AI assistant (Anthropic's Claude) can read your call history and transcripts through the Model Context Protocol (MCP).

All voice calls are routed through your personal Twilio account — not through any service operated by us. Cloud sync is a separate, paid feature described below.

---

## Data We Collect

### A. Stored locally on your device (`chrome.storage.local`)

Always collected; never leaves your browser unless cloud sync is enabled.

| Data | Purpose | Sent to third parties? |
|------|---------|-----------------------|
| Twilio Function URL | Connects to your deployed token endpoint | Only to your own Twilio Function |
| Twilio Account SID | Identifies your Twilio account (read-only) | See "Cloud sync" below |
| Twilio API Key SID | Reference only (secret never stored) | No |
| Twilio TwiML App SID | Routes outbound calls | No |
| Client identity | Your Twilio Client name | To your Twilio Function |
| Caller ID numbers | Your Twilio phone numbers | No |
| HubSpot API token (optional) | Reverse contact lookup on incoming calls | Only to HubSpot's API (your account) |
| Deepgram API key (optional) | Live call transcription | Only to Deepgram (your account) |
| Call history | Last 20 call records (number, duration, direction) | See "Cloud sync" below |
| Transcripts | Per-call transcript JSON (text only, no audio) | See "Cloud sync" below |

### B. Sent to our cloud backend at `dialler-mcp.vercel.app` (only if subscribed)

When the subscription (trial or paid) is active, the extension sends the following to our backend so that Claude can answer questions about your calls:

| Data | Why |
|------|-----|
| Twilio Account SID | Used as an anonymous account identifier (so reinstalling the extension restores the same account) |
| Call metadata (number, duration, direction, status, timestamp) | So the AI tools can list and filter your calls |
| Call transcripts (text only) | So Claude can summarise, search, and analyse your conversations |
| Contact snapshot from HubSpot (if HubSpot is configured) | So Claude can identify who you called |
| Email + name | Captured from Dodo Payments only when you complete a checkout; used to identify you for customer support |

We **do not** record audio, store voicemail, capture screen content, or fingerprint your browser. We never sell, share, or rent your data.

### B2. Anonymous usage analytics (always, to `dialler-mcp.vercel.app`)

To understand where new users get stuck during setup, the extension sends **product-usage events** to our backend. These contain **no message content, no phone numbers, and no credentials**.

| Data | Why |
|------|-----|
| A random install identifier (UUID) | Counts unique installs and measures the setup funnel. Pseudonymous — generated on your device, not derived from any personal detail. |
| Setup milestone events (e.g. "opened side panel", "setup wizard started", "first call completed") | Tells us which setup step loses users so we can fix it |
| Coarse error reason for failed auto-setup (e.g. which step failed) | Helps us debug setup failures |

We collect **only** the event name, a timestamp, and small non-identifying attributes (e.g. whether a call had a transcript — true/false). The events never contain message content, phone numbers, or credentials.

**Linkage:** before you create a cloud account, these events are pseudonymous (tied only to the random install id). Once you have a cloud account, new events are associated with your account id — so we can understand the journey from install to paid — meaning they become linkable to you. They remain unlinked to call content or phone numbers.

Raw events are deleted after **90 days**. This is first-party only — no third-party analytics SDK, no advertising, no cross-site tracking, no cookies.

### C. Sent to Twilio (always, regardless of subscription)

Standard Twilio Voice SDK behaviour. See [Twilio's Privacy Policy](https://www.twilio.com/en-us/legal/privacy).

### D. Sent to Dodo Payments (only at checkout)

Payment, billing address, and email information is collected by [Dodo Payments](https://dodopayments.com) during checkout. We never see or store your card details. See [Dodo's Privacy Policy](https://dodopayments.com/privacy-policy).

---

## Subscriptions & Billing

### Pricing

- **7-day free trial** on installation. No card required.
- **$9.00 USD / month** after the trial.
- Subscription is processed by **Dodo Payments** (third-party processor).

### Auto-renewal

After the 7-day trial ends, the extension will charge $9.00 USD per month automatically — but only if you have completed a Dodo checkout. If you never enter a payment method, you simply lose cloud-sync + Claude MCP access; nothing is charged.

### Cancellation

You can cancel at any time from the extension's **Settings → Pro plan → Cancel subscription** button. Cloud features remain active until the end of your current billing period; after that, only local calling continues.

### Refunds

- **During the 7-day free trial:** cancel any time, no charge.
- **After the first paid charge:** no refunds. You retain access until the end of the period you already paid for.

This is a hard policy chosen for operational simplicity. If you believe there is an exceptional circumstance, contact us via the support channel below — we will respond, but cannot guarantee a refund.

---

## Data Retention

- **Local data** (`chrome.storage.local`, IndexedDB): persists until you uninstall the extension or clear extension data.
- **Cloud data** (our backend): retained while your account is active. **30 days** after subscription cancellation/expiry, all call records and transcripts are deleted. Account email + Twilio Account SID may be retained for fraud/abuse prevention.

---

## Account Deletion

Email the support address (below) with your Twilio Account SID. We will:
1. Cancel any active Dodo subscription.
2. Delete all calls + transcripts + account row from our backend within 7 days.
3. Confirm deletion by reply.

A self-serve in-extension deletion button is on our roadmap.

---

## Data We Do NOT Collect

- We do not collect or transmit your Twilio Auth Token (discarded after provisioning)
- We do not record audio
- We do not capture screen content, keystrokes, or browsing history
- We do not use cookies or tracking pixels
- We do not run third-party analytics SDKs (our usage analytics are first-party and anonymous — see Section B2)
- We do not include phone numbers, call content, or credentials in any usage analytics
- We do not sell or share data with advertisers

---

## Permissions Explained

| Permission | Why needed |
|-----------|-----------|
| `storage` | Save settings + call history locally |
| `sidePanel` | Display the dialpad in Chrome's side panel |
| `notifications` | Show desktop notifications for incoming calls |
| `clipboardRead` | Let you paste phone numbers into the dialpad |
| `tabs` | Open HubSpot contact pages + checkout/options in new tabs |
| `*.twilio.com` / `*.twil.io` | Connect to Twilio's voice + token infrastructure |
| `api.hubapi.com` | Optional HubSpot contact reverse-lookup (only if you configure HubSpot) |
| `api.deepgram.com` | Optional live transcription (only if you configure a Deepgram key) |
| `dialler-mcp.vercel.app` | Cloud sync + Claude MCP relay (only while subscribed) |

---

## Children's Privacy

This extension is not directed at children under 13 and we do not knowingly collect data from children.

---

## Changes to This Policy

If material changes are made, the extension version will be updated and the "Last updated" date above will change.

---

## Contact

- Support: open an issue at **https://github.com/Mohammad2460/twilio-dialpad/issues**
- Subscription / billing questions: same channel

We respond within 5 business days.
