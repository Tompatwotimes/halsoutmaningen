-- ============================================================================
-- pgTAP — Phase 9: bootstrapping default Straffbanken definitions into an
-- ALREADY-ACTIVE challenge (the 20260902090700 mechanism), and reconciling
-- historical streak runs.
--
-- The migration targets a fixed challenge id via a no-JWT `do` block; here we
-- exercise the same mechanism (no-JWT INSERT + per-member reconcile) on a
-- purpose-built active challenge with real history.
-- ============================================================================
begin;
create extension if not exists pgtap;
select plan(8);

set local role postgres;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-0000000009bd', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'b9d@example.test', '{"display_name":"Admin"}', now(), now()),
  ('00000000-0000-0000-0000-00000000090c', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'b90c@example.test', '{"display_name":"Cora"}', now(), now());
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000009bd';

-- An active challenge that has been running for 40 days with NO penalty config.
insert into public.challenges (id, name, start_date, end_date, timezone,
  required_minutes, proof_required, missed_day_cost, status, created_by)
values ('00000000-0000-0000-0000-0000000000b9', 'Redan-igång',
  current_date - 40, current_date + 80, 'Europe/Stockholm', 30, true, 50, 'active',
  '00000000-0000-0000-0000-0000000009bd');

insert into public.challenge_memberships (challenge_id, user_id, participation_start_date, active, created_by)
values ('00000000-0000-0000-0000-0000000000b9', '00000000-0000-0000-0000-00000000090c',
  current_date - 40, true, '00000000-0000-0000-0000-0000000009bd');

-- Cora completed the first 22 days.
do $$ begin
  for i in 0..21 loop
    declare v_id uuid := gen_random_uuid();
    begin
      insert into public.training_entries (id, challenge_id, user_id, challenge_date, session_seq, duration_minutes)
      values (v_id, '00000000-0000-0000-0000-0000000000b9', '00000000-0000-0000-0000-00000000090c',
              (current_date - 40 + i)::date, 1, 35);
      insert into public.training_proofs (training_entry_id, challenge_id, user_id, storage_path, mime_type, size_bytes)
      values (v_id, '00000000-0000-0000-0000-0000000000b9', '00000000-0000-0000-0000-00000000090c',
              format('00000000-0000-0000-0000-0000000000b9/00000000-0000-0000-0000-00000000090c/%s/%s.jpg',
                     (current_date - 40 + i)::date, v_id),
              'image/jpeg', 1000);
    end;
  end loop;
end $$;

-- No definitions yet -> no earned penalties possible.
select is(
  (select count(*)::int from public.earned_penalties
   where challenge_id = '00000000-0000-0000-0000-0000000000b9'),
  0, 'no earned penalties before the bootstrap');

-- The historical day requirement, captured now, must not change afterwards.
create or replace function pg_temp.req(p_date date)
returns int language sql as $$
  select required_minutes from public.challenge_day_states('00000000-0000-0000-0000-0000000000b9')
  where user_id = '00000000-0000-0000-0000-00000000090c' and challenge_date = p_date
$$;
select is(pg_temp.req((current_date - 20)::date), 30, 'a past day requires the base 30 min');

-- ---- BOOTSTRAP (no-JWT session = migration break-glass) -------------------
insert into public.challenge_penalty_definitions
  (challenge_id, unlock_streak, penalty_type, value, display_name, sort_order)
values
  ('00000000-0000-0000-0000-0000000000b9', 20, 'minimum_minutes', 45, '45-minutaren', 1),
  ('00000000-0000-0000-0000-0000000000b9', 40, 'minimum_minutes', 60, '60-minutaren', 2),
  ('00000000-0000-0000-0000-0000000000b9', 60, 'double_session',   2, 'Dubbelpass',   3);

do $$
declare m record;
begin
  for m in select user_id from public.challenge_memberships
           where challenge_id = '00000000-0000-0000-0000-0000000000b9'
  loop
    perform public._reconcile_earned_penalties('00000000-0000-0000-0000-0000000000b9', m.user_id);
  end loop;
end $$;

-- ---- ASSERTIONS ----------------------------------------------------------
select is(
  (select count(*)::int from public.earned_penalties ep
   join public.challenge_penalty_definitions d on d.id = ep.penalty_definition_id
   where d.unlock_streak = 20 and ep.user_id = '00000000-0000-0000-0000-00000000090c'
     and ep.status = 'available'),
  1, 'the historical 22-day run retroactively earns the 20-milestone');
select is(
  (select earned_on_date from public.earned_penalties ep
   join public.challenge_penalty_definitions d on d.id = ep.penalty_definition_id
   where d.unlock_streak = 20 and ep.user_id = '00000000-0000-0000-0000-00000000090c'),
  (current_date - 40 + 19)::date,
  'earned_on_date is the day the milestone was actually reached');
select is(
  (select count(*)::int from public.earned_penalties ep
   join public.challenge_penalty_definitions d on d.id = ep.penalty_definition_id
   where d.unlock_streak = 40 and ep.user_id = '00000000-0000-0000-0000-00000000090c'),
  0, 'the not-yet-reached 40-milestone is NOT earned');
select is(
  (select count(*)::int from public.penalty_assignments
   where challenge_id = '00000000-0000-0000-0000-0000000000b9'),
  0, 'the bootstrap creates NO penalty assignments');
select is(pg_temp.req((current_date - 20)::date), 30,
  'no historical day requirement changed (still base 30)');
select is(
  pg_temp.req(public.challenge_current_date('00000000-0000-0000-0000-0000000000b9')),
  30,
  'the current day requirement is unchanged by the bootstrap (no assignment made)');

select * from finish();
rollback;
