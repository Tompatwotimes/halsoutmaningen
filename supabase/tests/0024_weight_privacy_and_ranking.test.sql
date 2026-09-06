-- ============================================================================
-- pgTAP — Weight Tracking / 0024: set_weight_hidden + weight_public_ranking.
--
--   set_weight_hidden
--     * works with NO prior weight_profiles row (creates one, every other
--       column null) — "must work before a start weight exists"
--     * toggling true -> false restores a co-member's visibility of prior
--       weight_entries with identical values, no data migration
--   weight_public_ranking (SECURITY INVOKER)
--     * excludes a hidden participant entirely — the `not is_weight_hidden`
--       eligibility rule is an EXPLICIT domain predicate in the function, so
--       the exclusion is identical for a co-member and for an admin caller
--       (Section C); the public ranking is never an admin-inspection surface
--     * excludes a participant with no locked start weight
--     * excludes a participant with zero weight_entries
--     * formula: 82.0 -> 78.7 => percentage_change = -4.02 (spec §7 example)
--     * uses the latest entry by entry_date regardless of its age
--     * order: most weight lost first
--     * an admin still reads a hidden participant's weight_profiles /
--       weight_entries directly — oversight is not reduced (Section C)
-- ============================================================================
begin;
create extension if not exists pgtap;
select plan(21);

set local role postgres;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-0000000c1001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'wp-1001@example.test', '{"display_name":"Admin"}', now(), now()),
  ('00000000-0000-0000-0000-0000000c1002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'wp-1002@example.test', '{"display_name":"Pia"}', now(), now()),
  ('00000000-0000-0000-0000-0000000c1003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'wp-1003@example.test', '{"display_name":"Rex"}', now(), now()),
  ('00000000-0000-0000-0000-0000000c1004', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'wp-1004@example.test', '{"display_name":"Max"}', now(), now()),
  ('00000000-0000-0000-0000-0000000c1005', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'wp-1005@example.test', '{"display_name":"Nils"}', now(), now()),
  ('00000000-0000-0000-0000-0000000c1006', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'wp-1006@example.test', '{"display_name":"Lena"}', now(), now()),
  ('00000000-0000-0000-0000-0000000c1007', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'wp-1007@example.test', '{"display_name":"Sven"}', now(), now());
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000c1001';

insert into public.challenges (id, name, start_date, end_date, timezone,
  required_minutes, proof_required, missed_day_cost, status, created_by)
values ('00000000-0000-0000-0000-0000000ccf01', 'Weight-Privacy', current_date - 40, current_date + 20,
  'Europe/Stockholm', 30, true, 50, 'active', '00000000-0000-0000-0000-0000000c1001');

-- Pia, Rex, Max, Nils, Lena, Sven are members. Nobody else.
insert into public.challenge_memberships (challenge_id, user_id, participation_start_date, active, created_by)
select '00000000-0000-0000-0000-0000000ccf01', u, current_date - 40, true, '00000000-0000-0000-0000-0000000c1001'
from unnest(array[
  '00000000-0000-0000-0000-0000000c1002'::uuid, '00000000-0000-0000-0000-0000000c1003'::uuid,
  '00000000-0000-0000-0000-0000000c1004'::uuid, '00000000-0000-0000-0000-0000000c1005'::uuid,
  '00000000-0000-0000-0000-0000000c1006'::uuid, '00000000-0000-0000-0000-0000000c1007'::uuid
]) as u;

-- ---- weight fixtures -------------------------------------------------
-- Pia:  locked start 82.0, latest entry 78.7  -> -4.02%  (in the ranking)
-- Rex:  locked start 100.0, latest 95.0, HIDDEN                (excluded)
-- Max:  hide-flag-only row (no start weight), has an entry     (excluded)
-- Nils: NO weight_profiles row at all           (set_weight_hidden test)
-- Lena: locked start 90.0, one entry 30 days ago 87.0  -> -3.33% (in the ranking)
-- Sven: locked start 85.0, ZERO entries                       (excluded)
insert into public.weight_profiles (challenge_id, user_id, start_weight_kg,
  start_weight_first_saved_at, start_weight_locked_at, is_weight_hidden)
values
  ('00000000-0000-0000-0000-0000000ccf01', '00000000-0000-0000-0000-0000000c1002', 82.0, now() - interval '3 days', now() - interval '2 days', false),
  ('00000000-0000-0000-0000-0000000ccf01', '00000000-0000-0000-0000-0000000c1003', 100.0, now() - interval '3 days', now() - interval '2 days', true),
  ('00000000-0000-0000-0000-0000000ccf01', '00000000-0000-0000-0000-0000000c1006', 90.0, now() - interval '3 days', now() - interval '2 days', false),
  ('00000000-0000-0000-0000-0000000ccf01', '00000000-0000-0000-0000-0000000c1007', 85.0, now() - interval '3 days', now() - interval '2 days', false);
insert into public.weight_profiles (challenge_id, user_id, is_weight_hidden)
values ('00000000-0000-0000-0000-0000000ccf01', '00000000-0000-0000-0000-0000000c1004', false);

insert into public.weight_entries (challenge_id, user_id, entry_date, weight_kg)
values
  ('00000000-0000-0000-0000-0000000ccf01', '00000000-0000-0000-0000-0000000c1002', current_date, 78.7),
  ('00000000-0000-0000-0000-0000000ccf01', '00000000-0000-0000-0000-0000000c1003', current_date, 95.0),
  ('00000000-0000-0000-0000-0000000ccf01', '00000000-0000-0000-0000-0000000c1004', current_date, 80.0),
  ('00000000-0000-0000-0000-0000000ccf01', '00000000-0000-0000-0000-0000000c1006', current_date - 30, 87.0);

-- ========================================================================
-- Section A — set_weight_hidden
-- ========================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000c1005","role":"authenticated"}', true);

select lives_ok(
  $$select public.set_weight_hidden('00000000-0000-0000-0000-0000000ccf01'::uuid, true)$$,
  'set_weight_hidden works for a participant with NO prior weight_profiles row');

set local role postgres;
select is(
  (select is_weight_hidden from public.weight_profiles where user_id = '00000000-0000-0000-0000-0000000c1005'),
  true, 'the row was created with is_weight_hidden = true');
select ok(
  (select start_weight_kg is null and start_weight_first_saved_at is null
      and start_weight_locked_at is null and official_final_weight_kg is null
   from public.weight_profiles where user_id = '00000000-0000-0000-0000-0000000c1005'),
  'and every other column is null (created purely to hold the flag)');

-- toggle round-trip on a participant WITH data (Lena)
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000c1006","role":"authenticated"}', true);
select lives_ok(
  $$select public.set_weight_hidden('00000000-0000-0000-0000-0000000ccf01'::uuid, true)$$,
  'Lena hides her weight');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000c1002","role":"authenticated"}', true);
select is(
  (select count(*)::int from public.weight_entries where user_id = '00000000-0000-0000-0000-0000000c1006'),
  0, 'a co-member sees NONE of Lena''s weight_entries while she is hidden');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000c1006","role":"authenticated"}', true);
select lives_ok(
  $$select public.set_weight_hidden('00000000-0000-0000-0000-0000000ccf01'::uuid, false)$$,
  'Lena un-hides her weight');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000c1002","role":"authenticated"}', true);
select is(
  (select weight_kg from public.weight_entries where user_id = '00000000-0000-0000-0000-0000000c1006'),
  87.0::numeric,
  'un-hiding restores the co-member''s view of the SAME historical row (no data migration)');

-- ========================================================================
-- Section B — weight_public_ranking, called by a co-member (Pia)
-- ========================================================================
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000c1002","role":"authenticated"}', true);

select is(
  (select count(*)::int from public.weight_public_ranking('00000000-0000-0000-0000-0000000ccf01')),
  2, 'the ranking has exactly Pia + Lena (Rex hidden, Max no lock, Nils no row, Sven no entry)');
select ok(
  not exists (select 1 from public.weight_public_ranking('00000000-0000-0000-0000-0000000ccf01')
              where user_id = '00000000-0000-0000-0000-0000000c1003'),
  'a HIDDEN participant is absent from the public ranking for a co-member');
select ok(
  not exists (select 1 from public.weight_public_ranking('00000000-0000-0000-0000-0000000ccf01')
              where user_id = '00000000-0000-0000-0000-0000000c1004'),
  'a participant with no locked start weight is excluded');
select ok(
  not exists (select 1 from public.weight_public_ranking('00000000-0000-0000-0000-0000000ccf01')
              where user_id = '00000000-0000-0000-0000-0000000c1007'),
  'a participant with zero weight_entries is excluded');
select ok(
  not exists (select 1 from public.weight_public_ranking('00000000-0000-0000-0000-0000000ccf01')
              where user_id = '00000000-0000-0000-0000-0000000c1005'),
  'a participant with only a hide-flag row (no locked start weight) is excluded');

select is(
  (select percentage_change from public.weight_public_ranking('00000000-0000-0000-0000-0000000ccf01')
   where user_id = '00000000-0000-0000-0000-0000000c1002'),
  -4.02::numeric, 'percentage_change for 82.0 -> 78.7 is -4.02 (spec §7 example)');
select is(
  (select kg_change from public.weight_public_ranking('00000000-0000-0000-0000-0000000ccf01')
   where user_id = '00000000-0000-0000-0000-0000000c1002'),
  -3.30::numeric, 'kg_change for 82.0 -> 78.7 is -3.30');
select is(
  (select latest_entry_date from public.weight_public_ranking('00000000-0000-0000-0000-0000000ccf01')
   where user_id = '00000000-0000-0000-0000-0000000c1006'),
  (current_date - 30)::date,
  'the latest entry is used regardless of age — Lena''s 30-day-old entry still ranks her');
select is(
  (select percentage_change from public.weight_public_ranking('00000000-0000-0000-0000-0000000ccf01')
   where user_id = '00000000-0000-0000-0000-0000000c1006'),
  -3.33::numeric, 'percentage_change for 90.0 -> 87.0 is -3.33');
select is(
  (select user_id from public.weight_public_ranking('00000000-0000-0000-0000-0000000ccf01') limit 1),
  '00000000-0000-0000-0000-0000000c1002'::uuid,
  'ordering: most weight lost first — Pia (-4.02) ranks above Lena (-3.33)');

-- ========================================================================
-- Section C — the PUBLIC ranking is caller-role-independent: an ADMIN sees
-- the SAME hidden-free ranking (the `not is_weight_hidden` predicate is a
-- domain rule, not left to caller RLS). Admin oversight of hidden data is
-- unchanged — it happens through weight_profiles / weight_entries directly.
-- ========================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000c1001","role":"authenticated"}', true);

select is(
  (select count(*)::int from public.weight_public_ranking('00000000-0000-0000-0000-0000000ccf01')),
  2, 'an ADMIN caller gets the same 2-row ranking — the hidden participant is NOT added back');
select ok(
  not exists (select 1 from public.weight_public_ranking('00000000-0000-0000-0000-0000000ccf01')
              where user_id = '00000000-0000-0000-0000-0000000c1003'),
  'the HIDDEN participant is absent from weight_public_ranking even for an admin');

-- ...but the admin CAN still inspect that participant's hidden weight data
-- through the intended admin-authorized path (the is_admin() RLS clause).
select is(
  (select start_weight_kg from public.weight_profiles
   where challenge_id = '00000000-0000-0000-0000-0000000ccf01'
     and user_id = '00000000-0000-0000-0000-0000000c1003'),
  100.0::numeric,
  'an admin still reads the hidden participant''s start_weight_kg directly from weight_profiles');
select is(
  (select weight_kg from public.weight_entries
   where challenge_id = '00000000-0000-0000-0000-0000000ccf01'
     and user_id = '00000000-0000-0000-0000-0000000c1003'),
  95.0::numeric,
  'an admin still reads the hidden participant''s weight_entries directly — oversight is unchanged');

select * from finish();
rollback;
