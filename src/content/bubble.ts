/**
 * Click-to-call floating bubble (content script).
 *
 * Renders a small headset FAB ONLY when the user has enabled it
 * (`floatingIconEnabled` in chrome.storage). Clicking it grabs the current text
 * selection, normalizes it to E.164, and asks the background worker to open the
 * side panel pre-filled with that number. Reacts live to the setting toggle.
 *
 * No work happens on a page unless the user opted in, so the broad match is inert
 * by default.
 */
const BTN_ID = '__twdialer_bubble__';

/**
 * Tiny, dependency-free loose-E.164 cleanup — we deliberately avoid importing
 * the heavy phone library into a script that loads on every page. Full
 * validation happens in the dialpad before the call is placed.
 */
function looseE164(raw: string): string {
  const trimmed = raw.replace(/[\s()\-.]/g, '');
  const m = /^\+?\d{7,15}$/.exec(trimmed);
  if (!m) return '';
  return trimmed.startsWith('+') ? trimmed : `+${trimmed}`;
}

function removeBubble() {
  document.getElementById(BTN_ID)?.remove();
}

function injectBubble() {
  if (document.getElementById(BTN_ID)) return;
  const btn = document.createElement('button');
  btn.id = BTN_ID;
  btn.type = 'button';
  btn.title = 'Call selected number with Twilio Dialer';
  btn.textContent = '📞';
  Object.assign(btn.style, {
    position: 'fixed',
    right: '18px',
    bottom: '18px',
    zIndex: '2147483647',
    width: '44px',
    height: '44px',
    borderRadius: '9999px',
    border: 'none',
    background: '#2563eb',
    color: '#fff',
    fontSize: '18px',
    cursor: 'pointer',
    boxShadow: '0 2px 10px rgba(0,0,0,0.25)',
  } as CSSStyleDeclaration);

  btn.addEventListener('click', () => {
    const sel = (window.getSelection?.()?.toString() ?? '').trim();
    const number = sel ? looseE164(sel) : '';
    chrome.runtime.sendMessage({ kind: 'bubble-dial', number });
    if (sel && !number) {
      btn.textContent = '⚠';
      setTimeout(() => (btn.textContent = '📞'), 1200);
    }
  });

  document.body.appendChild(btn);
}

async function sync() {
  try {
    const { settings } = await chrome.storage.local.get('settings');
    const enabled = !!(settings && settings.floatingIconEnabled);
    if (enabled) injectBubble();
    else removeBubble();
  } catch {
    removeBubble();
  }
}

// React live to the toggle.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings) void sync();
});

void sync();
