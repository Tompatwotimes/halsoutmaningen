-- ============================================================================
-- pgTAP — GM1 / 0016: Game Master engine (scoring, silence, pulses, dispatcher).
--
-- Deterministic throughout: every _run_game_master_pulse call passes an explicit
-- p_forced_roll (0.0 = always select the first weighted option / always emit;
-- 1.0 = always silence) so nothing depends on random().
--
-- Covered (plan Task 3 Step 1):
--   * _game_master_escalation early < mid < finale; missing challenge -> 1.7
--   * _game_master_intensity low 0.65 / normal 1.0 / high 1.35 / missing -> 1.0
--   * internal fns (_run_game_master_pulse / _game_master_tick_all /
--     _game_master_candidates) have NO EXECUTE for authenticated / anon
--   * disabled settings -> NULL + a 'disabled' run row, no event
--   * global 4h any-event cooldown -> 'cooldown' run row
--   * forced high roll -> 'silence', no event
--   * forced low roll + a real candidate + a seeded template -> exactly ONE
--     event and exactly ONE 'event' run row; event freezes rendered text +
--     payload (no leftover "{...}")
--   * later training-data changes never rewrite a frozen roast
--   * private_roasts_enabled = false drops the only (private) candidate
--   * same-subject recency + same-family 72h + template cooldown +
--     once_per_subject each suppress a second event
--   * a collapsed >= 14-day streak writes an idempotent streak_collapse memory
--   * request_game_master_pulse: non-member throws; member may call; a second
--     call inside the 90s window returns NULL; the signature takes ONLY
--     p_challenge_id (no victim / template / roll)
--   * mark_game_master_event_seen only marks an event the caller can read; a
--     user cannot mark another user's private event
--   * cancel_game_master_event needs a non-empty reason, hides the event from a
--     participant, and writes an audit row with actor + reason + id and no URL
--   * update_game_master_settings writes an audit row; a participant call throws;
--     an invalid intensity throws
--   * _game_master_tick_all() runs (twice) without error and produces at most
--     one scheduled run per challenge per local window
--   * ISOLATION: a core training_entries insert still succeeds with Game Master
--     disabled; no non-GM table has a foreign key to a Game Master table
-- ============================================================================
begin;
create extension if not exists pgtap;
select plan(86);

set local role postgres;

-- ---- identities -----------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'gm-eng-a@example.test', '{"display_name":"Ada"}', now(), now()),
  ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'gm-eng-p1@example.test', '{"display_name":"Pia"}', now(), now()),
  ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'gm-eng-p2@example.test', '{"display_name":"Ove"}', now(), now());
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-000000000001';

-- ---- challenges ----------------------------------------------------------
insert into public.challenges (id, name, start_date, end_date, timezone,
  required_minutes, proof_required, missed_day_cost, status, created_by)
values
  -- streak_long single-signal challenge (cost 0, wide range for the frozen test)
  ('00000000-0000-0000-0000-0000000000a2', 'GM-eng-streak',
   current_date - 30, current_date + 40, 'Europe/Stockholm', 30, true, 0, 'active',
   '00000000-0000-0000-0000-000000000001'),
  -- disabled Game Master
  ('00000000-0000-0000-0000-0000000000a3', 'GM-eng-disabled',
   current_date - 20, current_date + 20, 'Europe/Stockholm', 30, true, 50, 'active',
   '00000000-0000-0000-0000-000000000001'),
  -- private missed_day single-signal (cost 0 so no debt/kassan)
  ('00000000-0000-0000-0000-0000000000a4', 'GM-eng-priv',
   current_date - 6, current_date + 60, 'Europe/Stockholm', 30, true, 0, 'active',
   '00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-0000000000a5', 'GM-eng-priv-off',
   current_date - 6, current_date + 60, 'Europe/Stockholm', 30, true, 0, 'active',
   '00000000-0000-0000-0000-000000000001'),
  -- streak_long signal + an aged same-subject event
  ('00000000-0000-0000-0000-0000000000a6', 'GM-eng-subjcd',
   current_date - 8, current_date + 40, 'Europe/Stockholm', 30, true, 0, 'active',
   '00000000-0000-0000-0000-000000000001'),
  -- streak_long signal + an aged same-family event
  ('00000000-0000-0000-0000-0000000000a7', 'GM-eng-famcd',
   current_date - 8, current_date + 40, 'Europe/Stockholm', 30, true, 0, 'active',
   '00000000-0000-0000-0000-000000000001'),
  -- debt_leader signal + an aged event on the template (cooldown)
  ('00000000-0000-0000-0000-0000000000a8', 'GM-eng-tplcd',
   current_date - 6, current_date + 60, 'Europe/Stockholm', 30, true, 50, 'active',
   '00000000-0000-0000-0000-000000000001'),
  -- debt_leader signal + an aged event on the template for the same subject
  ('00000000-0000-0000-0000-0000000000a9', 'GM-eng-once',
   current_date - 6, current_date + 60, 'Europe/Stockholm', 30, true, 50, 'active',
   '00000000-0000-0000-0000-000000000001'),
  -- membership challenge for the request RPC
  ('00000000-0000-0000-0000-0000000000b1', 'GM-eng-member',
   current_date - 20, current_date + 40, 'Europe/Stockholm', 30, true, 50, 'active',
   '00000000-0000-0000-0000-000000000001'),
  -- collapsed long streak for the memory side effect
  ('00000000-0000-0000-0000-0000000000b2', 'GM-eng-mem',
   current_date - 30, current_date + 30, 'Europe/Stockholm', 30, true, 50, 'active',
   '00000000-0000-0000-0000-000000000001'),
  -- escalation / intensity fixtures (draft: excluded from the dispatcher)
  ('00000000-0000-0000-0000-0000000000c1', 'GM-eng-early',
   current_date - 1, current_date + 99, 'Europe/Stockholm', 30, true, 50, 'draft',
   '00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-0000000000c2', 'GM-eng-mid',
   current_date - 50, current_date + 50, 'Europe/Stockholm', 30, true, 50, 'draft',
   '00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-0000000000c3', 'GM-eng-finale',
   current_date - 99, current_date + 1, 'Europe/Stockholm', 30, true, 50, 'draft',
   '00000000-0000-0000-0000-000000000001');

-- ---- memberships -------------------------------------------------------
insert into public.challenge_memberships (challenge_id, user_id, participation_start_date, active, created_by)
values
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000002', current_date - 30, true, '00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000003', current_date + 10, true, '00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000002', current_date - 20, true, '00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-000000000002', current_date - 6,  true, '00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-000000000002', current_date - 6,  true, '00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-0000000000a6', '00000000-0000-0000-0000-000000000002', current_date - 8,  true, '00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-0000000000a7', '00000000-0000-0000-0000-000000000002', current_date - 8,  true, '00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-0000000000a8', '00000000-0000-0000-0000-000000000002', current_date - 6,  true, '00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-0000000000a9', '00000000-0000-0000-0000-000000000002', current_date - 6,  true, '00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000002', current_date - 20, true, '00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-000000000002', current_date - 30, true, '00000000-0000-0000-0000-000000000001');

-- ---- settings ---------------------------------------------------------
insert into public.game_master_settings (challenge_id, enabled, private_roasts_enabled, intensity) values
  ('00000000-0000-0000-0000-0000000000a2', true,  true,  'normal'),
  ('00000000-0000-0000-0000-0000000000a3', false, true,  'normal'),
  ('00000000-0000-0000-0000-0000000000a4', true,  true,  'normal'),
  ('00000000-0000-0000-0000-0000000000a5', true,  false, 'normal'),
  ('00000000-0000-0000-0000-0000000000a6', true,  true,  'normal'),
  ('00000000-0000-0000-0000-0000000000a7', true,  true,  'normal'),
  ('00000000-0000-0000-0000-0000000000a8', true,  true,  'normal'),
  ('00000000-0000-0000-0000-0000000000a9', true,  true,  'normal'),
  ('00000000-0000-0000-0000-0000000000b1', true,  true,  'normal'),
  ('00000000-0000-0000-0000-0000000000b2', true,  true,  'normal'),
  ('00000000-0000-0000-0000-0000000000c1', true,  true,  'low'),
  ('00000000-0000-0000-0000-0000000000c2', true,  true,  'normal'),
  ('00000000-0000-0000-0000-0000000000c3', true,  true,  'high');

-- ---- templates (one per family so selection is deterministic) ----------
insert into public.game_master_templates
  (template_key, family, visibility, severity, title_template, body_template,
   weight, cooldown_hours, once_per_subject, archive, final_weight)
values
  ('gm_sl', 'streak_long',  'public',  3, 'STATUS',
   '{name} har {streak} dagar i rad. Ingen bad om den informationen.',
   1, 72, false, true, 1),
  ('gm_md', 'missed_day',   'private', 4, 'INCIDENTRAPPORT',
   '{name} hittade inte 30 minuter under ett helt dygn. {missed_days} missade dagar totalt.',
   1, 96, false, false, 1),
  ('gm_dl', 'debt_leader',  'public',  5, 'KASSÖREN',
   '{name} ligger nu på {debt_sek} kr. Finansieringen av julbordet framskrider.',
   1, 400, true, true, 1);

-- ---- training history helper -----------------------------------------
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

-- CH streak / subjcd / famcd: a clean current 8+ day streak, nothing missed
do $$ begin
  for i in 0..9 loop
    perform pg_temp.done('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000002', (current_date - 8 + i)::date);
    perform pg_temp.done('00000000-0000-0000-0000-0000000000a6', '00000000-0000-0000-0000-000000000002', (current_date - 8 + i)::date);
    perform pg_temp.done('00000000-0000-0000-0000-0000000000a7', '00000000-0000-0000-0000-000000000002', (current_date - 8 + i)::date);
  end loop;
end $$;

-- CH disabled: a couple of completed days (irrelevant, GM is off)
select pg_temp.done('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000002', (current_date - 3)::date);

-- CH priv / priv-off: short run (< 5) then recent misses -> missed_day only
do $$ begin
  for i in 0..2 loop
    perform pg_temp.done('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-000000000002', (current_date - 6 + i)::date);
    perform pg_temp.done('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-000000000002', (current_date - 6 + i)::date);
  end loop;
end $$;

-- CH mem: a 16-day streak that then collapses
do $$ begin
  for i in 0..15 loop
    perform pg_temp.done('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-000000000002', (current_date - 30 + i)::date);
  end loop;
end $$;

-- ---- aged Game Master events (past the 4h global cooldown) -------------
insert into public.game_master_events
  (challenge_id, family, visibility, subject_user_id, template_id, severity,
   title_text, body_text, created_at)
values
  -- same subject (Pia), different family, 5h old
  ('00000000-0000-0000-0000-0000000000a6', 'comeback', 'private',
   '00000000-0000-0000-0000-000000000002', null, 2, 'x', 'y', now() - interval '5 hours'),
  -- same family (streak_long), different subject (Ove), 5h old, private
  ('00000000-0000-0000-0000-0000000000a7', 'streak_long', 'private',
   '00000000-0000-0000-0000-000000000003', null, 2, 'x', 'y', now() - interval '5 hours'),
  -- template gm_dl, 100h old -> inside the 400h template cooldown
  ('00000000-0000-0000-0000-0000000000a8', 'debt_leader', 'private',
   '00000000-0000-0000-0000-000000000003',
   (select id from public.game_master_templates where template_key = 'gm_dl'),
   5, 'x', 'y', now() - interval '100 hours'),
  -- template gm_dl for Pia, 500h old -> past cooldown, trips once_per_subject
  ('00000000-0000-0000-0000-0000000000a9', 'debt_leader', 'public',
   '00000000-0000-0000-0000-000000000002',
   (select id from public.game_master_templates where template_key = 'gm_dl'),
   5, 'x', 'y', now() - interval '500 hours');

-- ========================================================================
-- Section A — escalation + intensity + internal-grant lockdown
-- ========================================================================
select ok(
  public._game_master_escalation('00000000-0000-0000-0000-0000000000c1')
  < public._game_master_escalation('00000000-0000-0000-0000-0000000000c2'),
  'escalation rises from an early challenge to mid challenge');
select ok(
  public._game_master_escalation('00000000-0000-0000-0000-0000000000c2')
  < public._game_master_escalation('00000000-0000-0000-0000-0000000000c3'),
  'escalation rises from mid challenge to the finale');
select is(
  public._game_master_escalation('00000000-0000-0000-0000-0000000000ff'),
  1.7::numeric, 'a missing / degenerate challenge escalates to 1.7');

select is(public._game_master_intensity('00000000-0000-0000-0000-0000000000c1'), 0.65::numeric, 'low intensity multiplier');
select is(public._game_master_intensity('00000000-0000-0000-0000-0000000000c2'), 1.0::numeric,  'normal intensity multiplier');
select is(public._game_master_intensity('00000000-0000-0000-0000-0000000000c3'), 1.35::numeric, 'high intensity multiplier');
select is(public._game_master_intensity('00000000-0000-0000-0000-0000000000ff'), 1.0::numeric,  'a missing settings row is treated as normal');

select ok(not has_function_privilege('authenticated',
  'public._run_game_master_pulse(uuid, text, numeric)', 'execute'),
  '_run_game_master_pulse has no EXECUTE for authenticated');
select ok(not has_function_privilege('anon',
  'public._run_game_master_pulse(uuid, text, numeric)', 'execute'),
  '_run_game_master_pulse has no EXECUTE for anon');
select ok(not has_function_privilege('authenticated',
  'public._game_master_tick_all()', 'execute'),
  '_game_master_tick_all has no EXECUTE for authenticated');
select ok(not has_function_privilege('authenticated',
  'public._game_master_candidates(uuid)', 'execute'),
  '_game_master_candidates has no EXECUTE for authenticated');
select ok(has_function_privilege('authenticated',
  'public.request_game_master_pulse(uuid)', 'execute'),
  'request_game_master_pulse may be executed by authenticated');

-- ========================================================================
-- Section B — candidate generator sanity + the streak_collapse memory
-- ========================================================================
select ok(
  exists (select 1 from public._game_master_candidates('00000000-0000-0000-0000-0000000000a2')
          where family = 'streak_long'),
  'the candidate generator yields the streak_long observation');

select ok(
  (select count(*) from public._game_master_candidates('00000000-0000-0000-0000-0000000000b2')) >= 1,
  'the candidate generator runs for the collapsed-streak challenge');
select is(
  (select count(*)::int from public.game_master_memories
   where challenge_id = '00000000-0000-0000-0000-0000000000b2' and memory_type = 'streak_collapse'),
  1, 'a collapsed >= 14-day streak is remembered');
select public._game_master_candidates('00000000-0000-0000-0000-0000000000b2');
select is(
  (select count(*)::int from public.game_master_memories
   where challenge_id = '00000000-0000-0000-0000-0000000000b2' and memory_type = 'streak_collapse'),
  1, 'the streak_collapse memory write is idempotent');

-- ========================================================================
-- Section C — disabled Game Master
-- ========================================================================
select ok(
  public._run_game_master_pulse('00000000-0000-0000-0000-0000000000a3', 'event', 0.0) is null,
  'a disabled Game Master emits nothing');
select is(
  (select outcome from public.game_master_runs
   where challenge_id = '00000000-0000-0000-0000-0000000000a3'),
  'disabled', 'the run is recorded as outcome = disabled');
select is(
  (select count(*)::int from public.game_master_events
   where challenge_id = '00000000-0000-0000-0000-0000000000a3'),
  0, 'no event when the Game Master is disabled');

-- ========================================================================
-- Section D — forced silence, then a forced emission (CH streak)
-- ========================================================================
select ok(
  public._run_game_master_pulse('00000000-0000-0000-0000-0000000000a2', 'event', 1.0) is null,
  'a forced high roll produces silence');
select is(
  (select count(*)::int from public.game_master_events
   where challenge_id = '00000000-0000-0000-0000-0000000000a2'),
  0, 'a silent pulse creates no event');
select is(
  (select outcome from public.game_master_runs
   where challenge_id = '00000000-0000-0000-0000-0000000000a2'),
  'silence', 'the silent pulse is recorded');

select ok(
  public._run_game_master_pulse('00000000-0000-0000-0000-0000000000a2', 'event', 0.0) is not null,
  'a forced low roll with a real candidate + template emits an event');
select is(
  (select count(*)::int from public.game_master_events
   where challenge_id = '00000000-0000-0000-0000-0000000000a2'),
  1, 'exactly one event per pulse');
select is(
  (select count(*)::int from public.game_master_runs
   where challenge_id = '00000000-0000-0000-0000-0000000000a2' and outcome = 'event'),
  1, 'exactly one event-outcome run row');
select is(
  (select visibility from public.game_master_events
   where challenge_id = '00000000-0000-0000-0000-0000000000a2'),
  'public', 'the streak_long roast is public');
select is(
  (select subject_user_id from public.game_master_events
   where challenge_id = '00000000-0000-0000-0000-0000000000a2'),
  '00000000-0000-0000-0000-000000000002'::uuid, 'the subject is the streaking participant');
select is(
  (select title_text from public.game_master_events
   where challenge_id = '00000000-0000-0000-0000-0000000000a2'),
  'STATUS', 'the template title is frozen into the event');
select ok(
  (select body_text not like '%{%' from public.game_master_events
   where challenge_id = '00000000-0000-0000-0000-0000000000a2'),
  'the rendered body has no leftover {placeholder}');
select ok(
  (select body_text like '%dagar i rad%' from public.game_master_events
   where challenge_id = '00000000-0000-0000-0000-0000000000a2'),
  'the rendered body carries the template copy');
select ok(
  (select payload ? 'streak' and payload ->> 'fingerprint' like 'streak_long:%'
   from public.game_master_events where challenge_id = '00000000-0000-0000-0000-0000000000a2'),
  'the payload used for rendering is frozen with the event');

-- global 4h cooldown now blocks a second pulse
select ok(
  public._run_game_master_pulse('00000000-0000-0000-0000-0000000000a2', 'event', 0.0) is null,
  'the global 4h any-event cooldown blocks a second pulse');
select is(
  (select count(*)::int from public.game_master_runs
   where challenge_id = '00000000-0000-0000-0000-0000000000a2' and outcome = 'cooldown'),
  1, 'the blocked pulse is recorded as outcome = cooldown');
select is(
  (select count(*)::int from public.game_master_events
   where challenge_id = '00000000-0000-0000-0000-0000000000a2'),
  1, 'still exactly one event after the cooled-down pulse');

-- frozen text survives later training-data changes
create temp table frozen_body as
  select body_text, payload from public.game_master_events
  where challenge_id = '00000000-0000-0000-0000-0000000000a2';
select pg_temp.done('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000002', (current_date - 25)::date);
select is(
  (select body_text from public.game_master_events where challenge_id = '00000000-0000-0000-0000-0000000000a2'),
  (select body_text from frozen_body),
  'a frozen roast is never rewritten when the underlying training data changes');

-- ========================================================================
-- Section E — the private-roast toggle
-- ========================================================================
select ok(
  public._run_game_master_pulse('00000000-0000-0000-0000-0000000000a4', 'event', 0.0) is not null,
  'with private roasts enabled the missed_day ambush is emitted');
select is(
  (select visibility from public.game_master_events where challenge_id = '00000000-0000-0000-0000-0000000000a4'),
  'private', 'the missed_day ambush is private');
select is(
  (select family from public.game_master_events where challenge_id = '00000000-0000-0000-0000-0000000000a4'),
  'missed_day', 'the emitted family is missed_day');
select is(
  (select subject_user_id from public.game_master_events where challenge_id = '00000000-0000-0000-0000-0000000000a4'),
  '00000000-0000-0000-0000-000000000002'::uuid, 'the subject is the participant who missed');
select ok(
  (select body_text not like '%{%' from public.game_master_events where challenge_id = '00000000-0000-0000-0000-0000000000a4'),
  'the private roast body is rendered');
select ok(
  (select archive = false from public.game_master_events where challenge_id = '00000000-0000-0000-0000-0000000000a4'),
  'a private event never archives');

select ok(
  public._run_game_master_pulse('00000000-0000-0000-0000-0000000000a5', 'event', 0.0) is null,
  'with private roasts disabled the only (private) candidate is dropped');
select is(
  (select outcome from public.game_master_runs
   where challenge_id = '00000000-0000-0000-0000-0000000000a5'),
  'silence', 'the dropped-candidate pulse is silence');
select is(
  (select count(*)::int from public.game_master_events where challenge_id = '00000000-0000-0000-0000-0000000000a5'),
  0, 'no event when the private candidate is filtered');
select ok(
  (select candidate_count >= 1 from public.game_master_runs
   where challenge_id = '00000000-0000-0000-0000-0000000000a5'),
  'a candidate existed before the private filter');
select is(
  (select eligible_count from public.game_master_runs
   where challenge_id = '00000000-0000-0000-0000-0000000000a5'),
  0, 'zero eligible candidates after the private filter');

-- ========================================================================
-- Section F — subject / family / template / once_per_subject cooldowns
-- ========================================================================
select ok(
  public._run_game_master_pulse('00000000-0000-0000-0000-0000000000a6', 'event', 0.0) is null,
  'a recent event for the same subject suppresses a second one');
select is(
  (select count(*)::int from public.game_master_events
   where challenge_id = '00000000-0000-0000-0000-0000000000a6'
     and subject_user_id = '00000000-0000-0000-0000-000000000002'),
  1, 'no new event for the cooled-down subject (only the aged one remains)');
select is(
  (select outcome from public.game_master_runs
   where challenge_id = '00000000-0000-0000-0000-0000000000a6'),
  'silence', 'the same-subject pulse ends in silence');
select is(
  (select eligible_count from public.game_master_runs
   where challenge_id = '00000000-0000-0000-0000-0000000000a6'),
  0, 'the same-subject candidate is not eligible');

select ok(
  public._run_game_master_pulse('00000000-0000-0000-0000-0000000000a7', 'event', 0.0) is null,
  'a recent event of the same family suppresses another of that family');
select is(
  (select count(*)::int from public.game_master_events
   where challenge_id = '00000000-0000-0000-0000-0000000000a7' and family = 'streak_long'),
  1, 'no new streak_long event within the 72h family cooldown');
select is(
  (select eligible_count from public.game_master_runs
   where challenge_id = '00000000-0000-0000-0000-0000000000a7'),
  0, 'the same-family candidate is not eligible');

select ok(
  public._run_game_master_pulse('00000000-0000-0000-0000-0000000000a8', 'event', 0.0) is null,
  'a template inside its cooldown window is not eligible');
select is(
  (select diagnostics ->> 'reason' from public.game_master_runs
   where challenge_id = '00000000-0000-0000-0000-0000000000a8'),
  'no_eligible_template', 'the pulse records why it went silent');
select is(
  (select count(*)::int from public.game_master_events where challenge_id = '00000000-0000-0000-0000-0000000000a8'),
  1, 'no new event while the template is on cooldown');

select ok(
  public._run_game_master_pulse('00000000-0000-0000-0000-0000000000a9', 'event', 0.0) is null,
  'once_per_subject blocks reusing the template for the same subject');
select is(
  (select diagnostics ->> 'reason' from public.game_master_runs
   where challenge_id = '00000000-0000-0000-0000-0000000000a9'),
  'no_eligible_template', 'the once_per_subject pulse records the reason');
select is(
  (select count(*)::int from public.game_master_events where challenge_id = '00000000-0000-0000-0000-0000000000a9'),
  1, 'no new event when once_per_subject is already spent');

-- ========================================================================
-- Section G — the scheduled dispatcher
-- ========================================================================
select lives_ok(
  $$select public._game_master_tick_all()$$,
  'the hourly dispatcher runs without error');
select lives_ok(
  $$select public._game_master_tick_all()$$,
  'the hourly dispatcher is safe to run twice inside one hour');
select ok(
  (select count(*)::int from public.game_master_runs
   where challenge_id = '00000000-0000-0000-0000-0000000000a2' and source = 'scheduled') <= 1,
  'at most one scheduled run per challenge per local window');

-- ========================================================================
-- Section H — core isolation
-- ========================================================================
select lives_ok(
  $$insert into public.training_entries
     (challenge_id, user_id, challenge_date, session_seq, duration_minutes)
    values ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000002',
      (current_date - 5)::date, 1, 40)$$,
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

-- ========================================================================
-- Section I — request_game_master_pulse (authenticated)
-- ========================================================================
select is(
  pg_get_function_arguments('public.request_game_master_pulse(uuid)'::regprocedure),
  'p_challenge_id uuid',
  'request_game_master_pulse accepts only a challenge id (no victim / template / roll)');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok(
  $$select public.request_game_master_pulse('00000000-0000-0000-0000-0000000000b1')$$,
  null, null, 'a non-member cannot request a pulse');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select lives_ok(
  $$select public.request_game_master_pulse('00000000-0000-0000-0000-0000000000b1')$$,
  'an active member may request a best-effort pulse');
select ok(
  public.request_game_master_pulse('00000000-0000-0000-0000-0000000000b1') is null,
  'a second request inside the 90s window returns NULL without work');

-- ========================================================================
-- Section J — mark_game_master_event_seen (own visibility only)
-- ========================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select lives_ok(
  $$select public.mark_game_master_event_seen(
      (select id from public.game_master_events where challenge_id = '00000000-0000-0000-0000-0000000000a4'), false)$$,
  'the subject can mark their own private ambush seen');
select is(
  (select count(*)::int from public.game_master_event_views v
   where v.user_id = '00000000-0000-0000-0000-000000000002'
     and v.event_id = (select id from public.game_master_events where challenge_id = '00000000-0000-0000-0000-0000000000a4')),
  1, 'a view row is recorded for the subject');
select lives_ok(
  $$select public.mark_game_master_event_seen(
      (select id from public.game_master_events where challenge_id = '00000000-0000-0000-0000-0000000000a4'), true)$$,
  'the subject can dismiss their own ambush');
select ok(
  (select dismissed_at is not null from public.game_master_event_views v
   where v.user_id = '00000000-0000-0000-0000-000000000002'
     and v.event_id = (select id from public.game_master_events where challenge_id = '00000000-0000-0000-0000-0000000000a4')),
  'dismissing sets dismissed_at');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok(
  $$select public.mark_game_master_event_seen(
      (select id from public.game_master_events where challenge_id = '00000000-0000-0000-0000-0000000000a4'), false)$$,
  null, null, 'a user cannot mark another user''s private event');

set local role postgres;
select is(
  (select count(*)::int from public.game_master_event_views
   where user_id = '00000000-0000-0000-0000-000000000003'),
  0, 'no view row is created for the wrong user');

-- ========================================================================
-- Section K — cancel_game_master_event (admin, audited)
-- ========================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is(
  (select count(*)::int from public.game_master_events
   where challenge_id = '00000000-0000-0000-0000-0000000000a2'),
  1, 'a challenge member can see the public roast before it is cancelled');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok(
  $$select public.cancel_game_master_event(
      (select id from public.game_master_events where challenge_id = '00000000-0000-0000-0000-0000000000a2'), '   ')$$,
  null, null, 'cancelling requires a non-empty reason');
select lives_ok(
  $$select public.cancel_game_master_event(
      (select id from public.game_master_events where challenge_id = '00000000-0000-0000-0000-0000000000a2'), 'olämplig ton')$$,
  'an admin can cancel an event with a reason');
select is(
  (select count(*)::int from public.audit_log
   where entity_type = 'game_master_event' and action = 'game_master_event_cancelled'
     and entity_id = (select id from public.game_master_events where challenge_id = '00000000-0000-0000-0000-0000000000a2')
     and actor_user_id = '00000000-0000-0000-0000-000000000001'
     and note = 'olämplig ton'),
  1, 'the cancellation writes an audit row with actor + reason + event id');
select ok(
  (select position('http' in
     (coalesce(before_data::text, '') || coalesce(after_data::text, '') || coalesce(note, ''))) = 0
   from public.audit_log
   where entity_type = 'game_master_event' and action = 'game_master_event_cancelled'
   order by created_at desc limit 1),
  'the cancellation audit row contains no URL / secret');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is(
  (select count(*)::int from public.game_master_events
   where challenge_id = '00000000-0000-0000-0000-0000000000a2'),
  0, 'a cancelled event disappears from a participant''s view');

-- ========================================================================
-- Section L — update_game_master_settings (admin, audited)
-- ========================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$select public.update_game_master_settings(
      '00000000-0000-0000-0000-0000000000b1', true, true, false, true, 'high')$$,
  'an admin can update the Game Master settings');
select is(
  (select intensity from public.game_master_settings where challenge_id = '00000000-0000-0000-0000-0000000000b1'),
  'high', 'the intensity is persisted');
select is(
  (select public_roasts_enabled from public.game_master_settings where challenge_id = '00000000-0000-0000-0000-0000000000b1')::text,
  'false', 'the public-roast toggle is persisted');
select is(
  (select count(*)::int from public.audit_log
   where entity_type = 'game_master_settings' and action = 'game_master_settings_changed'
     and entity_id = '00000000-0000-0000-0000-0000000000b1'
     and actor_user_id = '00000000-0000-0000-0000-000000000001'),
  1, 'the settings change writes an audit row');
select throws_ok(
  $$select public.update_game_master_settings(
      '00000000-0000-0000-0000-0000000000b1', true, true, true, true, 'ultra')$$,
  null, null, 'an invalid intensity is rejected');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok(
  $$select public.update_game_master_settings(
      '00000000-0000-0000-0000-0000000000b1', true, true, true, true, 'low')$$,
  null, null, 'a participant cannot change the Game Master settings');

select * from finish();
rollback;
