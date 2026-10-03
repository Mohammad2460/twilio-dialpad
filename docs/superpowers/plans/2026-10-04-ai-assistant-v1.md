# AI assistant v1 — implementation plan

Spec: `docs/superpowers/specs/2026-10-04-ai-assistant-v1-design.md`. TDD for every pure module.

## Backend

1. `backend/lib/ai-prompts.ts` + `backend/tests/ai-prompts.test.ts`
   - `chatSystemPrompt(mode, { transcript, context })` for `call` / `general` / `calls`.
   - `INSIGHT_JSON_SCHEMA`, `insightSystemPrompt()`, `insightUserPrompt()`.
   - `parseInsight(raw)` — zod validation, trims, caps, drops invalid dates.
   - `sanitizeTurns(messages)` — role/content check, last 12.
   - `reservationKey(scope, clientKey?)` — always unique per vendor call.
2. `backend/app/api/ai/chat/route.ts` — use the helpers, add `mode: 'calls'` + `context`.
3. `backend/app/api/ai/summarize/route.ts` — new route (reserve → OpenAI JSON → settle/refund).
4. `cd backend && npx tsc --noEmit && npx vitest run`.

## Extension — logic

5. `src/shared/types.ts` — `CallPromise`, `CallInsight`, `Transcript.insight`, `Settings.aiAutoSummary`;
   `storage.ts` schema; `transcripts.listMeta()`.
6. `src/shared/ai-context.ts` + `tests/unit/ai-context.test.ts`.
7. `src/shared/insights.ts` + `tests/unit/insights.test.ts`.
8. `src/shared/credits.ts` — `streamChat` gains `context` / `mode: 'calls'`; add `requestInsight()`.

## Extension — UI

9. `AiChatbox` — single model, no credit counter, suggestion chips, `[C#]` citation chips.
10. `InsightCard`, `PreCallBrief`, `AiToday` (Today + promises) components.
11. `AiTab` — Today → promises → chat, empty state, privacy notice, Claude connector link.
12. `CallHistoryDetail` — insight card, timestamp jump, remove the old paywall/promo blocks.
13. `Dialpad` + `IncomingCall` — pre-call brief.
14. `use-device.ts` — summarise on call end, backfill on panel open.
15. `SettingsTab` — auto-summary toggle; `ProTab` / `CreditsSection` copy; flip `AI_CHAT_ENABLED`.

## Wrap-up

16. `docs/PRIVACY_POLICY.md`, `PROGRESS.md`, relaunch plan status, version → 1.4.0.
17. `pnpm test`, `npx tsc --noEmit`, `pnpm build`; code review; PR.
