# Design — UX Overhaul + Monetization Polish (Batch 1)

> Date: 2026-06-11 · Branch `claude/pensive-bardeen-363b43` (off main `c8b2b17`)
> Scope: side-panel UX overhaul + monetization surfaces. THIS EXTENSION IS THE REVENUE PRODUCT.
> Batch 1 only — user will hand the next batch after this lands.

## Goal

Make the side panel the single home for the product. Promote AI usage and the Pro
plan at every natural touch-point. Remove duplicated/dead controls. Fix two
long-standing bugs (recurring mic banner, transcript sometimes not starting).

## Hard invariants (never violate)

Calls always BYO-Twilio · Twilio Auth Token never persisted · backend is the
source of truth for entitlements AND credit balance · managed-AI settlement from
REAL vendor usage, never an estimate · our Anthropic/OpenAI/Deepgram keys never
reach the client · at zero balance stop AI gracefully (402) but NEVER drop a call ·
marketing consent separate + default-OFF · **additive only — existing v1 users
must not need re-login or face any breakage.**

Build/typecheck gates: `pnpm build` succeeds · extension `npx tsc --noEmit` 0
errors · `cd backend && npx tsc --noEmit` 0 errors.

---

## Work items

### 1. Standalone AI chatbot tab (Task 1)

**Today:** `AiChatbox.tsx` only mounts inside `CallHistoryDetail.tsx` over one
call's transcript. Prop is required `transcript: string`.

**Change:**
- Add `'ai'` to the call-store `view` union (`call-store.ts` lines 10 + 19) and
  `setView` signature.
- Add an **"AI"** tab to the Footer nav in `src/sidepanel/App.tsx` and route
  `view === 'ai'` → a new `AiTab` wrapper.
- Refactor `AiChatbox` to accept optional context instead of a required transcript:
  - New props: `{ transcript?: string; lockedToCall?: boolean }`.
  - `AiTab` renders `AiChatbox` with NO transcript by default ("General chat")
    and a **context picker**: a compact dropdown of recent calls
    (`storage.getHistory()` filtered to `hasTranscript`) — selecting one loads
    that transcript (`transcripts.get(sid)` → `buildTranscript` plain text) as
    context for subsequent questions. "General chat" is the default option.
  - `CallHistoryDetail` keeps current behaviour by passing the bound transcript
    + `lockedToCall` (hides the picker).
- **Mode flag:** client sends `mode: 'general' | 'call'` to the backend.
  `'call'` = transcript present (current coach prompt). `'general'` = no transcript
  (general dialer-assistant prompt). See backend change below.
- Empty-state copy adapts: call mode keeps the "Why didn't they commit?" hints;
  general mode shows general sales-assistant prompt hints.

**Backend (`backend/app/api/ai/chat/route.ts`) — additive:**
- Extend `ChatBody` with optional `mode?: 'general' | 'call'`.
- Derive: `const mode = body.mode ?? (transcript ? 'call' : 'general')`.
- When `mode === 'general'`, use a general system prompt
  ("You are a helpful sales assistant embedded in a dialer…") with no transcript
  block. When `'call'`, keep the existing coach prompt with the transcript block.
- Everything else (reserve → stream → settle, Pro gate, caps) unchanged.
- Client `streamChat` (`src/shared/credits.ts`): make `transcript` optional and
  add optional `mode`; pass through in the POST body.

### 2. Options tab → setup-only surface (Task 2)

**Decision (user):** keep the tab for the two things that genuinely need a full
tab — **Twilio provisioning wizard** + **microphone permission** — and strip every
duplicated control (those already live in `SettingsTab`).

- `src/options/App.tsx`:
  - Unconfigured → `ProvisioningWizard` (unchanged).
  - Configured → `MicPermissionCard` only, plus one line:
    "Everything else lives in the side panel — open the extension." No Claude
    connector / Deepgram / incoming-calls / HubSpot / transcript-folder / account
    / reset / sign-out cards on the tab.
  - Delete the now-unused card components from `options/App.tsx`
    (`ClaudeConnectorCard`, `DeepgramCard`, `IncomingCallsCard`, `HubSpotCard`,
    `TranscriptStorageCard`, `ToggleRow` if unused) — they are duplicated in
    `SettingsTab`. Keep `ProvisioningWizard`, `SetupForm`, `AutoSetupProgress`,
    `MicPermissionCard`.
- `manifest.config.ts`: `options_page` stays (it now serves setup + mic, not
  duplicated settings).
- **Mic flow unchanged** → no mic regression. (The recurring-banner bug is a
  separate UI fix, item 8.)
- Verify `SettingsTab` already covers everything removed (it does: AI &
  Transcription incl. BYO Deepgram + model + Claude connector, Call Settings,
  Extension Prefs, Account, Secure Device, Enable SMS, Recordings, Help). No
  migration needed — only deletion of the options duplicates.

### 3. Pro tab = sales surface (Task 3)

Rebuild `ProTab.tsx` into a sales page (keep all existing subscription-state
branches working):
- **Tier comparison** at top of the non-active states:
  - **Free** — GPT-5 mini AI, BYO Deepgram transcription, calling.
  - **Pro $9/mo** — all Claude models (Haiku/Sonnet/Opus), **1000 credits/mo**,
    SMS, recording, cloud history + Claude MCP. 7-day free trial.
- **Credit-system explainer**: "1 credit = $0.01. AI usage is metered by real
  vendor cost. Pro includes 1000 credits/month; top up any time." Short + clear.
- **Buy buttons:**
  - Subscription checkout via `getCheckoutUrl(userId)` (existing `handleUpgrade`).
  - **Credit top-ups** via `startTopUp(userId, credits)` for packs
    `TOPUP_PACKS = [1000, 2500, 5000]` = $10 / $25 / $50. Surface all three as
    one-tap buttons (reuse `CreditsSection`, which already renders packs).
- Active/trialing/cancelled/past_due states keep `CreditsSection` + management
  controls. Expired/no-access state leads with the tier comparison + `UpgradeSheet`.

### 4. Billing / remaining credits (Task 4)

- **Pro area:** live balance already via `CreditsSection`; also mount
  `CreditBalance` (currently unmounted) where a compact balance chip reads best.
- **Header chip:** add a small AI-credits chip to `StatusBar` header
  (`StatusBar.tsx`) showing cached balance instantly (`getCachedCreditState`) then
  refreshing (`getCreditBalance`). Tapping it → `setView('pro')`. Hidden when not
  registered / balance null. Low-balance (≤50) tint amber.

### 5. Dialpad caret (Task 5)

`Dialpad.tsx` number display (lines 371-378) currently a static `<div>`. Make the
display focusable with a visible text caret while preserving keypad/keyboard
behaviour:
- Render the number in a focusable element (a styled read-pattern `<input
  inputMode="tel">` bound to `input`, or a `contentEditable`/caret overlay) that
  shows a blinking caret and supports click-to-position + direct typing/paste.
- Keep keypad buttons, backspace, Enter-to-call, and the existing global keydown
  working (avoid double-input: when the field is focused let the field own typing;
  otherwise keep the window-level handler). Cap at 32 chars as today.
- Recommended: convert to a controlled `<input>` styled to look like the current
  big light number, with `caret-color` visible; drop the window keydown handler in
  favour of the input's own `onKeyDown` for Enter, keeping `+`/digit filtering.

### 6. Overall polish + showcase Deepgram & AI (Task 6 + user note)

- Transcription + AI are the headline product, not buried: AI gets its own tab
  (item 1); the Settings "AI & Transcription" section stays prominent; the AI tab
  empty state explains transcription-driven analysis.
- Production-level visual consistency across the rebuilt surfaces.

### 7. Remove duplicate settings buttons (user add)

On the dialer screen there are **two** settings entry points stacked plus the
footer tab:
- `StatusBar.tsx:56` gear ⚙ → `openOptionsPage()`.
- `Dialpad.tsx:163` "Settings" pill → `setView('settings')`.
- Footer "Settings" tab → `setView('settings')`.

**Change:** keep the **footer Settings tab** as the single canonical entry.
- Remove the `Dialpad` top-row "Settings" pill (keep the "Auto-dial" entry,
  re-align it).
- Remove the `StatusBar` gear ⚙ button. (Other `openOptionsPage()` callers in
  StatusBar — retry/mic/upgrade banners — are handled separately; the mic banner
  is reworked in item 8, and the device-retry path keeps its own ↺ Connect.)

### 8. Locked models → PRO badge + direct upgrade popup (user add)

In the model picker (`AiChatbox`), Claude models are Pro-gated.
- Replace the plain `<select>` with a picker that shows a **"PRO"** badge on locked
  models. The AI tab loads Pro status (`getSubscription(userId).hasAccess`).
- Clicking a locked model when not Pro does NOT attempt the request — it opens an
  **upgrade popup** (modal/sheet) that showcases Pro benefits and has a direct
  "Start free trial — $9/mo" button calling `getCheckoutUrl(userId)` →
  `chrome.tabs.create`. Reuse `UpgradeSheet`'s benefit content in a modal shell
  (new lightweight `UpgradeModal` wrapper, or render `UpgradeSheet` inside an
  overlay).
- When Pro, all models selectable normally.
- Backend Pro gate stays as the server-side enforcement (defence in depth — the
  client popup is UX, the 402 is truth).

### 9. AI promo button below the dialer (user add)

Below the dialpad call/backspace row in `Dialpad.tsx`, add a small, attractive
button — e.g. "✨ Ask AI about your calls" — that calls `setView('ai')`. Goal:
drive AI usage. Keep it compact so it doesn't crowd the keypad.

### 10. Bug — recurring microphone banner (user report)

**Root cause:** `StatusBar.tsx:68` shows the mic banner whenever
`deviceState !== 'registered'`. Twilio registration is token-based and never
needs the mic, and the banner never checks the real mic permission — so it flashes
on every transient `initializing`/`offline`/`error` state and even when the mic is
already granted.

**Fix:**
- New `useMicPermission()` hook: `navigator.permissions.query({ name:
  'microphone' as PermissionName })` → state `granted | prompt | denied |
  unsupported`, with a `change` listener to stay live. Fail-open to `unsupported`
  if the API throws (some Chromium forks).
- Mic banner renders **only** when permission is `prompt` or `denied` (never when
  `granted` or `unsupported`), fully decoupled from `deviceState`. Its button
  keeps opening the options page (the proven mic-grant surface).
- Net effect: once mic is granted, the banner never reappears; device
  connecting/offline states no longer masquerade as a mic problem.

### 11. Bug — transcript sometimes doesn't start (user report)

**Symptom:** intermittently a call produces no transcript.

**Investigation target:** `twilio-device.ts` `call.on('accept')` (lines 348-388).
Transcription start is an async IIFE that swallows errors
(`catch { this.transcription = null }`) with no retry and no user-visible signal.
Likely an intermittent managed-token / Deepgram-session race on connect.

**Fix (to confirm exact race during impl):**
- Make `TranscriptionController.start` failure non-fatal but **retry once** on
  transient failure before giving up.
- Surface a non-fatal "transcription unavailable for this call" indicator
  (existing `setTranscriptError` path / `TranscriptPanel`) instead of failing
  silently, so the user knows rather than assuming it's broken.
- Confirm BYO-key vs managed paths both reach `start`; verify there is no early
  return that drops transcription when both `managedOn` is false at accept-time but
  a key exists (re-read the gating at lines 359-387 before patching).
- Do NOT change call audio flow — call must never be affected.

---

## Files touched (summary)

- `src/sidepanel/stores/call-store.ts` — add `'ai'` view.
- `src/sidepanel/App.tsx` — AI tab in Footer + route.
- `src/sidepanel/components/AiChatbox.tsx` — optional transcript, context picker,
  PRO-badge picker, upgrade modal, mode flag.
- `src/sidepanel/components/ProTab.tsx` — sales surface + tiers + top-ups.
- `src/sidepanel/components/StatusBar.tsx` — remove gear; credits chip; mic banner fix.
- `src/sidepanel/components/Dialpad.tsx` — caret input; remove settings pill; AI promo button.
- `src/sidepanel/components/CreditBalance.tsx` — mount (Pro area / header).
- new `src/sidepanel/hooks/use-mic-permission.ts`.
- `src/options/App.tsx` — strip to setup + mic only.
- `src/shared/credits.ts` — `streamChat` optional transcript + mode.
- `backend/app/api/ai/chat/route.ts` — general vs call mode/system prompt.
- (maybe) new `UpgradeModal` shell reusing `UpgradeSheet` content.

## Out of scope (deferred / next batch)

- Anything the user holds back for "the next batch."
- Funding the Anthropic account (Claude fails gracefully; test with gpt-5-mini).
- DB/pricing changes — none needed.

## Verification

`pnpm build` succeeds · both typechecks 0 errors · load `dist/` unpacked and
sanity-check: new AI tab (general + call-context), Pro buy buttons (sub + top-ups),
credit balance display + header chip, dialpad caret, locked-model PRO badge +
upgrade popup, AI promo button below dialer, options tab shows only setup/mic,
single settings entry (footer), mic banner no longer recurs once granted. Run a
code review, fix Critical/Important findings, then open ONE PR.
