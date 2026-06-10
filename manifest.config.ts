import { defineManifest } from '@crxjs/vite-plugin';
import pkg from './package.json';

export default defineManifest({
  manifest_version: 3,
  name: 'Twilio Dialpad',
  version: pkg.version,
  description: 'Browser-based Twilio dialpad — make and receive calls without a phone.',
  minimum_chrome_version: '116',
  permissions: ['storage', 'sidePanel', 'notifications', 'clipboardRead', 'tabs', 'identity', 'identity.email', 'scripting'],
  // Broad page access is OPTIONAL — requested at runtime only when the user
  // enables the floating bubble, then the content script is registered via
  // chrome.scripting.registerContentScripts. No broad install-time warning.
  optional_host_permissions: ['http://*/*', 'https://*/*'],
  host_permissions: [
    'https://api.twilio.com/*',
    'https://*.twil.io/*',
    'wss://*.twilio.com/*',
    'https://eventgw.twilio.com/*',
    'https://serverless.twilio.com/*',
    'https://serverless-upload.twilio.com/*',
    'https://api.hubapi.com/*',
    'https://app.hubspot.com/*',
    'https://api.deepgram.com/*',
    'wss://api.deepgram.com/*',
    'https://dialler-mcp.vercel.app/*',
  ],
  background: {
    service_worker: 'src/background/service-worker.ts',
    type: 'module',
  },
  // No static content_scripts: the click-to-call bubble (public/content/bubble.js)
  // is registered programmatically only on user-granted origins (see
  // src/shared/bubble-perms.ts), avoiding a broad-host install warning.
  action: {
    default_title: 'Twilio Dialpad',
    default_icon: {
      '16': 'public/icons/icon-16.png',
      '32': 'public/icons/icon-32.png',
      '48': 'public/icons/icon-48.png',
      '128': 'public/icons/icon-128.png',
    },
  },
  side_panel: {
    default_path: 'src/sidepanel/index.html',
  },
  options_page: 'src/options/index.html',
  icons: {
    '16': 'public/icons/icon-16.png',
    '32': 'public/icons/icon-32.png',
    '48': 'public/icons/icon-48.png',
    '128': 'public/icons/icon-128.png',
  },
  web_accessible_resources: [
    {
      resources: ['public/icons/*'],
      matches: ['<all_urls>'],
    },
  ],
});
