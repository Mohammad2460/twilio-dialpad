/**
 * Click-to-call floating bubble (content script).
 *
 * Shipped as a STATIC plain-JS asset (not bundled) so it has a stable path
 * (`content/bubble.js`) that `chrome.scripting.registerContentScripts` can
 * reference. It is NOT declared in the manifest's `content_scripts`, so it only
 * runs on origins the user explicitly granted (optional_host_permissions) and
 * after they enable the floating button — no broad install-time permission.
 *
 * Clicking grabs the current text selection, normalizes it to E.164, and asks
 * the background worker to open the side panel pre-filled with that number.
 */
(function () {
  var BTN_ID = '__twdialer_bubble__';

  // Tiny dependency-free loose-E.164 cleanup. Full validation happens in the
  // dialpad before the call is placed.
  function looseE164(raw) {
    var trimmed = raw.replace(/[\s()\-.]/g, '');
    if (!/^\+?\d{7,15}$/.test(trimmed)) return '';
    return trimmed.charAt(0) === '+' ? trimmed : '+' + trimmed;
  }

  function removeBubble() {
    var el = document.getElementById(BTN_ID);
    if (el) el.remove();
  }

  function injectBubble() {
    if (document.getElementById(BTN_ID)) return;
    var btn = document.createElement('button');
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
    });

    btn.addEventListener('click', function () {
      var sel = ((window.getSelection && window.getSelection().toString()) || '').trim();
      var number = sel ? looseE164(sel) : '';
      chrome.runtime.sendMessage({ kind: 'bubble-dial', number: number });
      if (sel && !number) {
        btn.textContent = '⚠';
        setTimeout(function () { btn.textContent = '📞'; }, 1200);
      }
    });

    document.body.appendChild(btn);
  }

  function sync() {
    try {
      chrome.storage.local.get('settings', function (res) {
        var settings = res && res.settings;
        if (settings && settings.floatingIconEnabled) injectBubble();
        else removeBubble();
      });
    } catch (e) {
      removeBubble();
    }
  }

  // React live to the toggle within an already-injected page.
  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area === 'local' && changes.settings) sync();
  });

  sync();
})();
