-- ============================================================================
-- Telemetry / Product Analytics — schema, indexes, retention, dashboards
-- Run in Supabase SQL editor (project: dialler-mcp).
-- Idempotent: safe to re-run.
-- ============================================================================

-- ── 1. Events table ─────────────────────────────────────────────────────────
-- One row per product event. Anonymous by install_id; linked to user_id once
-- the user creates a cloud account. `id` is a client-generated UUID used for
-- idempotency (retries ON CONFLICT DO NOTHING).
create table if not exists public.telemetry_events (
  id          uuid        primary key,                       -- client event id (dedup)
  install_id  uuid        not null,                          -- anonymous device/profile id
  user_id     uuid        references public.users(id) on delete set null,
  name        text        not null,                          -- event name (allowlisted app-side)
  meta        jsonb       not null default '{}'::jsonb,       -- small, PII-free attributes
  client_ts   timestamptz not null,                          -- when event happened (client clock)
  received_at timestamptz not null default now()             -- when server ingested (source of truth)
);

comment on table public.telemetry_events is
  'Anonymous product-analytics events from the Chrome extension. No PII. 90-day retention.';

-- ── 2. Indexes ──────────────────────────────────────────────────────────────
create index if not exists idx_tel_install      on public.telemetry_events (install_id);
create index if not exists idx_tel_name_recv    on public.telemetry_events (name, received_at desc);
create index if not exists idx_tel_recv         on public.telemetry_events (received_at);          -- retention prune + time queries
create index if not exists idx_tel_user         on public.telemetry_events (user_id) where user_id is not null;
-- One funnel row per install per event-name is all we need; this speeds DISTINCT funnels.
create index if not exists idx_tel_install_name on public.telemetry_events (install_id, name);

-- ── 3. RLS ──────────────────────────────────────────────────────────────────
-- Writes only happen via the service-role key in the API route, which bypasses
-- RLS. Enable RLS with no policies so the anon/public key can never read events.
alter table public.telemetry_events enable row level security;

-- ── 4. Stage mapping (funnel order) ─────────────────────────────────────────
-- Single source of truth for funnel ordering. Add new stages here only.
create or replace function public.tel_stage_rank(event_name text)
returns int language sql immutable as $$
  select case event_name
    when 'extension_installed'     then 1
    when 'panel_opened'            then 2
    when 'wizard_started'          then 3
    when 'twilio_creds_submitted'  then 4
    when 'autodeploy_succeeded'    then 5
    when 'device_ready'            then 6
    when 'first_call_synced'       then 7
    else 0
  end;
$$;

-- ============================================================================
-- 5. DASHBOARD VIEWS
-- ============================================================================

-- ── 5a. Activation funnel (lifetime, distinct installs per stage) ───────────
create or replace view public.v_funnel as
with reached as (
  select install_id, max(public.tel_stage_rank(name)) as max_rank
  from public.telemetry_events
  group by install_id
)
select s.rank, s.stage,
       count(*) filter (where r.max_rank >= s.rank) as installs
from (values
  (1,'installed'),
  (2,'panel_opened'),
  (3,'wizard_started'),
  (4,'creds_submitted'),
  (5,'autodeploy_ok'),
  (6,'device_ready'),
  (7,'activated_first_call')
) as s(rank, stage)
cross join reached r
group by s.rank, s.stage
order by s.rank;

-- ── 5b. Activation daily (installs vs activations per day) ──────────────────
create or replace view public.v_activation_daily as
select
  d::date                                                   as day,
  count(*) filter (where name = 'extension_installed')      as installs,
  count(*) filter (where name = 'first_call_synced')        as activations
from public.telemetry_events,
     lateral (select date_trunc('day', received_at) as d) t
group by d::date
order by day desc;

-- ── 5c. Time-to-activate (per activated install, minutes) ───────────────────
create or replace view public.v_time_to_activate as
with i as (
  select install_id, min(received_at) as installed_at
  from public.telemetry_events where name = 'extension_installed'
  group by install_id
),
a as (
  select install_id, min(received_at) as activated_at
  from public.telemetry_events where name = 'first_call_synced'
  group by install_id
)
select a.install_id,
       i.installed_at, a.activated_at,
       round(extract(epoch from (a.activated_at - i.installed_at)) / 60.0, 1) as minutes_to_activate
from a join i using (install_id)
where a.activated_at >= i.installed_at;

-- ── 5d. Transcript adoption (combines intent event + real call data) ────────
-- Adoption rate = % of activated users who have at least one transcribed call.
create or replace view public.v_transcript_adoption as
select
  (select count(*) from public.users)                                                 as total_users,
  (select count(distinct user_id) from public.calls where has_transcript)             as users_with_transcript,
  (select count(*) from public.calls)                                                 as total_calls,
  (select count(*) from public.calls where has_transcript)                            as transcribed_calls,
  round(
    100.0 * (select count(*) from public.calls where has_transcript)
          / nullif((select count(*) from public.calls), 0), 1)                        as transcript_call_rate_pct,
  (select count(distinct install_id) from public.telemetry_events
     where name = 'transcript_enabled')                                               as installs_enabled_deepgram;

-- ── 5e. Conversion (trial → paid, from users table) ─────────────────────────
create or replace view public.v_conversion as
select
  count(*)                                                  as total_accounts,
  count(*) filter (where subscription_status = 'trialing')  as trialing,
  count(*) filter (where subscription_status = 'active')    as active_paid,
  count(*) filter (where subscription_status in ('cancelled','expired','past_due')) as lapsed,
  round(
    100.0 * count(*) filter (where subscription_status = 'active')
          / nullif(count(*), 0), 1)                          as paid_conversion_pct
from public.users;

-- ── 5f. Weekly cohort funnel (install week → activation) ────────────────────
create or replace view public.v_cohort_weekly as
with first_seen as (
  select install_id,
         date_trunc('week', min(received_at))::date as cohort_week
  from public.telemetry_events
  group by install_id
),
reached as (
  select install_id, max(public.tel_stage_rank(name)) as max_rank
  from public.telemetry_events
  group by install_id
)
select f.cohort_week,
       count(*)                                                   as installs,
       count(*) filter (where r.max_rank >= 3)                    as started_wizard,
       count(*) filter (where r.max_rank >= 4)                    as submitted_creds,
       count(*) filter (where r.max_rank >= 7)                    as activated,
       round(100.0 * count(*) filter (where r.max_rank >= 7)
                   / nullif(count(*),0), 1)                       as activation_pct
from first_seen f
join reached r using (install_id)
group by f.cohort_week
order by f.cohort_week desc;

-- ── 5g. Debug: auto-deploy failures by step/reason ──────────────────────────
create or replace view public.v_debug_autodeploy as
select
  coalesce(meta->>'step', 'unknown')   as failed_step,
  coalesce(meta->>'reason', 'unknown') as reason,
  count(*)                             as failures,
  max(received_at)                     as last_seen
from public.telemetry_events
where name = 'autodeploy_failed'
group by 1, 2
order by failures desc;

-- ── 5h. Debug: raw recent events (tail) ─────────────────────────────────────
create or replace view public.v_debug_recent as
select received_at, name, install_id, user_id, meta
from public.telemetry_events
order by received_at desc
limit 200;

-- ============================================================================
-- 6. RETENTION — prune raw events older than 90 days (keeps you on free tier)
-- ============================================================================
create or replace function public.tel_prune()
returns void language sql as $$
  delete from public.telemetry_events where received_at < now() - interval '90 days';
$$;

-- Schedule daily at 03:00 UTC via pg_cron (Supabase: enable under Database → Extensions).
-- Guarded so re-running the migration doesn't duplicate the job.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('telemetry-prune')
      where exists (select 1 from cron.job where jobname = 'telemetry-prune');
    perform cron.schedule('telemetry-prune', '0 3 * * *', $cron$ select public.tel_prune(); $cron$);
  end if;
end $$;

-- If pg_cron is not enabled, run `select public.tel_prune();` manually/weekly instead.
