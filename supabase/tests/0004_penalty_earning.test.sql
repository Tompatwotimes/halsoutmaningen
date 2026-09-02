-- ============================================================================
-- pgTAP — Phase 9: streak-run milestone earning (server-authoritative, idempotent).
--
-- Covers migrations 0007–0009: reconcile_earned_penalties, streak-run identity,
-- idempotent granting, revoke-on-correction, new-run re-earn.
-- ============================================================================
begin;
create extension if not exists pgtap;
select plan(11);

set local role postgres;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-00000000e401', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'e401@example.test', '{"display_name":"Ella"}', now(), now()),
  ('00000000-0000-0000-0000-00000000e4ad', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'e4ad@example.test', '{"display_name":"Admin"}', now(), now());
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-00000000e4ad';

insert into public.challenges (id, name, start_date, end_date, timezone,
  required_minutes, proof_required, missed_day_cost, status, created_by)
values ('00000000-0000-0000-0000-0000000000e4', 'Earn-test',
  current_date - 120, current_date + 60, 'Europe/Stockholm',
  30, true, 50, 'active', '00000000-0000-0000-0000-00000000e4ad');

insert into public.challenge_memberships (challenge_id, user_id, participation_start_date, active, created_by)
values ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-00000000e401',
  current_date - 120, true, '00000000-0000-0000-0000-00000000e4ad');

insert into public.challenge_penalty_definitions
  (challenge_id, unlock_streak, penalty_type, value, display_name, sort_order)
values
  ('00000000-0000-0000-0000-0000000000e4', 20, 'minimum_minutes', 45, '45-minutaren', 1),
  ('00000000-0000-0000-0000-0000000000e4', 40, 'minimum_minutes', 60, '60-minutaren', 2);

create or replace function pg_temp.complete_day(p_date date)
returns void language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into public.training_entries (id, challenge_id, user_id, challenge_date, session_seq, duration_minutes)
  values (v_id, '00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-00000000e401', p_date, 1, 35);
  insert into public.training_proofs (training_entry_id, challenge_id, user_id, storage_path, mime_type, size_bytes)
  values (v_id, '00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-00000000e401',
          format('00000000-0000-0000-0000-0000000000e4/00000000-0000-0000-0000-00000000e401/%s/%s.jpg', p_date, v_id),
          'image/jpeg', 1000);
end;
$$;

create or replace function pg_temp.earned(p_streak int)
returns int language sql as $$
  select count(*)::int from public.earned_penalties ep
  join public.challenge_penalty_definitions d on d.id = ep.penalty_definition_id
  where ep.challenge_id = '00000000-0000-0000-0000-0000000000e4'
    and ep.user_id = '00000000-0000-0000-0000-00000000e401'
    and d.unlock_streak = p_streak
    and ep.status = 'available'
$$;

-- 19 consecutive completed days: nothing earned.
do $$ begin
  for i in 0..18 loop
    perform pg_temp.complete_day((current_date - 100 + i)::date);
  end loop;
end $$;
select is(pg_temp.earned(20), 0, '19 completed days earn nothing');

-- Day 20: the 20-milestone is earned exactly once.
select pg_temp.complete_day((current_date - 100 + 19)::date);
select is(pg_temp.earned(20), 1, 'day 20 earns the 20-day milestone');

-- Re-running the reconciler does not double-grant.
select lives_ok(
  $$select public.reconcile_earned_penalties('00000000-0000-0000-0000-0000000000e4',
     '00000000-0000-0000-0000-00000000e401')$$,
  'reconcile is idempotent (no error)');
select is(pg_temp.earned(20), 1, 'reconcile did not create a duplicate');

-- Extend to 40 completed days: the 40-milestone joins it, 20 stays.
do $$ begin
  for i in 20..39 loop
    perform pg_temp.complete_day((current_date - 100 + i)::date);
  end loop;
end $$;
select is(pg_temp.earned(20), 1, 'the 20-milestone is still there at day 40');
select is(pg_temp.earned(40), 1, 'day 40 earns the 40-day milestone');
select is(
  (select streak_run_start from public.earned_penalties ep
   join public.challenge_penalty_definitions d on d.id = ep.penalty_definition_id
   where d.unlock_streak = 40 and ep.user_id = '00000000-0000-0000-0000-00000000e401'),
  (current_date - 100)::date,
  'the 40-milestone records the run start (first completed day)');

-- Break the streak by invalidating a mid-run day: the unused 40-milestone is
-- revoked (its basis is gone); the still-valid 20 survives because the first
-- 20-day sub-run is intact... actually invalidating day 25 shortens the run to
-- 25, which still clears 20 but no longer clears 40.
update public.training_entries
  set status = 'invalidated', invalidated_at = now(),
      invalidated_by = '00000000-0000-0000-0000-00000000e4ad', invalidated_reason = 'test'
where challenge_id = '00000000-0000-0000-0000-0000000000e4'
  and user_id = '00000000-0000-0000-0000-00000000e401'
  and challenge_date = (current_date - 100 + 25)::date;

select is(pg_temp.earned(40), 0, 'invalidating a mid-run day revokes the unused 40-milestone');
select is(pg_temp.earned(20), 1, 'the 20-milestone still holds (first 20 days intact)');

-- A brand-new streak run, 20 days long, earns the 20-milestone AGAIN.
do $$ begin
  for i in 0..19 loop
    perform pg_temp.complete_day((current_date - 40 + i)::date);
  end loop;
end $$;
select is(
  (select count(*)::int from public.earned_penalties ep
   join public.challenge_penalty_definitions d on d.id = ep.penalty_definition_id
   where d.unlock_streak = 20 and ep.user_id = '00000000-0000-0000-0000-00000000e401'
     and ep.status = 'available'),
  2, 'a separate streak run earns the 20-milestone a second time');

select * from finish();
rollback;
