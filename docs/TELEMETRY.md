# Telemetry & Product Analytics

Anonymous, low-cost product analytics for the extension. Answers one question:
**where in the install → first-call funnel are users dropping?**

## Architecture

```
Chrome Extension                         Vercel (Next.js)            Supabase (Postgres)
┌─────────────────────────┐              ┌──────────────────┐        ┌────────────────────┐
│ service-worker          │              │ POST /api/events │        │ telemetry_events    │
│  • mint install_id      │  batched     │  • Zod validate  │ upsert │  (90-day retention) │
│  • extension_installed  │ ───────────► │  • allowlist     │ ─────► │                     │
│ side panel / options    │  fire&forget │  • sanitize meta │        │ views: v_funnel,    │
│  • track(name, meta)    │              │  • idempotent    │        │  v_activation_daily,│
│  • persisted queue      │ ◄─── 2xx ─── │    (id PK)        │        │  v_cohort_weekly …  │
│    (chrome.storage)     │   drop batch │                  │        │ pg_cron: tel_prune  │
└─────────────────────────┘              └──────────────────┘        └────────────────────┘
```

- **Anonymous** by `install_id` (UUID minted on install). `user_id` attached once a
  cloud account exists, so the bottom of the funnel dedups to real accounts.
- **MV3-safe**: queue persists in `chrome.storage.local`; flushed on every `track()`
  and on service-worker wake. Survives worker suspension.
- **Fire-and-forget**: never blocks or breaks call flow.
- **PII-free**: meta key allowlist client + server; blocked keys (number, token, SID…)
  stripped at ingest.

## Files

| File | Role |
|------|------|
| `scripts/migration-telemetry.sql` | Table, indexes, RLS, views, retention. Run in Supabase SQL editor. |
| `backend/lib/telemetry-schema.ts` | Zod ingest contract + meta sanitizer. |
| `backend/app/api/events/route.ts` | `POST /api/events` ingest endpoint. |
| `src/shared/telemetry.ts` | `track()`, `getInstallId()`, persisted queue. |

## Events

| Event | Fires when | Stage |
|-------|-----------|-------|
| `extension_installed` | `onInstalled` (fresh install only) | 1 |
| `panel_opened` | side panel mounts | 2 |
| `wizard_started` | setup wizard reached (first-time only) | 3 |
| `twilio_creds_submitted` | SID+token validated against Twilio | 4 |
| `autodeploy_succeeded` / `autodeploy_failed` | auto-provision resolves/throws (`meta.step`, `meta.reason`) | 5 |
| `device_ready` | (reserved — wire when needed) | 6 |
| `first_call_synced` | first call synced to cloud (`meta.hasTranscript`) | 7 |
| `transcript_enabled` | Deepgram key saved | — |

## Setup (one time)

1. Open Supabase → SQL editor → paste & run `scripts/migration-telemetry.sql`.
2. (Optional, recommended) Database → Extensions → enable **pg_cron**, then re-run the
   migration's last block so `tel_prune` is scheduled. Without pg_cron, run
   `select public.tel_prune();` weekly.
3. Deploy backend (the `/api/events` route ships with it).
4. Build + upload the extension.
5. **Compliance:** add a line to the privacy policy + Chrome store data-disclosure:
   "anonymous usage events (no message content, no phone numbers, no credentials)."

---

## Dashboard queries (paste into Supabase SQL editor)

### 1. Activation funnel
```sql
select * from public.v_funnel;
```
Read top-to-bottom: the biggest row-to-row % drop is your leak.

### 2. Daily installs vs activations
```sql
select * from public.v_activation_daily limit 30;
```

### 3. Time-to-activate (median minutes)
```sql
select
  percentile_cont(0.5) within group (order by minutes_to_activate) as median_min,
  count(*) as activated
from public.v_time_to_activate;
```

### 4. Transcript adoption (the Deepgram leak)
```sql
select * from public.v_transcript_adoption;
```

### 5. Conversion (trial → paid)
```sql
select * from public.v_conversion;
```

### 6. Weekly cohorts
```sql
select * from public.v_cohort_weekly;
```

### 7. Debug — where auto-deploy fails
```sql
select * from public.v_debug_autodeploy;
```

### 8. Debug — raw event tail
```sql
select * from public.v_debug_recent;
```

### Ad-hoc: funnel for a single install
```sql
select received_at, name, meta
from public.telemetry_events
where install_id = '<uuid>'
order by received_at;
```

## Cost & maintenance

- One small table, ~9 event types, a handful per user. Well within Supabase free (500MB).
- `pg_cron` prunes raw events > 90 days nightly. Views compute on read — nothing to maintain.
- No third-party analytics SaaS, no extra infra. Solo-founder friendly.

## Known limits (by design)

- `install_id` resets on reinstall / new Chrome profile → "installs" slightly inflated.
  Real accounts still dedup via `user_id` + the Twilio-SID dedup in `users`.
- No session/heatmap data — this measures the activation funnel only, not in-page UX.
- `device_ready` is defined but not yet wired; add it if the drop turns out to be
  between auto-deploy success and first call.
