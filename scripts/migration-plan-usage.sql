-- Migration: Free / Pro monthly usage counters. Idempotent. Additive only — new
-- tables and functions; no existing table, function or row is changed.
--
-- Apply BEFORE the backend that uses it deploys. The pricing switch (stopping
-- the credit grants, adding plan limits) is a separate file to run AFTER that
-- deploy: migration-plan-limits-activate.sql.
--
-- Model:
--   usage_counters      — one row per user, metric and period. Monthly metrics
--                         use the 1st of the month (UTC) as the period; the
--                         daily one uses the day (UTC). A new period simply has
--                         no row yet, so "reset on the 1st" needs no job.
--   transcribe_windows  — one row per managed-transcription window paid for from
--                         the monthly allowance. The seconds are taken when the
--                         window opens and the unused part is given back when it
--                         is settled, so the backend never trusts the client for
--                         what was used.
--
-- The credit ledger is unchanged. It still holds balances people already have,
-- and it now also records the real vendor cost of allowance usage as a row with
-- a zero credit delta (record_usage_cost).

-- ─────────────────────────────────────────────────────────────────────────────
-- Tables
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.usage_counters (
  user_id uuid    not null references public.users(id) on delete cascade,
  metric  text    not null check (metric in ('transcribe_seconds', 'ai_questions', 'summaries')),
  period  date    not null,
  used    integer not null default 0 check (used >= 0),
  primary key (user_id, metric, period)
);

create table if not exists public.transcribe_windows (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid        not null references public.users(id) on delete cascade,
  period       date        not null,
  model        text        not null,
  window_key   text,
  held_seconds integer     not null check (held_seconds > 0),
  used_seconds integer     check (used_seconds >= 0),
  status       text        not null default 'pending' check (status in ('pending', 'settled')),
  created_at   timestamptz not null default now(),
  settled_at   timestamptz
);

create index if not exists transcribe_windows_user_time
  on public.transcribe_windows (user_id, created_at desc);
create index if not exists transcribe_windows_pending
  on public.transcribe_windows (created_at) where status = 'pending';

-- Backend-only (service role). No anon / authenticated access.
alter table public.usage_counters     enable row level security;
alter table public.transcribe_windows enable row level security;
revoke all on public.usage_counters     from anon, authenticated;
revoke all on public.transcribe_windows from anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- usage_take — add p_amount to a counter if it still fits under p_limit.
-- One conditional UPDATE, so two concurrent requests cannot both take the last
-- unit. Returns true when taken.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.usage_take(
  p_user   uuid,
  p_metric text,
  p_period date,
  p_amount integer,
  p_limit  integer
)
returns boolean
language plpgsql
set search_path = public
as $$
begin
  if p_amount <= 0 then
    raise exception 'usage amount must be positive';
  end if;

  insert into usage_counters (user_id, metric, period, used)
  values (p_user, p_metric, p_period, 0)
  on conflict do nothing;

  update usage_counters
     set used = used + p_amount
   where user_id = p_user and metric = p_metric and period = p_period
     and used + p_amount <= p_limit;
  return found;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- usage_give_back — return units taken for work that did not happen.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.usage_give_back(
  p_user   uuid,
  p_metric text,
  p_period date,
  p_amount integer
)
returns void
language sql
set search_path = public
as $$
  update usage_counters
     set used = greatest(used - greatest(p_amount, 0), 0)
   where user_id = p_user and metric = p_metric and period = p_period;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- transcribe_window_open — take the next window from the monthly allowance.
-- Holds min(p_window, what is left); returns no row when less than p_min is
-- left. The counter row is locked, so concurrent opens cannot overspend.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.transcribe_window_open(
  p_user   uuid,
  p_period date,
  p_window integer,
  p_limit  integer,
  p_min    integer,
  p_model  text,
  p_key    text default null
)
returns table (id uuid, held_seconds integer)
language plpgsql
set search_path = public
as $$
declare
  v_used integer;
  v_hold integer;
  v_id   uuid;
begin
  insert into usage_counters (user_id, metric, period, used)
  values (p_user, 'transcribe_seconds', p_period, 0)
  on conflict do nothing;

  select c.used into v_used
    from usage_counters c
   where c.user_id = p_user and c.metric = 'transcribe_seconds' and c.period = p_period
     for update;

  v_hold := least(p_window, p_limit - v_used);
  if v_hold is null or v_hold < greatest(p_min, 1) then
    return;
  end if;

  update usage_counters c
     set used = c.used + v_hold
   where c.user_id = p_user and c.metric = 'transcribe_seconds' and c.period = p_period;

  insert into transcribe_windows (user_id, period, model, window_key, held_seconds)
  values (p_user, p_period, p_model, p_key, v_hold)
  returning transcribe_windows.id into v_id;

  return query select v_id, v_hold;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- transcribe_window_settle — close a window at the seconds actually used and
-- give the rest back to the month it was taken from. Only the owner's own
-- pending window; a second call is a no-op. Returns true when it settled.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.transcribe_window_settle(
  p_id      uuid,
  p_user    uuid,
  p_seconds integer
)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  w      transcribe_windows%rowtype;
  v_used integer;
begin
  select * into w from transcribe_windows
   where id = p_id and user_id = p_user
     for update;
  if not found or w.status <> 'pending' then
    return false;
  end if;

  v_used := least(greatest(coalesce(p_seconds, w.held_seconds), 0), w.held_seconds);

  update transcribe_windows
     set status = 'settled', used_seconds = v_used, settled_at = now()
   where id = p_id;

  if v_used < w.held_seconds then
    perform usage_give_back(w.user_id, 'transcribe_seconds', w.period, w.held_seconds - v_used);
  end if;
  return true;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- reap_transcribe_windows — close windows that were never settled. The token
-- was delivered, so the whole window counts as used (same rule the credit
-- reaper applies to transcription holds). Run from the daily cron.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.reap_transcribe_windows(p_minutes integer default 30)
returns integer
language plpgsql
set search_path = public
as $$
declare
  n integer;
begin
  update transcribe_windows
     set status = 'settled', used_seconds = held_seconds, settled_at = now()
   where status = 'pending'
     and created_at < now() - make_interval(mins => p_minutes);
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- record_usage_cost — write the real vendor cost of allowance usage to the
-- credit ledger as a zero-credit row. Balances are not touched.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.record_usage_cost(
  p_user        uuid,
  p_request_id  uuid,
  p_model       text,
  p_vendor_cost numeric,
  p_pricing_ver integer default null
)
returns void
language sql
set search_path = public
as $$
  insert into credit_ledger
    (user_id, kind, credits_delta, balance_after, request_id, model, vendor_cost_usd, pricing_version, status)
  values
    (p_user, 'settlement', 0, credit_balance(p_user), p_request_id, p_model, p_vendor_cost, p_pricing_ver, 'settled');
$$;

-- Functions are for the backend's service role only.
revoke execute on function public.usage_take(uuid, text, date, integer, integer)                              from public, anon, authenticated;
revoke execute on function public.usage_give_back(uuid, text, date, integer)                                  from public, anon, authenticated;
revoke execute on function public.transcribe_window_open(uuid, date, integer, integer, integer, text, text)   from public, anon, authenticated;
revoke execute on function public.transcribe_window_settle(uuid, uuid, integer)                               from public, anon, authenticated;
revoke execute on function public.reap_transcribe_windows(integer)                                            from public, anon, authenticated;
revoke execute on function public.record_usage_cost(uuid, uuid, text, numeric, integer)                       from public, anon, authenticated;
grant  execute on function public.usage_take(uuid, text, date, integer, integer)                              to service_role;
grant  execute on function public.usage_give_back(uuid, text, date, integer)                                  to service_role;
grant  execute on function public.transcribe_window_open(uuid, date, integer, integer, integer, text, text)   to service_role;
grant  execute on function public.transcribe_window_settle(uuid, uuid, integer)                               to service_role;
grant  execute on function public.reap_transcribe_windows(integer)                                            to service_role;
grant  execute on function public.record_usage_cost(uuid, uuid, text, numeric, integer)                       to service_role;
