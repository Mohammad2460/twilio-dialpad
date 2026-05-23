// Offscreen document — intentionally a no-op stub.
// DeviceManager (Twilio.Device + WebRTC) runs in the side panel context directly.
// This file exists only because the offscreen.html is still referenced in the manifest,
// but the document is never created (SW no longer calls chrome.offscreen.createDocument).
