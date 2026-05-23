import { MsgSchema } from '@shared/messaging';

// DeviceManager + CallRecord persistence + transcript file write all live in the side panel
// (need DOM context for File System Access API). Service worker only handles:
//   - sidePanel behavior on install
//   - desktop notifications for incoming calls

chrome.runtime.onInstalled.addListener(async (details) => {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch { /* noop */ }
  if (details.reason === 'install') chrome.runtime.openOptionsPage();
});

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
