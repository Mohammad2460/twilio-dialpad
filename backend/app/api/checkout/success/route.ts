import { NextResponse } from 'next/server';

/**
 * GET /api/checkout/success
 * User lands here after Dodo redirects post-payment.
 * Webhook is the source of truth for status — this page just confirms + closes.
 */
export async function GET() {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Payment received — Twilio Dialer Pro</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
           background: #0a0a0a; color: #fafafa; display: grid; place-items: center;
           min-height: 100vh; margin: 0; padding: 24px; }
    .card { max-width: 420px; text-align: center; background: #18181b; border: 1px solid #27272a;
            border-radius: 12px; padding: 32px; }
    h1 { margin: 0 0 8px; font-size: 22px; }
    p { margin: 8px 0; color: #a1a1aa; line-height: 1.5; }
    .check { font-size: 48px; color: #22c55e; margin-bottom: 8px; }
    .small { font-size: 13px; color: #71717a; margin-top: 16px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="check">✓</div>
    <h1>Payment received</h1>
    <p>Your Twilio Dialer Pro subscription is active.</p>
    <p>You can close this tab and return to the extension.</p>
    <p class="small">This window auto-closes in <span id="t">5</span>s.</p>
  </div>
  <script>
    let n = 5;
    const el = document.getElementById('t');
    const i = setInterval(() => { n--; el.textContent = n; if (n <= 0) { clearInterval(i); window.close(); } }, 1000);
  </script>
</body>
</html>`;
  return new NextResponse(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
