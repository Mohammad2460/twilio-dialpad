# Privacy Policy — Twilio Dialpad

**Last updated: October 2026**

## What This Extension Does

Twilio Dialpad ("the extension") is a browser-based dialler that lets you make and receive phone calls from Chrome using your own Twilio account. On top of calling it offers live call transcription, an AI assistant that summarises your calls and answers questions about them, optional call recording, and a connector that lets Anthropic's Claude read your call history through the Model Context Protocol (MCP).

Voice calls run through **your own Twilio account**. Call audio travels between your browser and Twilio; it does not pass through our servers.

This policy describes two places where data lives: **your device** and **our backend** at `dialler-mcp.vercel.app`.

---

## Data We Collect

### A. Stored on your device

Kept in the extension's own storage in your browser (`chrome.storage.local` and IndexedDB).

| Data | Purpose | Leaves your device? |
|------|---------|---------------------|
| Twilio Account SID, caller ID numbers, client identity | Connect the dialler to your Twilio account | Account SID and caller ID are also held by our backend (section B) |
| Device login (a device id and secret) | Proves to our backend that requests come from your install | Sent to our backend with each request |
| Call history (up to 1,000 calls: number, direction, duration, status, time) | The Recents list | Synced to our backend (section B) |
| Transcripts (text only) | Showing and searching what was said | Synced to our backend (section B); sent to the AI provider when you use the assistant (section D) |
| AI call notes (summary, objections, promises, next step) | Call notes, the Today list, the pre-call brief | No — created by the assistant, stored only on this device |
| Auto-dialer lists and do-not-call numbers | The auto-dialer | No |
| Settings and preferences | Remember your choices | Call-routing choices (incoming on/off, forwarding number, recording on/off) are also held by our backend so calls route correctly |
| HubSpot API token (only on installs that configured HubSpot) | Look up the caller in your HubSpot account | Only to HubSpot's API |
| Deepgram API key (only on installs that entered their own key) | Transcription with your own Deepgram account | Only to Deepgram |

If you choose a folder for transcripts, the extension also writes transcript files to that folder on your computer.

Older installs (version 1.2 and earlier) also store the address of a Twilio Function deployed in their own Twilio account.

### B. Held by our backend

Your account is created when you finish setup. From then on our backend holds:

| Data | Why |
|------|-----|
| Twilio Account SID | Identifies your account, so reinstalling restores it |
| Name and email address (entered at setup; also received from the payment processor if you subscribe) | To identify you and contact you about your account |
| Whether you opted in to product news, and when | Marketing email is sent only to people who ticked that box. It is off by default |
| A Twilio API key created in your account during setup, with its secret **encrypted**; the TwiML App id; your caller ID; call-routing choices | To place and receive calls for you. You can delete this API key in the Twilio Console at any time, which cuts off our access |
| Registered devices (a hashed secret, an optional label, last-seen time) | Authentication |
| Call records (number, direction, duration, status, time) and transcripts (text) | So the Claude connector can list, search and summarise your calls |
| HubSpot contact snapshot attached to a call (Pro, and only if HubSpot is configured) | So the connector can show who a call was with |
| Call recordings (audio), **only if you turn call recording on** | So you can play them back. Deleted automatically after 90 days, or when you delete them |
| Plan and subscription status, the payment processor's customer and subscription ids | To know which plan you are on |
| Usage counts: transcription seconds and AI questions per month, summaries per day | To apply your plan's monthly allowance |
| Billing ledger: for each AI or transcription request, the model used and what it cost us; any balance you hold | Accounting. It never contains call content |

**Your Twilio Auth Token is never stored.** It is sent to our backend once during setup over HTTPS, used to confirm the account is yours and to connect your number, and then discarded. It is not written to any database or log.

We never sell, share or rent your data.

### C. Anonymous usage analytics

To understand where new users get stuck, the extension sends **product-usage events** to our backend. These contain **no call content, no phone numbers and no credentials**.

| Data | Why |
|------|-----|
| A random install identifier (UUID) | Counts unique installs and measures the setup funnel. Generated on your device, not derived from any personal detail |
| Milestone events (for example "opened side panel", "started the demo", "setup started", "first call completed") | Tells us which step loses people |
| A coarse reason when automatic setup fails | Helps us fix setup failures |

We collect only the event name, a timestamp and small non-identifying attributes (for example whether a call had a transcript). Before you have an account these events are tied only to the random install id. Once you have an account, new events are associated with your account id, so they become linkable to you. They are never linked to call content or phone numbers.

Raw events are deleted after **90 days**. This is first-party only: no third-party analytics SDK, no advertising, no cross-site tracking, no cookies.

### D. Sent to other companies

**Twilio — always.** Standard Twilio Voice behaviour for calls placed with your account. See [Twilio's Privacy Policy](https://www.twilio.com/en-us/legal/privacy).

**Deepgram — only when call transcription is on.** While a call is being transcribed, its audio is streamed from your browser directly to Deepgram, which returns the text to your browser. The audio does not pass through our servers and we do not keep it. Our backend only issues a short-lived access token and counts the seconds used.

**OpenAI — only when you use the AI assistant.**

| When | What is sent |
|------|--------------|
| Automatic call summaries: after a transcribed call ends, and when the side panel opens for recent transcribed calls (last 14 days) that have no notes yet. Starts only after you choose **Turn on** in the one-time notice; switch it off any time in **Settings** | That call's transcript text, the call date, direction and the contact name if known |
| When you press **Summarize** on a call | The same, for that call |
| When you ask the assistant a question | Your question plus text from your recent calls (transcripts, AI notes, and call details such as number, contact name, date and duration) |

- These requests go to our backend, which passes them to OpenAI to produce the result. Our backend does **not** store the transcript text or your question for this feature.
- The resulting notes are stored **only on your device**.
- The Today list, the promises list and the pre-call brief are computed on your device; opening them sends nothing.
- OpenAI processes the text under its API terms; see [OpenAI's API data usage policy](https://openai.com/policies/api-data-usage-policies).
- Calls without a transcript are never sent for summarising. Nothing is sent automatically until you have answered the one-time notice.

**Anthropic (Claude) — only if you connect the Claude connector.** When you add your connector URL in claude.ai, Claude can read the call records and transcripts held by our backend (section B). On the Free plan it can read your most recent calls only. **Anyone who has your connector URL can read that data — keep it private.**

**HubSpot — only if HubSpot is configured.** The caller's phone number is sent to HubSpot's API, using your own token, to find the matching contact.

**Dodo Payments — only at checkout.** Payment details, billing address and email are collected by [Dodo Payments](https://dodopayments.com). We never see or store your card details. See [Dodo's Privacy Policy](https://dodopayments.com/privacy-policy).

### E. The demo

The demo shown before setup uses invented sample data. It creates no account and sends nothing except the anonymous "demo" events described in section C.

---

## Plans & Billing

- **Free:** unlimited calling with your own Twilio account, plus a monthly allowance of transcription and AI questions. No card required.
- **Pro:** **$19.00 USD per month**, or **$180.00 USD per year**. Subscribers who joined at an earlier price keep that price for as long as they stay subscribed.
- **7-day Pro trial** when you finish setup. No card required. When it ends you move to Free; nothing is charged.
- Payments are processed by **Dodo Payments**.

Twilio bills you separately and directly for your phone number and call minutes.

### Auto-renewal

A Pro subscription renews automatically each month or each year, depending on what you chose, until you cancel. You are only ever charged if you completed a checkout.

### Cancellation

Cancel any time in the extension: **Plan → Cancel subscription**. Pro stays on until the end of the period you already paid for; after that you are on Free and can keep calling.

### Refunds

- **During the 7-day trial:** nothing is charged.
- **After a paid charge:** no refunds. You keep Pro until the end of the period you paid for.

This is a hard policy chosen for operational simplicity. If you believe there is an exceptional circumstance, contact us through the support channel below — we will respond, but cannot guarantee a refund.

---

## Data Retention

- **On your device:** kept until you delete it, uninstall the extension or clear the extension's data.
- **Call records and transcripts on our backend:** kept while your account exists, until you ask us to delete them.
- **Call recordings:** deleted automatically after 90 days, or earlier if you delete them.
- **Usage analytics events:** deleted after 90 days.
- **Usage counts and the billing ledger:** kept for accounting.
- After an account is deleted, the account email and Twilio Account SID may be retained for fraud and abuse prevention.

---

## Account Deletion

Open an issue at the support address below asking for deletion. **Do not post your Twilio Account SID or any credential in a public issue** — we will reply with a private way to confirm the account is yours. We will then:

1. Cancel any active subscription.
2. Delete your call records, transcripts, recordings and account from our backend within 7 days.
3. Confirm by reply.

You can also cut off our access to your Twilio account yourself at any time by deleting the API key created during setup, in the Twilio Console.

A self-serve deletion button in the extension is on our roadmap.

---

## What We Do Not Do

- We do not store your Twilio Auth Token.
- We do not record or keep call audio unless you turn call recording on.
- We do not receive call audio for transcription; it goes from your browser to Deepgram.
- We do not capture screen content, keystrokes or browsing history.
- We do not use cookies or tracking pixels.
- We do not run third-party analytics SDKs.
- We do not include phone numbers, call content or credentials in usage analytics.
- We do not send marketing email unless you opted in.
- We do not sell or share data with advertisers.

---

## Permissions Explained

| Permission | Why needed |
|-----------|-----------|
| `storage` | Save settings, call history and transcripts on your device |
| `sidePanel` | Show the dialpad in Chrome's side panel |
| `notifications` | Desktop notifications for incoming calls |
| `clipboardRead` | Offer to dial a phone number you just copied |
| `tabs` | Open checkout, setup and HubSpot contact pages in new tabs |
| `scripting` | Add the optional click-to-call button to pages, only on sites you allow |
| Site access (optional, asked for when you turn on click-to-call) | Lets the click-to-call button appear on the sites you choose. Page content is not sent anywhere |
| `api.twilio.com`, `*.twilio.com`, `*.twil.io` | Twilio voice and account setup |
| `api.hubapi.com`, `app.hubspot.com` | HubSpot contact lookup, only if HubSpot is configured |
| `api.deepgram.com` | Live transcription |
| `dialler-mcp.vercel.app` | Our backend: account, plan, call sync, AI assistant requests |

---

## Children's Privacy

This extension is not directed at children under 13 and we do not knowingly collect data from children.

---

## Changes to This Policy

If material changes are made, the "Last updated" date above will change.

---

## Contact

- Support: open an issue at **https://github.com/Mohammad2460/twilio-dialpad/issues**
- Subscription and billing questions: same channel

We respond within 5 business days.
