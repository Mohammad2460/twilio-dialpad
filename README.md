# Twilio Dialpad — Chrome Extension

A self-hosted, WebRTC-based softphone for Twilio. Runs as a Chrome (MV3) extension with a side-panel dialpad. Your Twilio secrets stay on your own Twilio account (in a Functions service) — the extension never holds your Auth Token long-term.

## V0 — what works

- Side-panel dialpad: dial PSTN numbers + call Twilio Clients
- Inbound call ringing + accept/reject
- Mute / DTMF send / hangup
- Call history (last 20)
- Setup wizard: auto-creates API Key + TwiML App in your Twilio account, then walks you through deploying the Twilio Function
- Auto-reconnect + token refresh

## Architecture

| Layer            | Role                                                                |
| ---------------- | ------------------------------------------------------------------- |
| Service worker   | Lifecycle, message router, lazily spawns offscreen doc              |
| Offscreen doc    | Hosts `Twilio.Device` + WebRTC (SWs can't hold media streams)       |
| Side panel       | React UI: dialpad, call screen, history                             |
| Options page     | 4-step provisioning wizard                                          |
| Twilio Functions | `/token` + `/voice` + `/incoming` — your secrets live here, not in the extension |

See `twilio-functions/README.md` and `docs/DEPLOY_FUNCTION.md` for the server-side bits.

## Development

```bash
pnpm install
pnpm dev          # Vite + CRXJS hot-reload; load dist/ unpacked in chrome://extensions
pnpm build        # production bundle → dist/
pnpm typecheck
pnpm test         # vitest unit tests
```

Load the extension:

1. `pnpm build`
2. Open `chrome://extensions`, enable **Developer mode**
3. Click **Load unpacked**, select the `dist/` directory
4. The setup wizard opens automatically — follow the 4 steps

## Roadmap

- V1: number-detection content script (click-to-call any web page), SMS send/receive, voicemail + voicemail drop, CRM screen-pop, auto-dialer, keyboard shortcuts, call transfer + conference
