import { MsgSchema } from '@shared/messaging';
import { getInstallId, track, flushTelemetry } from '@shared/telemetry';

// DeviceManager + CallRecord persistence + transcript file write all live in the side panel
// (need DOM context for File System Access API). Service worker only handles:
//   - sidePanel behavior on install
//   - desktop notifications for incoming calls
//   - telemetry: mint install id on install, drain queue on wake

chrome.runtime.onInstalled.addListener(async (details) => {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch { /* noop */ }

  // Telemetry: ensure an anonymous install id exists, then record the install
  // exactly once (fresh installs only — not updates/reloads).
  await getInstallId();
  if (details.reason === 'install') {
    track('extension_installed');
    chrome.runtime.openOptionsPage();
  }
});

// Drain any events queued before the worker was last suspended.
flushTelemetry().catch(() => {});

chrome.runtime.onMessage.addListener((raw, _sender, _sendResponse) => {
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
