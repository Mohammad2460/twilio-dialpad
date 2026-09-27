-- Trial transcription cap (backend/lib/trial-cap.ts).
-- One row per free-trial Deepgram token minted; the backend counts rows per user
-- over a rolling 24h. Backend-only table (service_role); no anon/authenticated access.
-- Safe to run before or after the code deploys: the code fails open without it.

create table if not exists public.trial_transcribe_mints (
  id        bigint generated always as identity primary key,
  user_id   uuid not null references public.users(id) on delete cascade,
  minted_at timestamptz not null default now()
);

create index if not exists trial_transcribe_mints_user_time
  on public.trial_transcribe_mints (user_id, minted_at desc);

alter table public.trial_transcribe_mints enable row level security;
revoke all on public.trial_transcribe_mints from anon, authenticated;
