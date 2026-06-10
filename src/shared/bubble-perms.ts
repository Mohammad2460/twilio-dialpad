/**
 * Runtime registration of the click-to-call bubble content script.
 *
 * The bubble is NOT a static manifest content_script (that would trigger a
 * broad "read all your data on all websites" install warning). Instead we
 * request broad host access from `optional_host_permissions` only when the user
 * enables the floating button, then register the static asset
 * (`content/bubble.js`) via chrome.scripting so it auto-injects on future loads.
 */

export const BUBBLE_ORIGINS = ['http://*/*', 'https://*/*'];
const SCRIPT_ID = 'twdialer-bubble';
const SCRIPT_FILE = 'content/bubble.js';

async function isRegistered(): Promise<boolean> {
  try {
    const list = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
    return list.length > 0;
  } catch {
    return false;
  }
}

/** Idempotently register the persistent content script on granted origins. */
export async function registerBubbleScript(): Promise<void> {
  if (await isRegistered()) return;
  await chrome.scripting.registerContentScripts([
    {
      id: SCRIPT_ID,
      js: [SCRIPT_FILE],
      matches: BUBBLE_ORIGINS,
      runAt: 'document_idle',
      persistAcrossSessions: true,
    },
  ]);
}

async function unregisterBubbleScript(): Promise<void> {
  try {
    await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
  } catch {
    /* not registered */
  }
}

/**
 * Enable the bubble: request broad host permission (user gesture required),
 * then register the script. Returns false if the user declined the permission.
 */
export async function enableBubble(): Promise<boolean> {
  const granted = await chrome.permissions.request({ origins: BUBBLE_ORIGINS });
  if (!granted) return false;
  await registerBubbleScript();
  return true;
}

/** Disable the bubble: unregister the script and drop the broad host permission. */
export async function disableBubble(): Promise<void> {
  await unregisterBubbleScript();
  try {
    await chrome.permissions.remove({ origins: BUBBLE_ORIGINS });
  } catch {
    /* ignore */
  }
}

/**
 * On service-worker startup: re-assert registration to match current state.
 * persistAcrossSessions usually survives restarts, but if the permission is
 * still held and the script somehow isn't registered, restore it; if the
 * permission was revoked out-of-band, tear down.
 */
export async function syncBubbleRegistration(enabled: boolean): Promise<void> {
  let hasPerm = false;
  try {
    hasPerm = await chrome.permissions.contains({ origins: BUBBLE_ORIGINS });
  } catch {
    hasPerm = false;
  }
  if (enabled && hasPerm) await registerBubbleScript();
  else await unregisterBubbleScript();
}
