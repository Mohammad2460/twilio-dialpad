import { MsgSchema } from '@shared/messaging';
import {
  getInstallId,
  track,
  flushTelemetry,
  ingestEvent,
  isTelemetryMessage,
} from '@shared/telemetry';

// DeviceManager + CallRecord persistence + transcript file write all live in the side panel
// (need DOM context for File System Access API). Service worker only handles:
//   - sidePanel behavior on install
//   - desktop notifications for incoming calls
//   - telemetry: own the event queue (single writer), record install, drain on wake

const INSTALLED_TRACKED_KEY = 'installedTracked';

chrome.runtime.onInstalled.addListener(async (details) => {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch { /* noop */ }

  // Telemetry: record extension_installed EXACTLY ONCE per install — including a
  // one-time backfill for installs that predate telemetry (reason 'update'),
  // otherwise existing users would appear mid-funnel with no install event and
  // skew every conversion rate.
  await getInstallId();
  const { [INSTALLED_TRACKED_KEY]: alreadyTracked } =
    await chrome.storage.local.get(INSTALLED_TRACKED_KEY);

  if (!alreadyTracked) {
    // reason !== 'install' here means an existing pre-telemetry install upgrading
    // into this build → a backfilled install event.
    track('extension_installed', { backfill: details.reason !== 'install' });
    await chrome.storage.local.set({ [INSTALLED_TRACKED_KEY]: true });
  }

  if (details.reason === 'install') chrome.runtime.openOptionsPage();
});

// Drain any events queued before the worker was last suspended.
flushTelemetry().catch(() => {});

chrome.runtime.onMessage.addListener((raw, _sender, _sendResponse) => {
  // Click-to-call bubble → open the side panel pre-filled with the number.
  if (raw && typeof raw === 'object' && (raw as { kind?: unknown }).kind === 'bubble-dial') {
    const number = String((raw as { number?: unknown }).number ?? '');
    if (number) chrome.storage.local.set({ pendingDial: number }).catch(() => {});
    const windowId = _sender.tab?.windowId;
    if (windowId !== undefined) chrome.sidePanel.open({ windowId }).catch(() => {});
    return false;
  }

  // Telemetry events from pages — the SW is the single queue writer.
  if (isTelemetryMessage(raw)) {
    void ingestEvent(raw.event);
    return false;
  }

  const parsed = MsgSchema.safeParse(raw);
  if (!parsed.success) return false;
  const msg = parsed.data;

  // Show notification for incoming calls.
  if (msg.type === 'call.incoming') {
    chrome.notifications.create(`call-${msg.callSid}`, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('public/icons/icon-128.png'),
      title: 'Incoming call',
      message: `From ${msg.from}`,
      priority: 2,
    });
    return false;
  }

  return false;
});

chrome.notifications.onClicked?.addListener(async (notifId) => {
  if (!notifId.startsWith('call-')) return;
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.windowId !== undefined) await chrome.sidePanel.open({ windowId: tab.windowId });
  } catch { /* noop */ }
});
