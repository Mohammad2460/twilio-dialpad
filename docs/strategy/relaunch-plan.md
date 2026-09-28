# Relaunch plan — Twilio Dialpad 2.0

_Agreed with the owner on 2026-09-28/29. This is the working plan; build it one item at a time. Keep it current as decisions change._

## Where we are
- **1.3.0** submitted to the Chrome Web Store 2026-09-29 (quiet fix release: reconnect banner for locked-out 1.2.0 installs, readable device errors, trial transcription cap, permission cleanup). No marketing.
- Treat the product as **zero users**: no email list, no active customers worth protecting (one legacy $9 Dodo subscription exists — owner decides; never touch it).
- Real funnel data (lifetime, ~110 installs): 106 started setup → **41 entered Twilio creds (61% drop)** → 34 made a first call → 5 ever enabled transcription → ~4 paid. Activated users made ~26 calls each (882 total) — the product sticks once set up; **activation is the problem**.

## Version roadmap
| Version | Scope | Marketing |
|---|---|---|
| 1.3.0 | Fix release (shipped) | none |
| 1.4, 1.5… | Each finished piece below, shipped quietly | none — test with founding users |
| **2.0.0** | Everything below complete | full relaunch |

## Build order
1. **AI assistant in the extension (v1)** ← START HERE
2. **Pricing: Free vs Pro limits in the extension + demo tour**
3. **Activation fixes** (Twilio setup guide, trust copy, email-first)
4. **Retention loops**
5. **Store listing + landing page**, then the 2.0 launch

---

## 1. AI assistant (in-extension)
Already ~70% built but hidden: `AI_CHAT_ENABLED = false` in `src/shared/flags.ts`; backend `POST /api/ai/chat` exists with credit metering (reserve → settle from real vendor usage → refund).

- **Why:** the Claude MCP connector needs a paid Claude plan + connector setup — most sales reps never do it. Built-in chat works for everyone from minute one and is the reason to pay. Keep the MCP connector too (zero cost to us).
- **v1 — Ask (read-only):** Q&A over the user's calls ("what did Acme object to?", "who should I call back today?"), auto-loaded recent transcripts (newest first, ~40k-token budget under the 60k cap), post-call summary + next steps.
- **v2 — Prepare (human confirms every action):** draft follow-up email/SMS, build an auto-dialer list from calls, write notes/reminders — always a Confirm button.
- **v3 — Act autonomously:** probably never; only if users ask. Risk: wrong calls, consent/legal.
- **Model:** start on **gpt-5-mini** (OpenAI is funded; ~$0.01/question with ~40k context). Claude Haiku (~$0.04) / Sonnet (~$0.12) later as a premium option once the Anthropic account is funded.

## 2. Pricing
Only **transcription** has real marginal cost (~$0.46/hr Deepgram) — plus AI questions once chat ships. Calling, auto-dialer, history and the MCP connector cost ~$0.

- **No daily call cap.** Calls cost us nothing; the main rival (Twilio Softphone) is hated for "free then pay per dial". "Honest free, unlimited calling" is the store headline.
- **Free forever:** unlimited calls in/out, click-to-call, 30-day history, auto-dialer up to 25 numbers/list, 30 min transcription/month, **20 AI questions/month**, 3 AI actions, Claude connector over last 5 calls.
- **Pro — $19/mo, or $15/mo billed yearly ($180):** unlimited history + auto-dialer (CSV), 10 h transcription/month, **500 AI questions/month**, unlimited AI actions, Claude connector over all calls, recordings, forwarding, HubSpot. Premium model uses allowance faster (e.g. 1 Sonnet = 5 standard).
- **Top-up pack:** $9 for extra hours/questions. Show "hours" and "questions" to users, never "credits" (credits stay internal bookkeeping).
- **Trial:** keep 7-day full Pro trial; afterwards drop to **Free, not locked** (reverse trial). Pair with a trial-end recap ("42 calls, 3h transcribed…").
- **Unit economics:** Pro ≈ $19 − ~$1.30 fees − ~$3 typical AI+transcription ≈ **$14–15/mo kept**.
- **Later only if demanded:** $39 "AI Max" (Sonnet default, bigger allowances); $29/user Team tier after 3+ requests. Skip per-dial pricing, credits-only pricing, lifetime deals (or exclude transcription if ever).
- **Payments rule:** Dodo products/prices are created by the owner in the Dodo dashboard. Claude never touches Dodo or customer-payment code/data.
- **Validate:** watch trial→paid, Free→Pro and which limit triggers upgrades for 60 days; if conversion drops >50% vs $9, go to $15; if nobody objects, $24 is possible.

## 3. Growth — four pillars
**Activation (biggest leak):**
1. Try-before-setup **demo tour** — sample calls, transcript and an AI answer before asking for Twilio creds.
2. **"No Twilio account? Get one in 3 minutes"** guide at the creds step (signup link, where SID/token live, buying a number, cost line "~$1.15/mo per number + ~1.4¢/min to Twilio", 60-sec video).
3. **Trust copy** at the creds step: token verified once, never stored; open source (public GitHub) link.
4. **Email before creds** ("send me the setup guide") so leavers can be followed up.
5. First-week **checklist**: first call · import CSV · turn on transcription · ask the AI.

**Retention:**
6. Transcription **on by default** during trial (free, capped).
7. **Post-call card**: duration, "transcript ready → Ask AI", per-number notes.
8. **Click-to-call everywhere** (bubble on Gmail/HubSpot/LinkedIn) promoted in onboarding.
9. **Missed-call loop**: notification + one-tap call back + reminders.
10. **Weekly "your week in calls"** email + in-panel stats.
11. **Trial-end value recap** (billing copy only — owner approves).

**Acquisition:**
12. **Store listing rewrite** — ready in `docs/seo/07-cws-listing-rewrite.md`; benefit screenshots + 30-sec video. Store impressions fell 213 → 19/day.
13. **In-app review prompt after the 10th successful call.** ⚠️ Never reward reviews (Chrome Web Store policy).
14. **Competitor angle:** Twilio Softphone "free" then pay-per-dial; Auto Dialer for Twilio 3.6★ (crashes/billing). See `docs/seo/02-competitor-analysis.md`.
15. **Claude/MCP hook:** MCP directories (mcp.so, Smithery, Glama, PulseMCP, awesome-mcp-servers), r/ClaudeAI, Product Hunt.
16. **Landing page + SEO:** home, pricing, setup guide, comparison pages, later "Twilio dialer for HubSpot/Gmail/Salesforce". AI-search plan: `docs/seo/08-ai-visibility-strategy.md`. Public GitHub README as a trust/SEO asset.
17. **Communities:** r/twilio, r/sales, r/coldcalling, r/SaaS, r/smallbusiness, IndieHackers, Twilio forums — help 5×, mention 1×; follow each subreddit's rules.
18. **Referral credits** ("give 5 AI hours, get 5").

**Win-back:**
19. Email locked-out users once 1.3.0 is live — _owner says there are effectively no usable emails; skip unless that changes._

## 4. Distribution system (from zero)
- **Audience rings:** (1) already on Twilio — easiest, win first; (2) AI/Claude users — launch buzz; (3) salespeople who cold-call — biggest, pays, needs the Twilio guide + demo mode.
- **Everything ends in:** install + email (email is already mandatory at setup → the owned list).
- **Channels by payoff:** #1 Chrome Web Store (listing, reviews, frequent updates) · #2 **founding 50 users** onboarded 1:1 ("3 months Pro free for a 15-min setup call"; ask for an honest review afterwards, never tied to the reward) · #3 YouTube tutorials · #4 landing page + SEO + GitHub · #5 MCP/AI channels · #6 communities · #7 launch sites (Product Hunt, Show HN, AlternativeTo, SaaSHub, BetaList, IndieHackers) · #8 in-product loops ("Summarized by Twilio Dialpad" footer, referrals) · #9 small, personal, compliant outreach (≤20/day).
- **8-week timeline:** wk 1–2 foundations (listing, landing page, setup video, review prompt, tracking) · wk 3–5 founding 50 + Reddit + first 2 videos · wk 6 AI v1 + demo · wk 7–8 **2.0 launch week** (PH + Show HN + MCP directories + r/ClaudeAI + comparison pages + email list) · then "launch again" monthly with each real feature.
- **Weekly routine (~8–10 h):** daily 20-min community answers; Mon metrics; Tue founding-user calls; Wed one content piece; Thu outreach/directories; Fri ship → store update + changelog. Drop any channel with <10 installs after 4 weeks.
- **90-day targets:** store impressions 19 → 300+/day; 500+ installs; 40+ reviews at 4.5★+; 100+ weekly active callers; 20–30 Pro; 300+ emails. North-star: **weekly active callers**.
- **Skills per channel:** copywriting / page-cro (listing, site) · competitor-alternatives · programmatic-seo · ai-seo · social-content · email-sequence · cold-email · referral-program · last30days (research).
