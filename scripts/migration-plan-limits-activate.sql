-- Migration: switch pricing to Free / Pro monthly allowances. Idempotent.
--
-- Run AFTER the backend that reads `plans` is deployed (and after
-- migration-plan-usage.sql). Until this runs, that backend uses the same limits
-- from its built-in defaults and the old credit grants keep being issued.
--
-- What it does: adds a new pricing_config version copied from the active one,
-- with
--   • free_grant / monthly_grant set to 0 — no new credits are granted. Credits
--     people already hold stay in their buckets and stay spendable.
--   • plans    — the monthly limits per plan (changeable here, no release).
--   • checkout — the name and price of each product new checkouts use.
--                Changing a price = change name AND price_cents together; the
--                backend then finds or creates a product by that new name.
--                Existing products and subscriptions are never edited.
-- then makes it the active version. Nothing is deleted: to roll back, set the
-- previous version active again.

do $$
declare
  v_old integer;
  v_new integer;
begin
  select version into v_old from pricing_config where active;
  if v_old is null then
    raise exception 'no active pricing_config';
  end if;

  -- Already applied (the active version carries plan limits) → nothing to do.
  if exists (select 1 from pricing_config where active and config ? 'plans') then
    return;
  end if;

  select max(version) + 1 into v_new from pricing_config;

  insert into pricing_config (version, config, active)
  select v_new,
         config || jsonb_build_object(
           'free_grant', 0,
           'monthly_grant', 0,
           'plans', jsonb_build_object(
             'free', jsonb_build_object(
               'transcribe_seconds', 1800,     -- 30 min / month
               'ai_questions', 20,             -- per month
               'summaries_per_day', 10,        -- automatic call summaries (not shown to users)
               'connector_calls', 5            -- Claude connector reads the newest N calls
             ),
             'pro', jsonb_build_object(
               'transcribe_seconds', 36000,    -- 10 h / month
               'ai_questions', 500,
               'summaries_per_day', 100,
               'connector_calls', null         -- all calls
             )
           ),
           'checkout', jsonb_build_object(
             'monthly', jsonb_build_object('name', 'Twilio Dialpad Pro Monthly', 'price_cents', 1900),
             'yearly',  jsonb_build_object('name', 'Twilio Dialpad Pro Yearly',  'price_cents', 18000)
           )
         ),
         false
    from pricing_config
   where version = v_old;

  update pricing_config set active = false where version = v_old;
  update pricing_config set active = true  where version = v_new;
end $$;
