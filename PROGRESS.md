# PROGRESS — Twilio Dialpad

> Current state only. History lives in git (`git log`) and merged PRs — don't re-grow a changelog here.

_Last updated: 2026-09-28._

## Status: v1.3.0 revival (branch `claude/extension-revival-audit-8e92b8`)

### Why the product "died" (root cause, 2026-09-28 audit)
- The Chrome Web Store build was **v1.2.0 from 2026-06-06** — built before device auth (PR #3) and everything after it. `package.json` was never bumped, so all later work shipped to `main` but never to the store.
- v1.2.0 authenticates with `Bearer <userId>`. The backend accepts that only until `LEGACY_AUTH_UNTIL` (default `2026-07-31`, `backend/lib/auth.ts`). Since 2026-08-01 every store install gets 401 on subscription / credits / call sync / Pro features. Calling itself still worked (legacy per-user Twilio Function).
- At audit, nearly every user was on the legacy path (= locked out). No Vercel runtime errors; Supabase healthy.

### v1.3.0 — what changed
- **`ReconnectBanner`** (`src/sidepanel/components/ReconnectBanner.tsx`): pinned app-wide for any install without a device secret. Inline Twilio Auth Token field → `registerDevice()` (token verified with Twilio, discarded) → reload. Backend dedups by Account SID, so the same user / trial / subscription carries over. Replaces the buried Settings "Secure this device" card (`window.prompt`).
- **Trial = every feature, end to end.** PR #12 changed the client (`entitlements.can()` = paid || trialing) but the backend `recordings` + `sms` routes still required `user_is_paid` → trial users recorded calls they could never list (402). Both now use `user_has_access`. The AI-chat Claude-model gate stays on `user_is_paid` (protects Anthropic spend; AI chat is hidden anyway).
- Stale entitlements test updated to the trial-unlocks-all rule. Version → 1.3.0.

### Release checklist (1.3.0)
- [ ] Manual upgrade test: install the 1.2.0 zip unpacked → open → load unpacked `dist/` over it → banner shows → reconnect → credits / Pro tab load.
- [ ] Merge PR → Vercel auto-deploys backend.
- [ ] `pnpm build`, zip `dist/`, upload to the Chrome Web Store.
- [ ] Optional stopgap until store approval: Vercel env `LEGACY_AUTH_UNTIL=<date>` re-opens bare-userId auth for v1.2.0 installs. Weaker auth while open — keep the window short, remove after rollout.

### Pending prod hardening
Supabase security-advisor findings (DB role grants / view + function settings) pending owner approval. Details kept out of this public repo — run `get_advisors` (security) on the prod project.

### Known cleanup
- Backend SMS routes are dormant (UI removed). Delete or revive when SMS strategy is decided.
- Backend `npm audit`: postcss inside `next@15.5.x` (build-time only; fix = Next 16 major). Not urgent for an API-only backend.

### Product state
- Calls: BYO-Twilio. New installs = backend-hosted voice (`/api/voice/token`, `/api/voice/twiml`); ≤1.2.0 installs = legacy per-user Twilio Function.
- Hidden via `src/shared/flags.ts`: in-extension AI chat, BYO Deepgram. SMS UI removed (backend routes dormant).
- Live: dialer, call history, auto-dialer (CSV, 100 cap), recording, managed transcription (credits; free during trial), Claude MCP connector (`/api/mcp/[userId]`), Pro $9/mo + 7-day trial via Dodo.
- Owner action outstanding: fund the Anthropic account (Claude models fail gracefully until then).

### Next bet (planned, not built)
AI over call history: auto-load recent transcripts into general-mode chat (gpt-5-mini, all tiers, credit-metered), then a tool-use loop over the MCP queries. Sell Pro on model quality + credit bucket, not access.
