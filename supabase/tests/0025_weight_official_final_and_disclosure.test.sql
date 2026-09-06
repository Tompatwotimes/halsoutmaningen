-- ============================================================================
-- pgTAP — Weight Tracking / 0025: official final weigh-in, finalize, disclose,
-- weight_final_result.
--
--   set_official_final_weight   admin-only; empty reason rejected; audited on
--                               EVERY call
--   finalize_weight_competition computes the most-negative winner across every
--                               participant with BOTH weights set —
--                               is_weight_hidden is NEVER consulted, so a
--                               HIDDEN participant can be the winner; excludes
--                               a participant missing either weight; re-runnable
--   disclose_weight_winner      throws before finalize; idempotent; the ONLY
--                               path that reveals a hidden winner
--   weight_final_result         co-member of a HIDDEN, undisclosed winner gets
--                               NULL winner fields + disclosed=false; after
--                               disclosure the real name + percentage, but the
--                               winner's weight_profiles/weight_entries stay
--                               invisible (independent mechanisms); a non-hidden
--                               winner / the winner / an admin always see real
--   weight_competition_results  a co-member cannot go around weight_final_result:
--                               a raw select on the table returns no row while
--                               the winner is HIDDEN and undisclosed; disclosure
--                               (or a non-hidden winner) lifts that row gate
-- ============================================================================
begin;
create extension if not exists pgtap;
select plan(29);

set local role postgres;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-0000000d1001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'wf-1001@example.test', '{"display_name":"Admin"}', now(), now()),
  ('00000000-0000-0000-0000-0000000d1002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'wf-1002@example.test', '{"display_name":"Pia"}', now(), now()),
  ('00000000-0000-0000-0000-0000000d1003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'wf-1003@example.test', '{"display_name":"Rex"}', now(), now()),
  ('00000000-0000-0000-0000-0000000d1004', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'wf-1004@example.test', '{"display_name":"Max"}', now(), now()),
  ('00000000-0000-0000-0000-0000000d1005', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'wf-1005@example.test', '{"display_name":"Lena"}', now(), now());
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000d1001';

insert into public.challenges (id, name, start_date, end_date, timezone,
  required_minutes, proof_required, missed_day_cost, status, created_by)
values ('00000000-0000-0000-0000-0000000dcf01', 'Weight-Final', current_date - 40, current_date + 20,
  'Europe/Stockholm', 30, true, 50, 'active', '00000000-0000-0000-0000-0000000d1001');

insert into public.challenge_memberships (challenge_id, user_id, participation_start_date, active, created_by)
select '00000000-0000-0000-0000-0000000dcf01', u, current_date - 40, true, '00000000-0000-0000-0000-0000000d1001'
from unnest(array[
  '00000000-0000-0000-0000-0000000d1002'::uuid, '00000000-0000-0000-0000-0000000d1003'::uuid,
  '00000000-0000-0000-0000-0000000d1004'::uuid, '00000000-0000-0000-0000-0000000d1005'::uuid
]) as u;

-- Locked start weights. Rex is HIDDEN. Max will have no official final.
--   Pia:  80.0  final 78.0 -> -2.5%
--   Rex: 100.0  final 92.0 -> -8.0%   HIDDEN  -> the eventual winner
--   Max:  90.0  (no final)            -> excluded from winner consideration
--   Lena: 70.0  final 69.0 -> -1.43%
insert into public.weight_profiles (challenge_id, user_id, start_weight_kg,
  start_weight_first_saved_at, start_weight_locked_at, is_weight_hidden)
values
  ('00000000-0000-0000-0000-0000000dcf01', '00000000-0000-0000-0000-0000000d1002', 80.0, now() - interval '3 days', now() - interval '2 days', false),
  ('00000000-0000-0000-0000-0000000dcf01', '00000000-0000-0000-0000-0000000d1003', 100.0, now() - interval '3 days', now() - interval '2 days', true),
  ('00000000-0000-0000-0000-0000000dcf01', '00000000-0000-0000-0000-0000000d1004', 90.0, now() - interval '3 days', now() - interval '2 days', false),
  ('00000000-0000-0000-0000-0000000dcf01', '00000000-0000-0000-0000-0000000d1005', 70.0, now() - interval '3 days', now() - interval '2 days', false);
insert into public.weight_entries (challenge_id, user_id, entry_date, weight_kg)
values ('00000000-0000-0000-0000-0000000dcf01', '00000000-0000-0000-0000-0000000d1003', current_date, 93.0);

-- probe for the idempotency capture
create temp table probe (label text primary key, ts timestamptz);
grant select, insert on probe to authenticated;

-- ========================================================================
-- Section A — set_official_final_weight guards; disclose-before-finalize
-- ========================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000d1002","role":"authenticated"}', true);
select throws_ok(
  $$select public.disclose_weight_winner('00000000-0000-0000-0000-0000000dcf01'::uuid)$$,
  null, null, 'disclose_weight_winner before any finalize is rejected');
select throws_ok(
  $$select public.set_official_final_weight('00000000-0000-0000-0000-0000000dcf01'::uuid,
      '00000000-0000-0000-0000-0000000d1002'::uuid, 78.0, 'x')$$,
  null, null, 'a non-admin cannot set an official final weight');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000d1001","role":"authenticated"}', true);
select throws_ok(
  $$select public.set_official_final_weight('00000000-0000-0000-0000-0000000dcf01'::uuid,
      '00000000-0000-0000-0000-0000000d1002'::uuid, 78.0, '   ')$$,
  null, null, 'set_official_final_weight with a whitespace-only reason is rejected');

-- admin records Pia's and Lena's official finals (Rex/Max: not yet)
select lives_ok(
  $$select public.set_official_final_weight('00000000-0000-0000-0000-0000000dcf01'::uuid,
      '00000000-0000-0000-0000-0000000d1002'::uuid, 78.0, 'Officiell invägning finalen')$$,
  'admin records Pia''s official final');
select lives_ok(
  $$select public.set_official_final_weight('00000000-0000-0000-0000-0000000dcf01'::uuid,
      '00000000-0000-0000-0000-0000000d1005'::uuid, 69.0, 'Officiell invägning finalen')$$,
  'admin records Lena''s official final');

-- ========================================================================
-- Section B — finalize picks the eligible non-hidden winner (Pia)
-- ========================================================================
select is(
  (select (public.finalize_weight_competition('00000000-0000-0000-0000-0000000dcf01'::uuid)).winner_user_id),
  '00000000-0000-0000-0000-0000000d1002'::uuid,
  'finalize (Rex/Max ineligible — no final) picks Pia, the most-negative eligible participant');

-- a co-member sees a NON-HIDDEN winner immediately, no disclosure needed
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000d1005","role":"authenticated"}', true);
select is(
  (select winner_user_id from public.weight_final_result('00000000-0000-0000-0000-0000000dcf01')),
  '00000000-0000-0000-0000-0000000d1002'::uuid,
  'weight_final_result shows a NON-HIDDEN winner to a co-member with no disclose call');
select is(
  (select disclosed from public.weight_final_result('00000000-0000-0000-0000-0000000dcf01')),
  false, 'and disclosed is false (nothing was disclosed — the winner just isn''t hidden)');

-- ========================================================================
-- Section C — set Rex's final; re-finalize; the HIDDEN participant wins
-- ========================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000d1001","role":"authenticated"}', true);
select lives_ok(
  $$select public.set_official_final_weight('00000000-0000-0000-0000-0000000dcf01'::uuid,
      '00000000-0000-0000-0000-0000000d1003'::uuid, 92.0, 'Officiell invägning finalen')$$,
  'admin records the HIDDEN participant Rex''s official final');
-- audit every call: correct Pia's final -> two audit rows for Pia
select lives_ok(
  $$select public.set_official_final_weight('00000000-0000-0000-0000-0000000dcf01'::uuid,
      '00000000-0000-0000-0000-0000000d1002'::uuid, 78.4, 'Rättad efter kontrollvägning')$$,
  'admin corrects Pia''s official final');
select is(
  (select count(*)::int from public.audit_log
   where entity_type = 'weight_profile' and action = 'official_final_weight_set'
     and target_user_id = '00000000-0000-0000-0000-0000000d1002'),
  2, 'set_official_final_weight writes an audit row on EVERY call (2 for Pia)');

select is(
  (select (public.finalize_weight_competition('00000000-0000-0000-0000-0000000dcf01'::uuid)).winner_user_id),
  '00000000-0000-0000-0000-0000000d1003'::uuid,
  're-finalize now picks the HIDDEN participant Rex — is_weight_hidden is never consulted');
select is(
  (select winner_percentage_change from public.weight_competition_results
   where challenge_id = '00000000-0000-0000-0000-0000000dcf01'),
  -8.00::numeric, 'winner_percentage_change for 100.0 -> 92.0 is -8.00');

-- ========================================================================
-- Section D — before disclosure: hidden winner is withheld from a co-member,
-- shown to the winner and to an admin
-- ========================================================================
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000d1005","role":"authenticated"}', true);
select ok(
  (select winner_user_id from public.weight_final_result('00000000-0000-0000-0000-0000000dcf01')) is null,
  'before disclosure a co-member gets a NULL winner_user_id for a hidden winner');
select is(
  (select disclosed from public.weight_final_result('00000000-0000-0000-0000-0000000dcf01')),
  false, 'and disclosed is false');
-- ...and the co-member cannot go around weight_final_result: a raw select on
-- weight_competition_results returns no row at all while the hidden winner is
-- undisclosed (the field gate is not the only thing standing between them and
-- the winner's identity + percentage).
select is(
  (select count(*)::int from public.weight_competition_results
   where challenge_id = '00000000-0000-0000-0000-0000000dcf01'),
  0, 'a co-member cannot directly read weight_competition_results for a hidden, undisclosed winner');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000d1003","role":"authenticated"}', true);
select is(
  (select winner_user_id from public.weight_final_result('00000000-0000-0000-0000-0000000dcf01')),
  '00000000-0000-0000-0000-0000000d1003'::uuid,
  'the winner themselves always sees the real result (before disclosure)');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000d1001","role":"authenticated"}', true);
select is(
  (select winner_user_id from public.weight_final_result('00000000-0000-0000-0000-0000000dcf01')),
  '00000000-0000-0000-0000-0000000d1003'::uuid,
  'an admin always sees the real result (before disclosure)');

-- ========================================================================
-- Section E — disclose_weight_winner: idempotent
-- ========================================================================
select lives_ok(
  $$select public.disclose_weight_winner('00000000-0000-0000-0000-0000000dcf01'::uuid)$$,
  'an admin discloses the winner');
insert into probe select 'disclosed1',
  (select disclosed_at from public.weight_competition_results
   where challenge_id = '00000000-0000-0000-0000-0000000dcf01');
select lives_ok(
  $$select public.disclose_weight_winner('00000000-0000-0000-0000-0000000dcf01'::uuid)$$,
  'a second disclose call is harmless');
select is(
  (select disclosed_at from public.weight_competition_results
   where challenge_id = '00000000-0000-0000-0000-0000000dcf01'),
  (select ts from probe where label = 'disclosed1'),
  'disclose_weight_winner is idempotent — disclosed_at is not moved by the second call');

-- ========================================================================
-- Section F — after disclosure: name + percentage revealed, history NOT
-- ========================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000d1005","role":"authenticated"}', true);
select is(
  (select winner_display_name from public.weight_final_result('00000000-0000-0000-0000-0000000dcf01')),
  'Rex', 'after disclosure the co-member sees the winner''s name');
select is(
  (select winner_percentage_change from public.weight_final_result('00000000-0000-0000-0000-0000000dcf01')),
  -8.00::numeric, 'and the winning percentage');
select is(
  (select count(*)::int from public.weight_profiles
   where challenge_id = '00000000-0000-0000-0000-0000000dcf01'
     and user_id = '00000000-0000-0000-0000-0000000d1003'),
  0, 'but the co-member STILL cannot read the winner''s weight_profiles row (RLS unaffected by disclosure)');
select is(
  (select count(*)::int from public.weight_entries
   where user_id = '00000000-0000-0000-0000-0000000d1003'),
  0, 'nor any of the winner''s weight_entries — the two mechanisms are independent');
-- Disclosure DOES lift the row-level gate on weight_competition_results itself:
-- the winner + percentage are now public, so a direct read is fine (it is the
-- same {name, %} weight_final_result now returns). Start/final kg + history stay
-- gated by weight_profiles / weight_entries RLS (asserted just above).
select is(
  (select winner_user_id from public.weight_competition_results
   where challenge_id = '00000000-0000-0000-0000-0000000dcf01'),
  '00000000-0000-0000-0000-0000000d1003'::uuid,
  'after disclosure a co-member CAN directly read the (now public) competition row');

-- ========================================================================
-- Section G — re-finalize that CHANGES the winner clears the disclosure
-- ========================================================================
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000d1001","role":"authenticated"}', true);
select lives_ok(
  $$select public.correct_start_weight('00000000-0000-0000-0000-0000000dcf01'::uuid,
      '00000000-0000-0000-0000-0000000d1002'::uuid, 300.0, 'Testfall: gör Pia till vinnare')$$,
  'admin corrects Pia''s start weight so she becomes the biggest loser');
select is(
  (select (public.finalize_weight_competition('00000000-0000-0000-0000-0000000dcf01'::uuid)).winner_user_id),
  '00000000-0000-0000-0000-0000000d1002'::uuid,
  're-finalize picks the new winner (Pia)');
select ok(
  (select disclosed_at from public.weight_competition_results
   where challenge_id = '00000000-0000-0000-0000-0000000dcf01') is null,
  'and the prior disclosure is cleared because the winner changed');

select * from finish();
rollback;
