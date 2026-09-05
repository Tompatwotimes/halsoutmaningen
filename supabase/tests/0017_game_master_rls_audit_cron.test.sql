-- ============================================================================
-- pgTAP — GM1 / 0017: consolidated Game Master security proof
--   RLS + admin RPC guards + audit content + scheduler safety + failure
--   isolation.
--
-- 0015 already proves: RLS visibility (own private / public-member / not
-- cancelled / not other-challenge / admin-all), participant cannot
-- INSERT/UPDATE/DELETE any Game Master table, event-views owner-only, the
-- 96-template seed shape.
--
-- 0016 already proves: non-member cannot request_game_master_pulse; the
-- public wrapper's arg list is p_challenge_id only; the internal engine
-- functions have no EXECUTE for authenticated/anon; disabled -> outcome
-- 'disabled'; cooldowns; the private-roast toggle; frozen text; tick dedupe
-- (light); cancel needs a reason + writes an audit row with no URL and hides
-- the event; update_game_master_settings writes an audit row + a participant
-- call throws; a core training_entries insert still succeeds with Game
-- Master disabled; no non-GM table has an FK to a GM table.
--
-- This file's NEW coverage (does not duplicate the above beyond restating a
-- few invariants for a single authoritative security file):
--   * cancel_game_master_event throws for a non-admin participant
--   * the internal engine functions (_run_game_master_pulse,
--     _game_master_tick_all, _game_master_candidates, _game_master_render,
--     _game_master_escalation, _game_master_intensity, _game_master_score)
--     have NO EXECUTE for the PUBLIC pseudo-role, not just anon/authenticated
--   * request_game_master_pulse / mark_game_master_event_seen: EXECUTE for
--     authenticated, explicitly NOT for anon; request_game_master_pulse has
--     exactly one overload (no numeric-roll sibling)
--   * mark_game_master_event_seen: a user cannot mark another user's private
--     event (restated for this file) + no view row is created for them
--   * cancel_game_master_event's audit row is asserted to contain neither the
--     frozen roast body text nor any URL/token-looking substring
--   * update_game_master_settings's audit row before/after are asserted to
--     reflect the actual field change (not just "a row exists"), with no
--     secret-looking substring
--   * the scheduled dispatcher: a disabled challenge produces NO event and NO
--     scheduled run at all (it never enters the dispatcher's candidate set);
--     a deterministic (not just "<=1") dedupe assertion for two same-window
--     ticks
--   * failure isolation, strengthened: authoritative challenge_day_states /
--     challenge_results (liability_sek, current_streak) are captured before
--     and after BOTH a real forced-emit pulse AND an induced outcome='error'
--     pulse (a template corrupted past its own insert-time validation via a
--     temporarily disabled trigger) and asserted byte-identical
--   * no-core-coupling: a pg_catalog scan proves no trigger on a non-GM table
--     calls a GM function, and no non-GM function body references
--     'game_master_' at all (restates the 0016 FK check alongside it)
-- ============================================================================
begin;
create extension if not exists pgtap;
select plan(49);

set local role postgres;

-- ---- identities -------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'gm-sec-admin@example.test', '{"display_name":"Admin"}', now(), now()),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'gm-sec-anna@example.test', '{"display_name":"Anna"}', now(), now()),
  ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'gm-sec-erik@example.test', '{"display_name":"Erik"}', now(), now());
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000f1';

-- ---- challenges ---------------------------------------------------------
insert into public.challenges (id, name, start_date, end_date, timezone,
  required_minutes, proof_required, missed_day_cost, status, created_by)
values
  -- private missed_day signal only (cost 0, single member) — cancel/audit/RLS
  ('00000000-0000-0000-0000-00000000f0c1', 'GM-sec-cancel',
   current_date - 15, current_date + 30, 'Europe/Stockholm', 30, true, 0, 'active',
   '00000000-0000-0000-0000-0000000000f1'),
  -- no participants needed — settings-audit RPC only
  ('00000000-0000-0000-0000-00000000f0c2', 'GM-sec-settings',
   current_date - 10, current_date + 10, 'Europe/Stockholm', 30, true, 50, 'active',
   '00000000-0000-0000-0000-0000000000f1'),
  -- Game Master disabled — dispatcher must skip it entirely
  ('00000000-0000-0000-0000-00000000f0c3', 'GM-sec-tickoff',
   current_date - 10, current_date + 10, 'Europe/Stockholm', 30, true, 50, 'active',
   '00000000-0000-0000-0000-0000000000f1'),
  -- enabled, no participants — dispatcher dedupe window check
  ('00000000-0000-0000-0000-00000000f0c4', 'GM-sec-tickdedupe',
   current_date - 10, current_date + 10, 'Europe/Stockholm', 30, true, 50, 'active',
   '00000000-0000-0000-0000-0000000000f1'),
  -- clean streak_long single signal (cost 0) — failure-isolation emit path
  ('00000000-0000-0000-0000-00000000f0c5', 'GM-sec-isolate',
   current_date - 30, current_date + 40, 'Europe/Stockholm', 30, true, 0, 'active',
   '00000000-0000-0000-0000-0000000000f1'),
  -- debt_leader single signal (cost 50, zero training) — induced error path
  ('00000000-0000-0000-0000-00000000f0c6', 'GM-sec-error',
   current_date - 10, current_date + 40, 'Europe/Stockholm', 30, true, 50, 'active',
   '00000000-0000-0000-0000-0000000000f1');

-- ---- memberships ----------------------------------------------------------
insert into public.challenge_memberships (challenge_id, user_id, participation_start_date, active, created_by)
values
  ('00000000-0000-0000-0000-00000000f0c1', '00000000-0000-0000-0000-0000000000f2',
   current_date - 15, true, '00000000-0000-0000-0000-0000000000f1'),
  ('00000000-0000-0000-0000-00000000f0c5', '00000000-0000-0000-0000-0000000000f2',
   current_date - 30, true, '00000000-0000-0000-0000-0000000000f1'),
  ('00000000-0000-0000-0000-00000000f0c6', '00000000-0000-0000-0000-0000000000f2',
   current_date - 10, true, '00000000-0000-0000-0000-0000000000f1'),
  -- so Section H's raw training_entries insert has a real membership to land
  -- in: training_entries_guard rejects "no membership" unconditionally, even
  -- for a privileged (no-JWT) actor — that check is unrelated to Game Master.
  ('00000000-0000-0000-0000-00000000f0c3', '00000000-0000-0000-0000-0000000000f2',
   current_date - 10, true, '00000000-0000-0000-0000-0000000000f1');

-- ---- settings ---------------------------------------------------------
insert into public.game_master_settings (challenge_id, enabled, private_roasts_enabled, public_roasts_enabled, archive_enabled, intensity)
values
  ('00000000-0000-0000-0000-00000000f0c1', true,  true, true, true, 'normal'),
  ('00000000-0000-0000-0000-00000000f0c2', true,  true, true, true, 'normal'),
  ('00000000-0000-0000-0000-00000000f0c3', false, true, true, true, 'normal'),
  ('00000000-0000-0000-0000-00000000f0c4', true,  true, true, true, 'normal'),
  ('00000000-0000-0000-0000-00000000f0c5', true,  true, true, true, 'normal'),
  ('00000000-0000-0000-0000-00000000f0c6', true,  true, true, true, 'normal');

-- ---- templates: this suite controls the whole pool, one per exercised
-- family/visibility, exactly as 0016 does inside its own rolled-back
-- transaction (the real 96-row seed is irrelevant to engine-mechanics tests).
delete from public.game_master_templates;

insert into public.game_master_templates
  (template_key, family, visibility, severity, title_template, body_template,
   weight, cooldown_hours, once_per_subject, archive, final_weight)
values
  ('sec_md', 'missed_day',  'private', 3, 'RAPPORT',
   '{name} missade en dag. {missed_days} totalt.', 1, 72, false, false, 1),
  ('sec_sl', 'streak_long', 'public',  3, 'STATUS',
   '{name} har {streak} dagar i rad.', 1, 72, false, true, 1),
  ('sec_dl', 'debt_leader', 'public',  4, 'KASSÖREN',
   '{name} ligger på {debt_sek} kr.', 1, 72, false, true, 1);

-- ---- training history: only the isolate-emit challenge needs data (a clean
-- current streak). The cancel / error challenges deliberately have ZERO
-- training entries so their only qualifying signal is missed_day / debt_leader.
create or replace function pg_temp.done(p_ch uuid, p_user uuid, p_date date)
returns void language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into public.training_entries
    (id, challenge_id, user_id, challenge_date, session_seq, duration_minutes)
  values (v_id, p_ch, p_user, p_date, 1, 35);
  insert into public.training_proofs
    (training_entry_id, challenge_id, user_id, storage_path, mime_type, size_bytes)
  values (v_id, p_ch, p_user,
    format('%s/%s/%s/%s.jpg', p_ch, p_user, p_date, v_id), 'image/jpeg', 1000);
end;
$$;

do $$ begin
  for i in 0..9 loop
    perform pg_temp.done('00000000-0000-0000-0000-00000000f0c5', '00000000-0000-0000-0000-0000000000f2', (current_date - 8 + i)::date);
  end loop;
end $$;

-- ========================================================================
-- Section A — internal engine functions: NO execute for public / anon /
-- authenticated (0016 only checked anon/authenticated; this adds PUBLIC).
-- ========================================================================
select ok(
  (select bool_and(not has_function_privilege('public', sig, 'execute'))
   from unnest(array[
     'public._run_game_master_pulse(uuid, text, numeric)',
     'public._game_master_tick_all()',
     'public._game_master_candidates(uuid)',
     'public._game_master_render(text, jsonb)',
     'public._game_master_escalation(uuid)',
     'public._game_master_intensity(uuid)',
     'public._game_master_score(numeric, numeric, numeric, numeric, numeric)'
   ]) as sig),
  'no internal Game Master function has EXECUTE for the PUBLIC pseudo-role');
select ok(
  (select bool_and(not has_function_privilege('anon', sig, 'execute'))
   from unnest(array[
     'public._run_game_master_pulse(uuid, text, numeric)',
     'public._game_master_tick_all()',
     'public._game_master_candidates(uuid)',
     'public._game_master_render(text, jsonb)',
     'public._game_master_escalation(uuid)',
     'public._game_master_intensity(uuid)',
     'public._game_master_score(numeric, numeric, numeric, numeric, numeric)'
   ]) as sig),
  'no internal Game Master function has EXECUTE for anon');
select ok(
  (select bool_and(not has_function_privilege('authenticated', sig, 'execute'))
   from unnest(array[
     'public._run_game_master_pulse(uuid, text, numeric)',
     'public._game_master_tick_all()',
     'public._game_master_candidates(uuid)',
     'public._game_master_render(text, jsonb)',
     'public._game_master_escalation(uuid)',
     'public._game_master_intensity(uuid)',
     'public._game_master_score(numeric, numeric, numeric, numeric, numeric)'
   ]) as sig),
  'no internal Game Master function has EXECUTE for authenticated');

-- ========================================================================
-- Section B — the two app-facing RPCs: authenticated yes, anon no.
-- ========================================================================
select ok(has_function_privilege('authenticated', 'public.request_game_master_pulse(uuid)', 'execute'),
  'request_game_master_pulse has EXECUTE for authenticated');
select ok(not has_function_privilege('anon', 'public.request_game_master_pulse(uuid)', 'execute'),
  'request_game_master_pulse has NO EXECUTE for anon');
select ok(has_function_privilege('authenticated', 'public.mark_game_master_event_seen(uuid, boolean)', 'execute'),
  'mark_game_master_event_seen has EXECUTE for authenticated');
select ok(not has_function_privilege('anon', 'public.mark_game_master_event_seen(uuid, boolean)', 'execute'),
  'mark_game_master_event_seen has NO EXECUTE for anon');

-- request_game_master_pulse cannot be handed a forced roll: exactly one
-- overload, and its argument list is only the challenge id.
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'request_game_master_pulse'),
  1, 'request_game_master_pulse has exactly one overload (no forced-roll sibling)');
select is(
  pg_get_function_arguments('public.request_game_master_pulse(uuid)'::regprocedure),
  'p_challenge_id uuid',
  'the public wrapper accepts only p_challenge_id (no victim / template / roll)');

-- ========================================================================
-- Section C — participants cannot read the operator tables (restated).
-- ========================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000f2","role":"authenticated"}', true);

select is((select count(*)::int from public.game_master_settings), 0,
  'a participant cannot SELECT game_master_settings');
select is((select count(*)::int from public.game_master_templates), 0,
  'a participant cannot SELECT game_master_templates');
select is((select count(*)::int from public.game_master_memories), 0,
  'a participant cannot SELECT game_master_memories');
select is((select count(*)::int from public.game_master_runs), 0,
  'a participant cannot SELECT game_master_runs');

-- ========================================================================
-- Section D — emit the CH-cancel private ambush, then exercise
-- mark_game_master_event_seen / cancel_game_master_event guards + audit.
-- ========================================================================
set local role postgres;
select ok(
  public._run_game_master_pulse('00000000-0000-0000-0000-00000000f0c1', 'event', 0.0) is not null,
  'the cancel-flow challenge emits its missed_day ambush');

create temp table cancel_event as
  select id, body_text from public.game_master_events
  where challenge_id = '00000000-0000-0000-0000-00000000f0c1';
-- Read below under `authenticated` (Erik / Anna / admin in turn) to build the
-- RPC calls; a temp table grants no privileges to other roles by default.
grant select on cancel_event to authenticated;

-- Erik cannot mark Anna's private event seen.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000f3","role":"authenticated"}', true);
select throws_ok(
  format($$select public.mark_game_master_event_seen(%L, false)$$, (select id from cancel_event)),
  null, null, 'a user cannot mark another user''s private event seen');

set local role postgres;
select is(
  (select count(*)::int from public.game_master_event_views
   where user_id = '00000000-0000-0000-0000-0000000000f3'),
  0, 'no event-view row is created for the wrong user');

-- Anna (participant) cannot cancel her own ambush.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000f2","role":"authenticated"}', true);
select throws_ok(
  format($$select public.cancel_game_master_event(%L, 'jag gillar det inte')$$, (select id from cancel_event)),
  null, null, 'a participant cannot call cancel_game_master_event');

-- Admin: whitespace-only reason is rejected, then a real reason works.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000f1","role":"authenticated"}', true);
select throws_ok(
  format($$select public.cancel_game_master_event(%L, '   ')$$, (select id from cancel_event)),
  null, null, 'cancelling with a whitespace-only reason is rejected');
select lives_ok(
  format($$select public.cancel_game_master_event(%L, 'olämplig ton mot deltagare')$$, (select id from cancel_event)),
  'an admin can cancel the event with a real reason');

set local role postgres;
select is(
  (select count(*)::int from public.audit_log
   where entity_type = 'game_master_event' and action = 'game_master_event_cancelled'
     and entity_id = (select id from cancel_event)
     and actor_user_id = '00000000-0000-0000-0000-0000000000f1'
     and note = 'olämplig ton mot deltagare'),
  1, 'the cancellation writes exactly one audit row with actor + reason + event id');
select ok(
  (select position((select body_text from cancel_event) in
     (coalesce(before_data::text, '') || coalesce(after_data::text, '') || coalesce(note, ''))) = 0
   from public.audit_log
   where entity_type = 'game_master_event' and action = 'game_master_event_cancelled'
     and entity_id = (select id from cancel_event)),
  'the cancellation audit row does not contain the frozen roast body text');
select ok(
  not (
    (select coalesce(before_data::text, '') || coalesce(after_data::text, '') || coalesce(note, '')
     from public.audit_log
     where entity_type = 'game_master_event' and action = 'game_master_event_cancelled'
       and entity_id = (select id from cancel_event))
    ~* '(https?://|token=|/storage/|signed|service_role)'
  ), 'the cancellation audit row carries no URL / token-looking substring');

-- The cancelled event disappears even from its own subject.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000f2","role":"authenticated"}', true);
select is(
  (select count(*)::int from public.game_master_events where id = (select id from cancel_event)),
  0, 'a cancelled event disappears from its own subject''s view');

-- ========================================================================
-- Section E — update_game_master_settings: audited content + participant throws.
-- ========================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000f1","role":"authenticated"}', true);
select lives_ok(
  $$select public.update_game_master_settings(
      '00000000-0000-0000-0000-00000000f0c2', true, true, true, false, 'high')$$,
  'an admin can change the Game Master settings');

set local role postgres;
select is(
  (select count(*)::int from public.audit_log
   where entity_type = 'game_master_settings' and action = 'game_master_settings_changed'
     and entity_id = '00000000-0000-0000-0000-00000000f0c2'
     and actor_user_id = '00000000-0000-0000-0000-0000000000f1'),
  1, 'the settings change writes exactly one audit row');
select is(
  (select before_data ->> 'intensity' from public.audit_log
   where entity_type = 'game_master_settings' and action = 'game_master_settings_changed'
     and entity_id = '00000000-0000-0000-0000-00000000f0c2'),
  'normal', 'the audit before_data reflects the prior intensity');
select is(
  (select after_data ->> 'intensity' from public.audit_log
   where entity_type = 'game_master_settings' and action = 'game_master_settings_changed'
     and entity_id = '00000000-0000-0000-0000-00000000f0c2'),
  'high', 'the audit after_data reflects the new intensity');
select ok(
  not (
    (select coalesce(before_data::text, '') || coalesce(after_data::text, '')
     from public.audit_log
     where entity_type = 'game_master_settings' and action = 'game_master_settings_changed'
       and entity_id = '00000000-0000-0000-0000-00000000f0c2')
    ~* '(service_role|secret|token|password)'
  ), 'the settings audit row carries no secret-looking substring');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000f2","role":"authenticated"}', true);
select throws_ok(
  $$select public.update_game_master_settings(
      '00000000-0000-0000-0000-00000000f0c2', true, true, true, true, 'low')$$,
  null, null, 'a participant cannot change the Game Master settings');

-- ========================================================================
-- Section F — scheduled dispatcher: disabled challenges never emit, and a
-- deterministic per-local-window dedupe.
-- ========================================================================
set local role postgres;
-- Section E left `request.jwt.claims` pointed at Anna (a non-admin, non-member
-- of several fixture challenges below); clear it so the remaining sections run
-- as the unrestricted postgres role, exactly like every earlier section that
-- returns to `postgres` (see 0013/0016 house style).
select set_config('request.jwt.claims', '', true);

select lives_ok($$select public._game_master_tick_all()$$, 'first dispatcher tick runs without error');
select lives_ok($$select public._game_master_tick_all()$$, 'second dispatcher tick (same call) runs without error');

select is(
  (select count(*)::int from public.game_master_runs
   where challenge_id = '00000000-0000-0000-0000-00000000f0c3' and source = 'scheduled'),
  0, 'a disabled challenge never gets a scheduled run row (filtered out of the dispatcher entirely)');
select is(
  (select count(*)::int from public.game_master_events
   where challenge_id = '00000000-0000-0000-0000-00000000f0c3'),
  0, 'a disabled challenge never gets a scheduled event');

-- Deterministic dedupe: outside local hour 08/20 two ticks leave 0 scheduled
-- runs; inside that window they leave exactly 1 — never 2.
select is(
  (select count(*)::int from public.game_master_runs
   where challenge_id = '00000000-0000-0000-0000-00000000f0c4' and source = 'scheduled'),
  case when extract(hour from (now() at time zone 'Europe/Stockholm'))::int in (8, 20) then 1 else 0 end,
  'two same-call dispatcher ticks leave at most one scheduled run for an enabled challenge (deterministic per local window)');

-- ========================================================================
-- Section G — failure isolation, strengthened: authoritative state is
-- byte-identical before/after both a real emission and an induced error.
-- ========================================================================

-- Section F's `_game_master_tick_all()` also ticks f0c5 / f0c6 (both enabled)
-- when this suite happens to run during Stockholm local hour 08 or 20 —
-- leaving a `source='scheduled'` run (and possibly an event, which would then
-- trip _run_game_master_pulse's 4 h cooldown). Section G is about a *manual*
-- pulse in isolation, so clear any dispatcher artefacts for these two
-- challenges first; the manual pulses below are unaffected. (Pre-existing
-- time-of-day flake, unrelated to shared chat — surfaced by PR #3's CI run
-- landing at 20:xx local.)
delete from public.game_master_events
  where challenge_id in ('00000000-0000-0000-0000-00000000f0c5',
                         '00000000-0000-0000-0000-00000000f0c6');
delete from public.game_master_runs
  where challenge_id in ('00000000-0000-0000-0000-00000000f0c5',
                         '00000000-0000-0000-0000-00000000f0c6');

-- ---- G1: forced emission must not touch day state / liability / streak ---
create temp table iso_before as
  select
    (select state from public.challenge_day_states('00000000-0000-0000-0000-00000000f0c5', '00000000-0000-0000-0000-0000000000f2')
       where challenge_date = (current_date - 8)::date) as day_state,
    (select liability_sek  from public.challenge_results('00000000-0000-0000-0000-00000000f0c5') where user_id = '00000000-0000-0000-0000-0000000000f2') as liability_sek,
    (select current_streak from public.challenge_results('00000000-0000-0000-0000-00000000f0c5') where user_id = '00000000-0000-0000-0000-0000000000f2') as current_streak;

select ok(
  public._run_game_master_pulse('00000000-0000-0000-0000-00000000f0c5', 'event', 0.0) is not null,
  'the isolation challenge emits a real streak_long event (forced roll)');
select is(
  (select outcome from public.game_master_runs
   where challenge_id = '00000000-0000-0000-0000-00000000f0c5'
     and source = 'event'),
  'event', 'the isolation-emit pulse is recorded as outcome = event');

select is(
  (select state from public.challenge_day_states('00000000-0000-0000-0000-00000000f0c5', '00000000-0000-0000-0000-0000000000f2')
     where challenge_date = (current_date - 8)::date),
  (select day_state from iso_before),
  'day state is unchanged after a real Game Master emission');
select is(
  (select liability_sek from public.challenge_results('00000000-0000-0000-0000-00000000f0c5') where user_id = '00000000-0000-0000-0000-0000000000f2'),
  (select liability_sek from iso_before),
  'liability_sek is unchanged after a real Game Master emission');
select is(
  (select current_streak from public.challenge_results('00000000-0000-0000-0000-00000000f0c5') where user_id = '00000000-0000-0000-0000-0000000000f2'),
  (select current_streak from iso_before),
  'current_streak is unchanged after a real Game Master emission');

-- ---- G2: induce outcome='error' via a template corrupted past its own
-- insert-time validation (trigger disabled only for this one UPDATE), then
-- prove the same authoritative triple is still untouched. -----------------
create temp table err_before as
  select
    (select state from public.challenge_day_states('00000000-0000-0000-0000-00000000f0c6', '00000000-0000-0000-0000-0000000000f2')
       where challenge_date = (current_date - 1)::date) as day_state,
    (select liability_sek  from public.challenge_results('00000000-0000-0000-0000-00000000f0c6') where user_id = '00000000-0000-0000-0000-0000000000f2') as liability_sek,
    (select current_streak from public.challenge_results('00000000-0000-0000-0000-00000000f0c6') where user_id = '00000000-0000-0000-0000-0000000000f2') as current_streak;

alter table public.game_master_templates disable trigger game_master_templates_validate;
update public.game_master_templates
  set body_template = '{name} {this_placeholder_was_never_approved}'
  where template_key = 'sec_dl';
alter table public.game_master_templates enable trigger game_master_templates_validate;

select ok(
  public._run_game_master_pulse('00000000-0000-0000-0000-00000000f0c6', 'event', 0.0) is null,
  'a render-time failure is swallowed: the pulse returns NULL, never raises');
select is(
  (select outcome from public.game_master_runs
   where challenge_id = '00000000-0000-0000-0000-00000000f0c6'
     and source = 'event'),
  'error', 'the induced failure is recorded as outcome = error');
select is(
  (select count(*)::int from public.game_master_events
   where challenge_id = '00000000-0000-0000-0000-00000000f0c6'),
  0, 'no event is frozen when the pulse errors');

select is(
  (select state from public.challenge_day_states('00000000-0000-0000-0000-00000000f0c6', '00000000-0000-0000-0000-0000000000f2')
     where challenge_date = (current_date - 1)::date),
  (select day_state from err_before),
  'day state is unchanged after an errored Game Master pulse');
select is(
  (select liability_sek from public.challenge_results('00000000-0000-0000-0000-00000000f0c6') where user_id = '00000000-0000-0000-0000-0000000000f2'),
  (select liability_sek from err_before),
  'liability_sek is unchanged after an errored Game Master pulse');
select is(
  (select current_streak from public.challenge_results('00000000-0000-0000-0000-00000000f0c6') where user_id = '00000000-0000-0000-0000-0000000000f2'),
  (select current_streak from err_before),
  'current_streak is unchanged after an errored Game Master pulse');

-- ========================================================================
-- Section H — core isolation restated: writes still work, no coupling exists.
-- ========================================================================
select lives_ok(
  $$insert into public.training_entries
     (challenge_id, user_id, challenge_date, session_seq, duration_minutes)
    values ('00000000-0000-0000-0000-00000000f0c3', '00000000-0000-0000-0000-0000000000f2',
      (current_date - 2)::date, 1, 40)$$,
  'a core training_entries insert still succeeds with the Game Master disabled');

select is(
  (select count(*)::int
   from pg_constraint con
   join pg_class rel  on rel.oid  = con.conrelid
   join pg_class frel on frel.oid = con.confrelid
   where con.contype = 'f'
     and frel.relname ~ '^game_master_'
     and rel.relname !~ '^game_master_'),
  0, 'no non-Game-Master table has a foreign key to a Game Master table');

select is(
  (select count(*)::int
   from pg_trigger t
   join pg_class c on c.oid = t.tgrelid
   join pg_namespace n on n.oid = c.relnamespace
   join pg_proc p on p.oid = t.tgfoid
   where n.nspname = 'public'
     and c.relname !~ '^game_master_'
     and not t.tgisinternal
     and p.proname ~ '^game_master_|^_game_master_'),
  0, 'no trigger on a non-Game-Master table calls a Game Master function');

-- Every Game Master function's own name contains "game_master" somewhere
-- (internal _game_master_*/_run_game_master_pulse, or an RPC like
-- request_game_master_pulse/cancel_game_master_event) — unlike the trigger
-- scan above, this exclusion must not be anchored to the start of the name.
select is(
  (select count(*)::int
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname !~ 'game_master'
     and p.prosrc ~ 'game_master_'),
  0, 'no non-Game-Master function body references game_master_ at all');

select * from finish();
rollback;
