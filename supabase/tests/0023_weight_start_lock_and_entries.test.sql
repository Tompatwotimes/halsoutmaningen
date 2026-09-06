-- ============================================================================
-- pgTAP — Weight Tracking / 0023: set_start_weight, correct_start_weight,
-- log_weight_entry (the 24h lock and the no-backdating guarantee).
--
--   set_start_weight
--     * first call sets start_weight_kg + first_saved_at=now() + locked_at
--       = now()+EXACTLY 24h
--     * a second call inside the window changes the value, leaving BOTH
--       timestamps byte-identical
--     * a call after now() >= locked_at is rejected, value unchanged
--     * non-member rejected; the function has no timestamp parameter to forge
--   correct_start_weight
--     * admin-only; empty reason rejected
--     * changes start_weight_kg after lock, leaving first_saved_at/locked_at
--       byte-identical (the case the spec calls out as easy to get wrong)
--     * exactly one audit_log row with the correct before/after and reason
--     * upserts a row for a participant who has none
--   log_weight_entry (added by Task 4)
-- ============================================================================
begin;
create extension if not exists pgtap;
select plan(23);

set local role postgres;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-0000000b1001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'wl-1001@example.test', '{"display_name":"Admin"}', now(), now()),
  ('00000000-0000-0000-0000-0000000b1002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'wl-1002@example.test', '{"display_name":"Pia"}', now(), now()),
  ('00000000-0000-0000-0000-0000000b1003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'wl-1003@example.test', '{"display_name":"Ove"}', now(), now()),
  ('00000000-0000-0000-0000-0000000b1004', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'wl-1004@example.test', '{"display_name":"Rex"}', now(), now()),
  ('00000000-0000-0000-0000-0000000b1005', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'wl-1005@example.test', '{"display_name":"Max"}', now(), now());
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000b1001';

insert into public.challenges (id, name, start_date, end_date, timezone,
  required_minutes, proof_required, missed_day_cost, status, created_by)
values ('00000000-0000-0000-0000-0000000bcf01', 'Weight-Lock', current_date - 10, current_date + 20,
  'Europe/Stockholm', 30, true, 50, 'active', '00000000-0000-0000-0000-0000000b1001');

-- Pia, Rex, Max are members. Ove is a member of nothing.
insert into public.challenge_memberships (challenge_id, user_id, participation_start_date, active, created_by)
values
  ('00000000-0000-0000-0000-0000000bcf01', '00000000-0000-0000-0000-0000000b1002', current_date - 10, true, '00000000-0000-0000-0000-0000000b1001'),
  ('00000000-0000-0000-0000-0000000bcf01', '00000000-0000-0000-0000-0000000b1004', current_date - 10, true, '00000000-0000-0000-0000-0000000b1001'),
  ('00000000-0000-0000-0000-0000000bcf01', '00000000-0000-0000-0000-0000000b1005', current_date - 10, true, '00000000-0000-0000-0000-0000000b1001');

-- Probe table read back under `role authenticated` inside data-modifying CTEs —
-- grant SELECT + INSERT (same pattern as 0017/0019/0020's temp tables).
create temp table probe (label text primary key, kg numeric, first_saved timestamptz, locked timestamptz);
grant select, insert on probe to authenticated;

-- ========================================================================
-- Section A — set_start_weight: first save + the 24h window
-- ========================================================================
select is(
  pg_get_function_arguments('public.set_start_weight(uuid, numeric)'::regprocedure),
  'p_challenge_id uuid, p_weight_kg numeric',
  'set_start_weight takes only a challenge id and a weight — no timestamp to forge');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000b1002","role":"authenticated"}', true);

with r as (select * from public.set_start_weight('00000000-0000-0000-0000-0000000bcf01', 80.0))
insert into probe select 'first', r.start_weight_kg, r.start_weight_first_saved_at, r.start_weight_locked_at from r;

select is((select kg from probe where label = 'first'), 80.0::numeric,
  'first save sets start_weight_kg');
select is(
  extract(epoch from ((select locked from probe where label = 'first')
                    - (select first_saved from probe where label = 'first')))::int,
  86400, 'first save: start_weight_locked_at = start_weight_first_saved_at + EXACTLY 24h');

select lives_ok(
  $$select public.set_start_weight('00000000-0000-0000-0000-0000000bcf01'::uuid, 79.0)$$,
  'a second call inside the 24h window is accepted');

with r as (select * from public.weight_profiles
           where challenge_id = '00000000-0000-0000-0000-0000000bcf01'
             and user_id = '00000000-0000-0000-0000-0000000b1002')
insert into probe select 'second', r.start_weight_kg, r.start_weight_first_saved_at, r.start_weight_locked_at from r;

select is((select kg from probe where label = 'second'), 79.0::numeric,
  'the second call changed the value');
select is((select first_saved from probe where label = 'second'),
          (select first_saved from probe where label = 'first'),
  'start_weight_first_saved_at did NOT move on the in-window edit');
select is((select locked from probe where label = 'second'),
          (select locked from probe where label = 'first'),
  'start_weight_locked_at did NOT move on the in-window edit');

-- ========================================================================
-- Section B — set_start_weight after the lock is rejected
-- ========================================================================
set local role postgres;
insert into public.weight_profiles (challenge_id, user_id, start_weight_kg,
  start_weight_first_saved_at, start_weight_locked_at)
values ('00000000-0000-0000-0000-0000000bcf01', '00000000-0000-0000-0000-0000000b1004',
        90.0, now() - interval '2 days', now() - interval '1 day');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000b1004","role":"authenticated"}', true);
select throws_ok(
  $$select public.set_start_weight('00000000-0000-0000-0000-0000000bcf01'::uuid, 85.0)$$,
  null, null, 'set_start_weight after the 24h lock is rejected');
set local role postgres;
select is(
  (select start_weight_kg from public.weight_profiles where user_id = '00000000-0000-0000-0000-0000000b1004'),
  90.0::numeric, 'and the locked value is unchanged');

-- ========================================================================
-- Section C — non-member / non-admin rejections
-- ========================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000b1003","role":"authenticated"}', true);
select throws_ok(
  $$select public.set_start_weight('00000000-0000-0000-0000-0000000bcf01'::uuid, 80.0)$$,
  null, null, 'a non-member cannot set a start weight');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000b1002","role":"authenticated"}', true);
select throws_ok(
  $$select public.correct_start_weight('00000000-0000-0000-0000-0000000bcf01'::uuid,
      '00000000-0000-0000-0000-0000000b1004'::uuid, 88.0, 'x')$$,
  null, null, 'a non-admin cannot correct a start weight');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000b1001","role":"authenticated"}', true);
select throws_ok(
  $$select public.correct_start_weight('00000000-0000-0000-0000-0000000bcf01'::uuid,
      '00000000-0000-0000-0000-0000000b1004'::uuid, 88.0, '   ')$$,
  null, null, 'correct_start_weight with a whitespace-only reason is rejected');

-- ========================================================================
-- Section D — correct_start_weight changes the value, NEVER the timestamps
-- ========================================================================
set local role postgres;
insert into probe select 'rex_before', wp.start_weight_kg, wp.start_weight_first_saved_at, wp.start_weight_locked_at
  from public.weight_profiles wp where wp.user_id = '00000000-0000-0000-0000-0000000b1004';

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000b1001","role":"authenticated"}', true);
select lives_ok(
  $$select public.correct_start_weight('00000000-0000-0000-0000-0000000bcf01'::uuid,
      '00000000-0000-0000-0000-0000000b1004'::uuid, 88.0, 'Vägde om på klinikvåg')$$,
  'an admin can correct a locked start weight with a reason');

set local role postgres;
insert into probe select 'rex_after', wp.start_weight_kg, wp.start_weight_first_saved_at, wp.start_weight_locked_at
  from public.weight_profiles wp where wp.user_id = '00000000-0000-0000-0000-0000000b1004';

select is((select kg from probe where label = 'rex_after'), 88.0::numeric,
  'the corrected value is stored');
select is((select first_saved from probe where label = 'rex_after'),
          (select first_saved from probe where label = 'rex_before'),
  'correct_start_weight leaves start_weight_first_saved_at byte-identical');
select is((select locked from probe where label = 'rex_after'),
          (select locked from probe where label = 'rex_before'),
  'correct_start_weight leaves start_weight_locked_at byte-identical');

-- ---- exactly one audit row, correct content ----
select is(
  (select count(*)::int from public.audit_log
   where entity_type = 'weight_profile' and action = 'start_weight_corrected'
     and target_user_id = '00000000-0000-0000-0000-0000000b1004'),
  1, 'correct_start_weight writes exactly one audit_log row');
select is(
  (select (before_data->>'start_weight_kg')::numeric from public.audit_log
   where entity_type = 'weight_profile' and action = 'start_weight_corrected'
     and target_user_id = '00000000-0000-0000-0000-0000000b1004'),
  90.0::numeric, 'audit before_data has the old value');
select is(
  (select (after_data->>'start_weight_kg')::numeric from public.audit_log
   where entity_type = 'weight_profile' and action = 'start_weight_corrected'
     and target_user_id = '00000000-0000-0000-0000-0000000b1004'),
  88.0::numeric, 'audit after_data has the new value');
select is(
  (select note from public.audit_log
   where entity_type = 'weight_profile' and action = 'start_weight_corrected'
     and target_user_id = '00000000-0000-0000-0000-0000000b1004'),
  'Vägde om på klinikvåg', 'audit note has the reason');

-- ========================================================================
-- Section E — correct_start_weight upserts a row for a participant with none
-- ========================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000b1001","role":"authenticated"}', true);
select lives_ok(
  $$select public.correct_start_weight('00000000-0000-0000-0000-0000000bcf01'::uuid,
      '00000000-0000-0000-0000-0000000b1005'::uuid, 75.0, 'Startvikt registrerad av admin')$$,
  'correct_start_weight upserts a row for a participant who had none');
set local role postgres;
select is(
  (select start_weight_kg from public.weight_profiles where user_id = '00000000-0000-0000-0000-0000000b1005'),
  75.0::numeric, 'the upserted row carries the value');
select ok(
  (select start_weight_first_saved_at is not null and start_weight_locked_at is not null
   from public.weight_profiles where user_id = '00000000-0000-0000-0000-0000000b1005'),
  'the upserted row has coherent lock timestamps');

select * from finish();
rollback;
