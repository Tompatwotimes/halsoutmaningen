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
