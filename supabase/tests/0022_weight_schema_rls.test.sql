-- ============================================================================
-- pgTAP — Weight Tracking / 0022: weight_profiles / weight_entries /
-- weight_competition_results schema + RLS.
--
--   * domain CHECKs: start-weight coherence, official-final coherence,
--     disclosure coherence, positive weights, one entry per day
--   * widened audit vocabulary accepts 'weight_profile'
--   * RLS hide-my-weight (spec §3/§4): a hidden participant's weight_profiles
--     AND weight_entries rows are ABSENT (not masked) from a co-member's query;
--     the owner and an admin always see them; toggling hidden off makes the
--     same historical rows visible again with no data migration
--   * no role may INSERT / UPDATE / DELETE any of the three tables directly
--   * weight_competition_results: a co-member may read the row while the winner
--     is not hidden, or once disclosed; while the winner is HIDDEN and
--     undisclosed the row is ABSENT to a co-member (identity + percentage are
--     only ever reachable through weight_final_result's field gate). The winner
--     themselves and an admin can always read it directly.
-- ============================================================================
begin;
create extension if not exists pgtap;
select plan(36);

set local role postgres;

-- ---- fixtures ----------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-0000000a1001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'w-1001@example.test', '{"display_name":"Admin"}', now(), now()),
  ('00000000-0000-0000-0000-0000000a1002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'w-1002@example.test', '{"display_name":"Pia"}', now(), now()),
  ('00000000-0000-0000-0000-0000000a1003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'w-1003@example.test', '{"display_name":"Ove"}', now(), now()),
  ('00000000-0000-0000-0000-0000000a1004', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'w-1004@example.test', '{"display_name":"Rex"}', now(), now());
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000a1001';

insert into public.challenges (id, name, start_date, end_date, timezone,
  required_minutes, proof_required, missed_day_cost, status, created_by)
values
  ('00000000-0000-0000-0000-0000000acf01', 'Weight-A', current_date - 10, current_date + 20,
   'Europe/Stockholm', 30, true, 50, 'active', '00000000-0000-0000-0000-0000000a1001'),
  ('00000000-0000-0000-0000-0000000acf02', 'Weight-B', current_date - 10, current_date + 20,
   'Europe/Stockholm', 30, true, 50, 'active', '00000000-0000-0000-0000-0000000a1001');

-- Pia and Rex are members of Weight-A. Ove is a member of nothing.
insert into public.challenge_memberships (challenge_id, user_id, participation_start_date, active, created_by)
values
  ('00000000-0000-0000-0000-0000000acf01', '00000000-0000-0000-0000-0000000a1002', current_date - 10, true, '00000000-0000-0000-0000-0000000a1001'),
  ('00000000-0000-0000-0000-0000000acf01', '00000000-0000-0000-0000-0000000a1004', current_date - 10, true, '00000000-0000-0000-0000-0000000a1001');

-- ========================================================================
-- Section A — domain constraints (as postgres, RLS bypassed)
-- ========================================================================
select throws_ok(
  $$insert into public.weight_profiles (challenge_id, user_id, start_weight_kg)
    values ('00000000-0000-0000-0000-0000000acf01', '00000000-0000-0000-0000-0000000a1002', 80)$$,
  null, null, 'start_weight_kg without first_saved_at/locked_at is rejected');

select throws_ok(
  $$insert into public.weight_profiles (challenge_id, user_id, start_weight_kg, start_weight_first_saved_at)
    values ('00000000-0000-0000-0000-0000000acf01', '00000000-0000-0000-0000-0000000a1002', 80, now())$$,
  null, null, 'first_saved_at without locked_at is rejected');

select lives_ok(
  $$insert into public.weight_profiles (challenge_id, user_id)
    values ('00000000-0000-0000-0000-0000000acf01', '00000000-0000-0000-0000-0000000a1002')$$,
  'an all-null weight_profiles row is accepted (holds is_weight_hidden before any weight)');

select lives_ok(
  $$insert into public.weight_profiles (challenge_id, user_id, start_weight_kg,
      start_weight_first_saved_at, start_weight_locked_at)
    values ('00000000-0000-0000-0000-0000000acf01', '00000000-0000-0000-0000-0000000a1004',
            82.0, now() - interval '2 days', now() - interval '1 day')$$,
  'a coherent start-weight row (all three set) is accepted');

select throws_ok(
  $$update public.weight_profiles set official_final_weight_kg = 78
    where challenge_id = '00000000-0000-0000-0000-0000000acf01'
      and user_id = '00000000-0000-0000-0000-0000000a1004'$$,
  null, null, 'official_final_weight_kg without recorded_at/by is rejected');

select throws_ok(
  $$insert into public.weight_profiles (challenge_id, user_id, start_weight_kg,
      start_weight_first_saved_at, start_weight_locked_at)
    values ('00000000-0000-0000-0000-0000000acf02', '00000000-0000-0000-0000-0000000a1002', 0, now(), now())$$,
  null, null, 'a non-positive start_weight_kg is rejected');

select throws_ok(
  $$insert into public.weight_entries (challenge_id, user_id, entry_date, weight_kg)
    values ('00000000-0000-0000-0000-0000000acf01', '00000000-0000-0000-0000-0000000a1002', current_date, 0)$$,
  null, null, 'a non-positive weight_entries.weight_kg is rejected');

insert into public.weight_entries (challenge_id, user_id, entry_date, weight_kg)
values ('00000000-0000-0000-0000-0000000acf01', '00000000-0000-0000-0000-0000000a1002', current_date, 79.5);
select throws_ok(
  $$insert into public.weight_entries (challenge_id, user_id, entry_date, weight_kg)
    values ('00000000-0000-0000-0000-0000000acf01', '00000000-0000-0000-0000-0000000a1002', current_date, 79.6)$$,
  null, null, 'a second weight_entries row for the same (challenge,user,date) is rejected');

select throws_ok(
  $$insert into public.weight_competition_results (challenge_id, disclosed_at)
    values ('00000000-0000-0000-0000-0000000acf01', now())$$,
  null, null, 'disclosed_at without disclosed_by is rejected');

select lives_ok(
  $$insert into public.audit_log (actor_user_id, entity_type, action)
    values ('00000000-0000-0000-0000-0000000a1001', 'weight_profile', 'start_weight_corrected')$$,
  'the audit vocabulary now accepts weight_profile');

-- ---- more fixtures for the RLS sections ------------------------------
-- Pia: coherent locked start weight + two entries. Rex: locked start weight
-- (from Section A) + one entry.
update public.weight_profiles
  set start_weight_kg = 80.0,
      start_weight_first_saved_at = now() - interval '3 days',
      start_weight_locked_at = now() - interval '2 days'
  where challenge_id = '00000000-0000-0000-0000-0000000acf01'
    and user_id = '00000000-0000-0000-0000-0000000a1002';
insert into public.weight_entries (challenge_id, user_id, entry_date, weight_kg)
values ('00000000-0000-0000-0000-0000000acf01', '00000000-0000-0000-0000-0000000a1002', current_date - 1, 79.8),
       ('00000000-0000-0000-0000-0000000acf01', '00000000-0000-0000-0000-0000000a1004', current_date, 81.2);
insert into public.weight_competition_results (challenge_id, winner_user_id, winner_percentage_change, determined_by)
values ('00000000-0000-0000-0000-0000000acf01', '00000000-0000-0000-0000-0000000a1004', -1.0,
        '00000000-0000-0000-0000-0000000a1001');

-- ========================================================================
-- Section B — RLS as Pia (member of Weight-A, nobody hidden yet)
-- ========================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000a1002","role":"authenticated"}', true);

select is(
  (select count(*)::int from public.weight_profiles
   where challenge_id = '00000000-0000-0000-0000-0000000acf01'),
  2, 'a member sees every non-hidden weight_profiles row in their challenge');
select is(
  (select count(*)::int from public.weight_entries
   where challenge_id = '00000000-0000-0000-0000-0000000acf01'),
  3, 'a member sees every non-hidden weight_entries row in their challenge');
select ok(
  exists (select 1 from public.weight_competition_results
          where challenge_id = '00000000-0000-0000-0000-0000000acf01'),
  'a member can see that a weight_competition_results row exists');

-- ========================================================================
-- Section C — hide Rex (direct update as postgres; set_weight_hidden is Task 5)
-- ========================================================================
set local role postgres;
update public.weight_profiles set is_weight_hidden = true
  where challenge_id = '00000000-0000-0000-0000-0000000acf01'
    and user_id = '00000000-0000-0000-0000-0000000a1004';

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000a1002","role":"authenticated"}', true);

select is(
  (select count(*)::int from public.weight_profiles
   where challenge_id = '00000000-0000-0000-0000-0000000acf01'
     and user_id = '00000000-0000-0000-0000-0000000a1004'),
  0, 'a co-member cannot see a HIDDEN participant''s weight_profiles row at all');
select is(
  (select count(*)::int from public.weight_entries
   where challenge_id = '00000000-0000-0000-0000-0000000acf01'
     and user_id = '00000000-0000-0000-0000-0000000a1004'),
  0, 'a co-member cannot see a HIDDEN participant''s weight_entries rows at all');
select is(
  (select count(*)::int from public.weight_profiles
   where challenge_id = '00000000-0000-0000-0000-0000000acf01'),
  1, 'the co-member still sees their own (non-hidden) weight_profiles row');

-- The competition winner (a1004) is now hidden and NOT disclosed. A co-member
-- must not be able to learn the winner's identity / percentage through a raw
-- select on weight_competition_results — the row itself is absent to them
-- (weight_final_result is the only sanctioned surface, and it field-gates).
select is(
  (select count(*)::int from public.weight_competition_results
   where challenge_id = '00000000-0000-0000-0000-0000000acf01'),
  0, 'a co-member cannot directly read the competition row while the winner is hidden and undisclosed');

-- Rex (the hidden owner) still sees their own data unconditionally.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000a1004","role":"authenticated"}', true);
select is(
  (select start_weight_kg from public.weight_profiles
   where challenge_id = '00000000-0000-0000-0000-0000000acf01'
     and user_id = '00000000-0000-0000-0000-0000000a1004'),
  82.0, 'the hidden participant still sees their OWN weight_profiles row');
select is(
  (select count(*)::int from public.weight_entries
   where user_id = '00000000-0000-0000-0000-0000000a1004'),
  1, 'the hidden participant still sees their OWN weight_entries');
-- ...including the competition row where they are the (still hidden) winner.
select is(
  (select winner_user_id from public.weight_competition_results
   where challenge_id = '00000000-0000-0000-0000-0000000acf01'),
  '00000000-0000-0000-0000-0000000a1004'::uuid,
  'the winner themselves can always directly read their own competition row');

-- Admin still sees the hidden participant's data.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000a1001","role":"authenticated"}', true);
select is(
  (select start_weight_kg from public.weight_profiles
   where user_id = '00000000-0000-0000-0000-0000000a1004'),
  82.0, 'an admin always sees a hidden participant''s weight_profiles row');
select is(
  (select count(*)::int from public.weight_entries
   where user_id = '00000000-0000-0000-0000-0000000a1004'),
  1, 'an admin always sees a hidden participant''s weight_entries');
select is(
  (select winner_user_id from public.weight_competition_results
   where challenge_id = '00000000-0000-0000-0000-0000000acf01'),
  '00000000-0000-0000-0000-0000000a1004'::uuid,
  'an admin can always directly read the competition row (oversight preserved)');

-- ========================================================================
-- Section D — retroactive: toggle hidden OFF, prior rows visible again
-- ========================================================================
set local role postgres;
update public.weight_profiles set is_weight_hidden = false
  where challenge_id = '00000000-0000-0000-0000-0000000acf01'
    and user_id = '00000000-0000-0000-0000-0000000a1004';

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000a1002","role":"authenticated"}', true);
select is(
  (select start_weight_kg from public.weight_profiles
   where user_id = '00000000-0000-0000-0000-0000000a1004'),
  82.0, 'un-hiding makes the prior weight_profiles row visible to a co-member again (no data migration)');
select is(
  (select weight_kg from public.weight_entries
   where user_id = '00000000-0000-0000-0000-0000000a1004'),
  81.2, 'un-hiding makes the prior weight_entries visible again with identical values');
select is(
  (select winner_user_id from public.weight_competition_results
   where challenge_id = '00000000-0000-0000-0000-0000000acf01'),
  '00000000-0000-0000-0000-0000000a1004'::uuid,
  'un-hiding the winner makes the competition row directly visible to a co-member again');

-- ========================================================================
-- Section E — a non-member sees nothing
-- ========================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000a1003","role":"authenticated"}', true);
select is((select count(*)::int from public.weight_profiles), 0,
  'a non-member reads no weight_profiles at all');
select is((select count(*)::int from public.weight_entries), 0,
  'a non-member reads no weight_entries at all');
select is((select count(*)::int from public.weight_competition_results), 0,
  'a non-member reads no weight_competition_results at all');

-- ========================================================================
-- Section F — no direct writes to any of the three tables
-- ========================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000a1002","role":"authenticated"}', true);

select throws_ok(
  $$insert into public.weight_profiles (challenge_id, user_id, is_weight_hidden)
    values ('00000000-0000-0000-0000-0000000acf01', '00000000-0000-0000-0000-0000000a1002', true)$$,
  null, null, 'a participant cannot INSERT weight_profiles directly');
select throws_ok(
  $$update public.weight_profiles set start_weight_kg = 60
    where user_id = '00000000-0000-0000-0000-0000000a1002'$$,
  null, null, 'a participant cannot UPDATE weight_profiles directly');
select throws_ok(
  $$delete from public.weight_profiles where user_id = '00000000-0000-0000-0000-0000000a1002'$$,
  null, null, 'a participant cannot DELETE weight_profiles directly');
select throws_ok(
  $$insert into public.weight_entries (challenge_id, user_id, entry_date, weight_kg)
    values ('00000000-0000-0000-0000-0000000acf01', '00000000-0000-0000-0000-0000000a1002', current_date - 5, 77)$$,
  null, null, 'a participant cannot INSERT weight_entries directly (would be backdating)');
select throws_ok(
  $$update public.weight_entries set weight_kg = 60
    where user_id = '00000000-0000-0000-0000-0000000a1002'$$,
  null, null, 'a participant cannot UPDATE weight_entries directly');
select throws_ok(
  $$insert into public.weight_competition_results (challenge_id, winner_user_id)
    values ('00000000-0000-0000-0000-0000000acf02', '00000000-0000-0000-0000-0000000a1002')$$,
  null, null, 'a participant cannot INSERT weight_competition_results directly');
select throws_ok(
  $$update public.weight_competition_results set disclosed_at = now(), disclosed_by = '00000000-0000-0000-0000-0000000a1002'
    where challenge_id = '00000000-0000-0000-0000-0000000acf01'$$,
  null, null, 'a participant cannot UPDATE weight_competition_results directly (self-disclose)');

select * from finish();
rollback;
