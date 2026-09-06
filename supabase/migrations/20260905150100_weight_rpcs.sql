-- ============================================================================
-- Hälsoutmaningen — Weight Tracking / Viktkampen / RPCs
--
-- Spec: docs/superpowers/specs/2026-09-05-weight-tracking-design.md §2, §3
-- Plan: docs/superpowers/plans/2026-09-05-weight-tracking-implementation.md (Tasks 3–6)
--
-- Depends on 20260905150000_weight_schema.sql. Forward-only. Every write RPC:
-- SECURITY DEFINER, language plpgsql, set search_path = '', schema-qualified,
-- EXECUTE revoked from public/anon and granted to authenticated — the same
-- convention as 20260905140100_chat_rpcs.sql /
-- 20260904100100_retroactive_registration_rpcs.sql. The two read models
-- (weight_public_ranking, weight_final_result) are SECURITY INVOKER so they
-- cannot bypass the hide-my-weight RLS (spec §2.8 / §3 / §4).
--
--   set_start_weight(challenge, kg)                participant, once + 24h window
--   correct_start_weight(challenge, user, kg, reason)  admin, value only, audited
--   log_weight_entry(challenge, kg)               participant, today only (Task 4)
--   set_weight_hidden(challenge, hidden)          participant (Task 5)
--   weight_public_ranking(challenge)              read model, invoker (Task 5)
--   set_official_final_weight(challenge, user, kg, reason)  admin, audited (Task 6)
--   finalize_weight_competition(challenge)        admin, never consults hidden (Task 6)
--   disclose_weight_winner(challenge)             admin (Task 6)
--   weight_final_result(challenge)                read model, invoker (Task 6)
--
-- Weight tracking never touches training / day state / streak / liability /
-- KASSAN / training ranking / Straffbanken / retroactive registration.
-- ============================================================================

-- Sane physical ceiling for a human body weight in kg. Not a design decision —
-- an implementation guard against fat-fingered input (spec §2.1).
-- (Inlined per-function rather than a shared constant to keep each RPC
-- self-contained.)

-- ----------------------------------------------------------------------------
-- set_start_weight  (participant — first save + 24h edit window, then locked)
-- ----------------------------------------------------------------------------
create or replace function public.set_start_weight(
  p_challenge_id uuid,
  p_weight_kg    numeric
)
returns public.weight_profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid   uuid := (select auth.uid());
  v_row public.weight_profiles;
begin
  if uid is null then
    raise exception 'Du måste vara inloggad';
  end if;

  if not exists (
    select 1 from public.challenge_memberships m
    where m.challenge_id = p_challenge_id and m.user_id = uid and m.active
  ) then
    raise exception 'Du är inte aktiv deltagare i den här utmaningen';
  end if;

  if p_weight_kg is null or p_weight_kg <= 0 or p_weight_kg > 400 then
    raise exception 'Ogiltig vikt';
  end if;

  select * into v_row from public.weight_profiles
    where challenge_id = p_challenge_id and user_id = uid
    for update;

  -- After the 24h window: participant cannot self-correct.
  if v_row.start_weight_first_saved_at is not null
     and now() >= v_row.start_weight_locked_at then
    raise exception
      'Din startvikt är låst — be en administratör rätta den om det behövs.';
  end if;

  if v_row.challenge_id is null then
    -- No row at all — first save.
    insert into public.weight_profiles (challenge_id, user_id, start_weight_kg,
      start_weight_first_saved_at, start_weight_locked_at)
    values (p_challenge_id, uid, p_weight_kg, now(), now() + interval '24 hours')
    returning * into v_row;
  elsif v_row.start_weight_first_saved_at is null then
    -- Row exists (e.g. created by set_weight_hidden) but no start weight yet —
    -- this is still the FIRST save: set both timestamps now, once.
    update public.weight_profiles
      set start_weight_kg = p_weight_kg,
          start_weight_first_saved_at = now(),
          start_weight_locked_at = now() + interval '24 hours'
    where challenge_id = p_challenge_id and user_id = uid
    returning * into v_row;
  else
    -- Inside the 24h window — change the VALUE only, never the timestamps.
    update public.weight_profiles
      set start_weight_kg = p_weight_kg
    where challenge_id = p_challenge_id and user_id = uid
    returning * into v_row;
  end if;

  return v_row;
end;
$$;

comment on function public.set_start_weight(uuid, numeric) is
  'Participant sets/edits their own start weight. First call sets '
  'start_weight_first_saved_at = now() and start_weight_locked_at = now() + '
  '24h. Further calls inside the window change the value only; after the '
  'window they are rejected (ask an admin). The timestamps are set exactly '
  'once and never move.';

revoke all on function public.set_start_weight(uuid, numeric) from public, anon;
grant execute on function public.set_start_weight(uuid, numeric) to authenticated;

-- ----------------------------------------------------------------------------
-- correct_start_weight  (admin — value only, never the lock timestamps, audited)
-- ----------------------------------------------------------------------------
create or replace function public.correct_start_weight(
  p_challenge_id uuid,
  p_user_id      uuid,
  p_weight_kg    numeric,
  p_reason       text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid      uuid := (select auth.uid());
  v_row    public.weight_profiles;
  v_before numeric;
begin
  if not ((uid is null) or public.is_admin()) then
    raise exception 'Endast administratörer får rätta en startvikt';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Ange en anledning';
  end if;
  if p_weight_kg is null or p_weight_kg <= 0 or p_weight_kg > 400 then
    raise exception 'Ogiltig vikt';
  end if;

  select * into v_row from public.weight_profiles
    where challenge_id = p_challenge_id and user_id = p_user_id
    for update;
  v_before := v_row.start_weight_kg;

  -- Value only. On an existing row the ON CONFLICT branch touches nothing but
  -- start_weight_kg, so start_weight_first_saved_at / start_weight_locked_at
  -- stay byte-identical. On a brand-new row (admin sets a start weight from
  -- nothing) the coherence constraint requires all three, so the timestamps
  -- are seeded to now()/now()+24h — this is the only path that ever writes
  -- them here, and only when there was nothing to preserve.
  insert into public.weight_profiles (challenge_id, user_id, start_weight_kg,
    start_weight_first_saved_at, start_weight_locked_at)
  values (p_challenge_id, p_user_id, p_weight_kg,
    coalesce(v_row.start_weight_first_saved_at, now()),
    coalesce(v_row.start_weight_locked_at, now() + interval '24 hours'))
  on conflict (challenge_id, user_id) do update
    set start_weight_kg = excluded.start_weight_kg;

  insert into public.audit_log
    (actor_user_id, challenge_id, target_user_id, entity_type, entity_id,
     action, before_data, after_data, note)
  values (
    uid, p_challenge_id, p_user_id, 'weight_profile', p_user_id,
    'start_weight_corrected',
    jsonb_build_object('start_weight_kg', v_before),
    jsonb_build_object('start_weight_kg', p_weight_kg),
    btrim(p_reason)
  );
end;
$$;

comment on function public.correct_start_weight(uuid, uuid, numeric, text) is
  'Admin corrects a (usually locked) start weight. Changes start_weight_kg '
  'ONLY — start_weight_first_saved_at / start_weight_locked_at remain the '
  'historical facts of the participant''s own first save. Mandatory reason, '
  'exactly one audit_log row (entity_type=weight_profile, before/after value).';

revoke all on function public.correct_start_weight(uuid, uuid, numeric, text) from public, anon;
grant execute on function public.correct_start_weight(uuid, uuid, numeric, text) to authenticated;

-- ----------------------------------------------------------------------------
-- log_weight_entry  (participant — today only, no date parameter to backdate)
-- ----------------------------------------------------------------------------
create or replace function public.log_weight_entry(
  p_challenge_id uuid,
  p_weight_kg    numeric
)
returns public.weight_entries
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid    uuid := (select auth.uid());
  v_date date;
  v_row  public.weight_entries;
begin
  if uid is null then
    raise exception 'Du måste vara inloggad';
  end if;

  if not exists (
    select 1 from public.challenge_memberships m
    where m.challenge_id = p_challenge_id and m.user_id = uid and m.active
  ) then
    raise exception 'Du är inte aktiv deltagare i den här utmaningen';
  end if;

  if p_weight_kg is null or p_weight_kg <= 0 or p_weight_kg > 400 then
    raise exception 'Ogiltig vikt';
  end if;

  -- The ONLY date this RPC can ever write is the challenge-local current date.
  -- There is no parameter for a caller to supply another one — backdating is
  -- structurally impossible, not merely checked (spec §2.3).
  v_date := public.challenge_current_date(p_challenge_id);
  if v_date is null then
    raise exception 'Utmaningen finns inte';
  end if;

  insert into public.weight_entries (challenge_id, user_id, entry_date, weight_kg)
  values (p_challenge_id, uid, v_date, p_weight_kg)
  on conflict (challenge_id, user_id, entry_date) do update
    set weight_kg = excluded.weight_kg
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.log_weight_entry(uuid, numeric) is
  'Participant logs today''s regular weight. Optional, no proof, no training '
  'dependency. Always targets challenge_current_date(challenge_id) — there is '
  'no date parameter, so backdating is impossible. One row per '
  '(challenge, user, day), editable in place while it is still that day; once '
  'the challenge day rolls over the row is unreachable by this RPC.';

revoke all on function public.log_weight_entry(uuid, numeric) from public, anon;
grant execute on function public.log_weight_entry(uuid, numeric) to authenticated;

-- ----------------------------------------------------------------------------
-- set_weight_hidden  (participant — the privacy toggle, works before any weight)
-- ----------------------------------------------------------------------------
create or replace function public.set_weight_hidden(
  p_challenge_id uuid,
  p_hidden       boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then
    raise exception 'Du måste vara inloggad';
  end if;
  if not exists (
    select 1 from public.challenge_memberships m
    where m.challenge_id = p_challenge_id and m.user_id = uid and m.active
  ) then
    raise exception 'Du är inte aktiv deltagare i den här utmaningen';
  end if;

  -- Creates the weight_profiles row on the first toggle if nothing else has —
  -- every other column stays null. This is how "the toggle must work even
  -- before a start weight exists" is satisfied (spec §2.4 / §4).
  insert into public.weight_profiles (challenge_id, user_id, is_weight_hidden)
  values (p_challenge_id, uid, coalesce(p_hidden, false))
  on conflict (challenge_id, user_id) do update
    set is_weight_hidden = excluded.is_weight_hidden;
end;
$$;

comment on function public.set_weight_hidden(uuid, boolean) is
  '"Dölj min vikt" toggle. Retroactive by construction — visibility is computed '
  'live from is_weight_hidden on every read (the RLS policies in the schema '
  'migration are the single enforcement point), so flipping it immediately '
  'changes what every co-member query returns, and flipping it back restores '
  'the same historical rows with no data migration.';

revoke all on function public.set_weight_hidden(uuid, boolean) from public, anon;
grant execute on function public.set_weight_hidden(uuid, boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- weight_public_ranking  (read model — SECURITY INVOKER, RLS does the hiding)
-- ----------------------------------------------------------------------------
-- Mirrors public.challenge_results' shape: security INVOKER, set search_path='',
-- a plain query. Because it runs as the caller, a hidden participant's
-- weight_profiles / weight_entries rows are simply invisible to it via RLS
-- (spec §4) — there is NO `where not is_weight_hidden` here on purpose; adding
-- one would be a second enforcement point to keep in sync. Eligibility:
-- a locked start weight exists AND at least one weight_entries row exists.
create or replace function public.weight_public_ranking(p_challenge_id uuid)
returns table (
  user_id           uuid,
  display_name      text,
  start_weight_kg   numeric,
  latest_weight_kg  numeric,
  latest_entry_date date,
  kg_change         numeric,
  percentage_change numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with latest as (
    select distinct on (we.user_id)
      we.user_id,
      we.weight_kg  as latest_weight_kg,
      we.entry_date as latest_entry_date
    from public.weight_entries we
    where we.challenge_id = p_challenge_id
    order by we.user_id, we.entry_date desc, we.created_at desc
  )
  select
    wp.user_id,
    p.display_name,
    wp.start_weight_kg,
    l.latest_weight_kg,
    l.latest_entry_date,
    round(l.latest_weight_kg - wp.start_weight_kg, 2)                                 as kg_change,
    round((l.latest_weight_kg - wp.start_weight_kg) / wp.start_weight_kg * 100, 2)    as percentage_change
  from public.weight_profiles wp
  join latest         l on l.user_id = wp.user_id
  join public.profiles p on p.id = wp.user_id
  where wp.challenge_id = p_challenge_id
    and wp.start_weight_locked_at is not null
  -- most weight lost first; unrounded for a precise order, ties by name.
  order by (l.latest_weight_kg - wp.start_weight_kg) / wp.start_weight_kg asc,
           p.display_name asc;
$$;

comment on function public.weight_public_ranking(uuid) is
  'Public live Viktkampen ranking. SECURITY INVOKER — a hidden participant is '
  'absent because RLS hides their rows from the caller, not because of any '
  'filter in this function. Rows: locked start weight present + >=1 weight '
  'entry. percentage_change = (latest - start)/start*100 (spec §7), rounded to '
  '2 dp for display; ordering uses full precision.';

revoke all on function public.weight_public_ranking(uuid) from public, anon;
grant execute on function public.weight_public_ranking(uuid) to authenticated;
