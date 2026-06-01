# Chrome Web Store Listing Copy

## Extension Name
Twilio Dialpad

## Short Description (132 chars max)
Browser phone using your own Twilio account + AI call analysis via Claude. 7-day free trial, then $9/month.

## Detailed Description

**Your own Twilio-powered phone — with built-in AI call analysis.**

Make and receive phone calls inside Chrome using your own Twilio account, then ask Claude AI to summarise, search, and analyse them. No extra setup. No hardware. No monthly fees on top of Twilio's wholesale call rates.

---

**💳 PRICING**
• **7-day free trial** on install — no card required
• **$9 / month** after the trial — covers cloud sync + Claude MCP connector
• Billed by **Dodo Payments** (external payment processor)
• Cancel any time from Settings → Pro plan

After the trial, local calling continues to work even if you don't subscribe — only cloud sync + the Claude MCP connector are paused.

---

**✅ WORKS RIGHT IN YOUR BROWSER**
The dialpad lives in Chrome's side panel — always visible, even as you browse other tabs. No separate app, no hardware phone required.

**📞 MAKE & RECEIVE CALLS**
• Outbound calls to any number worldwide (your Twilio rates apply)
• Inbound calls to your Twilio number
• Switch caller ID between multiple Twilio numbers
• Incoming call notifications even when the panel is closed
• Optional call-forwarding to your personal phone

**🤖 CLAUDE AI INTEGRATION (PRO)**
• Personal MCP connector URL for Claude.ai — paste once, ask questions about your calls
• "List my calls today" · "Summarise my last call with Sarah" · "Find when I discussed pricing"
• Live transcription via your Deepgram key (optional)
• Contact enrichment via HubSpot (optional)

**📋 CALL HISTORY + TRANSCRIPTS**
• Last 20 calls locally, full history in the cloud
• Per-call transcripts (text only — no audio recording)
• Searchable from Claude via the MCP connector

**🔒 PRIVACY**
• Audio is never recorded
• No analytics SDKs, no advertising trackers
• Your Twilio Auth Token is used once during setup then discarded
• Cloud sync data is tied only to your Twilio Account SID and (after checkout) your email
• Full privacy policy: see store dashboard link

---

**SETUP (5 minutes)**

1. Install the extension
2. Open Settings → follow the setup wizard
3. Connect your Twilio Account SID
4. Deploy the included Twilio Function (copy-paste, takes 2 minutes)
5. Start calling

Full setup guide included inside the extension.

---

**REQUIREMENTS**
• A Twilio account (free trial works) — twilio.com
• A Twilio phone number (~$1/month)
• Deploy one small Twilio Function (free tier covers heavy usage)
• A subscription for cloud + Claude features (7-day free trial, then $9/month)

---

**REFUND POLICY**

Cancel any time during the 7-day free trial — no charge. After the first paid charge, no refunds; you retain access until the end of the period you paid for. See privacy policy for details.

---

**COMING SOON**
• SMS send/receive
• Voicemail drop
• Click-to-call from any web page (with explicit user gesture)

---

## Category
Productivity

## Language
English

## Screenshots needed (1280×800 each)
1. Side panel dialpad
2. Active call with timer + transcript
3. Setup wizard
4. Options page showing Pro trial card + connector URL
5. Claude.ai chat using the dialler MCP tools

Tip: Use Chrome DevTools device toolbar to set window to exactly 1280×800,
then take screenshot with Cmd+Shift+4 (or Cmd+Shift+5 for window capture).

## Promotional tile
440×280 px — dark background, extension icon centered, tagline below:
"Your Twilio number, in Chrome. Plus Claude AI."

## Permission justifications (for store dashboard)
- **storage** — save settings + last 20 calls locally
- **sidePanel** — show the dialpad in Chrome's side panel
- **notifications** — desktop alerts for incoming calls
- **clipboardRead** — let user paste phone numbers into the dialpad
- **tabs** — open HubSpot contact pages, checkout, and Settings tab
- **host: *.twilio.com / twil.io** — Twilio Voice SDK signalling + token endpoint
- **host: api.hubapi.com** — optional HubSpot contact lookup (user provides token)
- **host: api.deepgram.com** — optional speech-to-text (user provides key)
- **host: dialler-mcp.vercel.app** — cloud sync + Claude MCP relay (subscription required)

## Single-purpose statement
Browser softphone using the user's own Twilio account, with optional AI call analysis via Claude.
