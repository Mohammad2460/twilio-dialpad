/**
 * GET /privacy — public privacy policy for the Chrome Web Store listing.
 *
 * Plain HTML from a route handler (no React tree, no client JS) so it renders
 * fast and is trivially crawlable. Canonical copy — docs/PRIVACY_POLICY.md
 * points here. Keep it accurate to what the code actually does; the Chrome Web
 * Store reviews it against the extension's behaviour.
 */
const UPDATED = 'September 29, 2026';
const SUPPORT_EMAIL = 'peaceinmind2460@gmail.com';

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Privacy Policy — Twilio Dialpad</title>
<meta name="description" content="How the Twilio Dialpad Chrome extension collects, uses and protects your data.">
<style>
  :root { --fg:#1a1a1a; --muted:#5b5b5b; --line:#e5e5e5; --bg:#ffffff; --accent:#2553d8; --soft:#f6f7f9; }
  @media (prefers-color-scheme: dark) { :root { --fg:#ececec; --muted:#a3a3a3; --line:#2e2e2e; --bg:#121212; --accent:#7ea2ff; --soft:#1b1b1b; } }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; }
  main { max-width: 760px; margin: 0 auto; padding: 48px 16px 80px; }
  h1 { font-size: 2rem; line-height:1.2; margin: 0 0 4px; }
  h2 { font-size: 1.25rem; margin: 40px 0 8px; padding-top: 16px; border-top: 1px solid var(--line); }
  h3 { font-size: 1.05rem; margin: 24px 0 6px; }
  p, li { color: var(--fg); }
  .muted { color: var(--muted); }
  a { color: var(--accent); }
  .table { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0 16px; font-size: .95rem; }
  th, td { text-align: left; vertical-align: top; padding: 8px 10px; border-bottom: 1px solid var(--line); }
  th { background: var(--soft); font-weight: 600; }
  .note { background: var(--soft); border-left: 3px solid var(--accent); padding: 12px 14px; border-radius: 4px; }
  code { font-size: .9em; background: var(--soft); padding: 1px 5px; border-radius: 4px; }
</style>
</head>
<body>
<main>
<h1>Privacy Policy — Twilio Dialpad</h1>
<p class="muted">Last updated: ${UPDATED}</p>

<p>Twilio Dialpad ("the extension", "we") is a Chrome extension that lets you make and receive phone calls in your browser using <strong>your own Twilio account</strong>, with optional call transcription, recording and AI call analysis. This policy explains what data the extension handles, where it goes, and your choices.</p>

<div class="note"><strong>In short:</strong> calls run on your own Twilio account. We never store your Twilio Auth Token, never record audio unless you turn recording on, never sell your data, and use no advertising or third-party tracking.</div>

<h2>1. Data stored only on your device</h2>
<p>Kept in the extension's local storage (<code>chrome.storage.local</code>) until you uninstall the extension or clear its data:</p>
<div class="table"><table>
<tr><th>Data</th><th>Purpose</th></tr>
<tr><td>Twilio Account SID, caller ID number(s), client identity</td><td>Identify your Twilio account and the number you call from</td></tr>
<tr><td>Device credential (random ID + secret)</td><td>Authenticates this browser to our backend</td></tr>
<tr><td>Recent call history and transcripts</td><td>Show your call list and transcripts in the side panel</td></tr>
<tr><td>Your preferences (e.g. click-to-call, auto-dialer lists)</td><td>Remember your settings</td></tr>
<tr><td>HubSpot token (optional, only if you connect HubSpot)</td><td>Look up the contact for a phone number in your own HubSpot account</td></tr>
</table></div>

<h2>2. Data we store on our servers</h2>
<p>Our backend runs at <code>dialler-mcp.vercel.app</code> (Vercel) with a database and file storage at Supabase (United States).</p>
<div class="table"><table>
<tr><th>Data</th><th>Why</th></tr>
<tr><td>Email address and name (required at setup); marketing consent (optional, off by default)</td><td>Your account, support and important service messages. Marketing emails only if you opt in.</td></tr>
<tr><td>Twilio Account SID</td><td>Links your account to your Twilio account (so reinstalling restores it)</td></tr>
<tr><td>Twilio API Key secret — <strong>encrypted</strong> (AES-256-GCM)</td><td>At setup we create an API Key and a TwiML App inside your Twilio account. The key is used only to issue short-lived calling tokens and to fetch your call recordings.</td></tr>
<tr><td>Call details: phone number, direction, duration, status, time, Twilio Call SID, and the HubSpot contact name if you use HubSpot</td><td>Call history across devices, and for AI features you choose to use</td></tr>
<tr><td>Call transcripts (text), only if transcription is on</td><td>Show, search and analyse your calls</td></tr>
<tr><td>Call recordings (audio), <strong>only if you turn recording on</strong></td><td>Play back your calls. Deleted automatically after 90 days, or earlier when you delete them.</td></tr>
<tr><td>Call settings (incoming calls on/off, call-forwarding number, recording on/off)</td><td>Route your calls the way you configured</td></tr>
<tr><td>Subscription status and credit balance</td><td>Know which features your plan includes</td></tr>
</table></div>
<p><strong>Your Twilio Auth Token is never stored.</strong> It is used once, in memory, to verify you own the Twilio account and to set up calling, then discarded.</p>

<h2>3. Services that process your data</h2>
<div class="table"><table>
<tr><th>Service</th><th>What it receives</th><th>When</th></tr>
<tr><td>Twilio</td><td>Call audio and call details (standard phone service)</td><td>Every call — on your own Twilio account. <a href="https://www.twilio.com/en-us/legal/privacy">Twilio privacy</a></td></tr>
<tr><td>Deepgram</td><td>Live call audio, streamed directly from your browser, converted to text</td><td>Only when transcription is on</td></tr>
<tr><td>OpenAI / Anthropic</td><td>Your question plus the relevant transcript text</td><td>Only when you use the in-extension AI features</td></tr>
<tr><td>Anthropic (Claude)</td><td>Your call details and transcripts, retrieved by Claude under your own Claude account</td><td>Only if you add your personal connector URL to Claude. Treat that URL like a password.</td></tr>
<tr><td>Dodo Payments</td><td>Payment and billing details (we never see your card)</td><td>Only at checkout. <a href="https://dodopayments.com/privacy-policy">Dodo privacy</a></td></tr>
<tr><td>Vercel, Supabase</td><td>Hosting and storage of the data in section 2</td><td>Ongoing</td></tr>
</table></div>
<p>We do not sell, rent or share your data with advertisers or data brokers, and we do not use it for anything unrelated to providing the extension.</p>

<h2>4. Product analytics</h2>
<p>To see where people get stuck during setup, the extension sends first-party usage events (for example "setup started" or "first call completed") with a random install ID. They contain <strong>no phone numbers, call content or credentials</strong>. Once you have an account, new events are linked to it. Raw events are deleted after <strong>90 days</strong>. No third-party analytics SDKs, cookies, advertising or cross-site tracking.</p>

<h2>5. What we do not collect</h2>
<ul>
<li>Your Twilio Auth Token (used once, never stored)</li>
<li>Audio recordings, unless you turn recording on</li>
<li>Browsing history, page content, keystrokes or screen content</li>
<li>Clipboard contents — the extension only checks whether your clipboard holds a phone number to offer "Call this number?"; nothing is stored or sent</li>
</ul>

<h2>6. Chrome permissions</h2>
<div class="table"><table>
<tr><th>Permission</th><th>Why</th></tr>
<tr><td><code>sidePanel</code></td><td>The dialer lives in Chrome's side panel</td></tr>
<tr><td><code>notifications</code></td><td>Alert you to incoming calls</td></tr>
<tr><td><code>tabs</code></td><td>Open the dialer from a notification and open help, setup and upgrade pages. We do not read your tabs.</td></tr>
<tr><td><code>clipboardRead</code></td><td>Offer to call a phone number you copied</td></tr>
<tr><td><code>scripting</code> + optional site access</td><td>Add the optional click-to-call button only on sites where you turn it on</td></tr>
<tr><td><code>storage</code></td><td>Save your settings and call history locally</td></tr>
<tr><td>Access to Twilio, Deepgram, HubSpot and our backend</td><td>Calling, transcription, optional HubSpot lookup, and account features</td></tr>
</table></div>

<h2>7. Subscriptions and billing</h2>
<ul>
<li>7-day free trial on setup, no card required. Calling itself stays free.</li>
<li>Pro is billed monthly through Dodo Payments at the price shown at checkout.</li>
<li>Cancel anytime in the extension. Features stay active until the end of the period you paid for.</li>
<li>Refunds: cancel during the trial and you are never charged. After the first paid charge, payments are non-refundable; contact us for exceptional cases.</li>
</ul>

<h2>8. Retention and deletion</h2>
<ul>
<li>Local data: until you uninstall the extension or clear its data.</li>
<li>Account data, call details and transcripts: kept while your account exists.</li>
<li>Recordings: deleted automatically after 90 days (or earlier by you).</li>
<li>Analytics events: deleted after 90 days.</li>
<li><strong>Delete your account:</strong> email <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a> from your account email. We cancel any subscription and delete your account, calls, transcripts and recordings within 7 days, and confirm by reply.</li>
</ul>

<h2>9. Security</h2>
<p>Traffic is encrypted in transit (HTTPS). Stored Twilio API Key secrets are encrypted at rest. Each browser gets its own revocable credential. Database access is restricted to our backend.</p>

<h2>10. Children</h2>
<p>The extension is not directed at children under 13, and we do not knowingly collect their data.</p>

<h2>11. Changes</h2>
<p>If we materially change this policy we will update the date above and, where appropriate, notify you in the extension.</p>

<h2>12. Contact</h2>
<p>Email <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a> or open an issue at <a href="https://github.com/Mohammad2460/twilio-dialpad/issues">github.com/Mohammad2460/twilio-dialpad/issues</a>.</p>
</main>
</body>
</html>`;

export function GET() {
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
