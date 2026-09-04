-- ============================================================================
-- pgTAP — GM1 / 0015: Game Master persistence foundation.
--
--   * game_master_settings defaults (enabled, normal intensity)
--   * domain CHECKs: template severity 1..5, visibility private/public,
--     event status active/expired/cancelled, private-event-needs-subject,
--     cancelled-event coherence, duplicate view PK, memory fingerprint unique
--   * _game_master_validate_template + the templates validation trigger
--   * widened audit vocabulary (game_master_settings / game_master_event)
--   * RLS: participants cannot read settings/templates/memories/runs and
--     cannot write ANY Game Master table; a participant sees only their own
--     private event + non-cancelled public events of their challenge; an admin
--     sees everything; event views are owner-only
-- ============================================================================
begin;
create extension if not exists pgtap;
select plan(40);

set local role postgres;

-- ---- fixtures --------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'gmf-d1@example.test', '{"display_name":"Admin"}', now(), now()),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'gmf-d2@example.test', '{"display_name":"Anna"}', now(), now()),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'gmf-d3@example.test', '{"display_name":"Erik"}', now(), now());
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000d1';

insert into public.challenges (id, name, start_date, end_date, timezone,
  required_minutes, proof_required, missed_day_cost, status, created_by)
values
  ('00000000-0000-0000-0000-0000000000fa', 'GM-foundation-A',
   current_date - 20, current_date + 20, 'Europe/Stockholm', 30, true, 50, 'active',
   '00000000-0000-0000-0000-0000000000d1'),
  ('00000000-0000-0000-0000-0000000000fb', 'GM-foundation-B',
   current_date - 20, current_date + 20, 'Europe/Stockholm', 30, true, 50, 'active',
   '00000000-0000-0000-0000-0000000000d1');

insert into public.challenge_memberships (challenge_id, user_id, participation_start_date, active, created_by)
values
  ('00000000-0000-0000-0000-0000000000fa', '00000000-0000-0000-0000-0000000000d2',
   current_date - 20, true, '00000000-0000-0000-0000-0000000000d1'),
  ('00000000-0000-0000-0000-0000000000fa', '00000000-0000-0000-0000-0000000000d3',
   current_date - 20, true, '00000000-0000-0000-0000-0000000000d1');

-- one settings row (only challenge A) so the admin-visibility count is exact
insert into public.game_master_settings (challenge_id)
values ('00000000-0000-0000-0000-0000000000fa');

-- one valid template
insert into public.game_master_templates
  (template_key, family, visibility, severity, title_template, body_template)
values
  ('test_valid_001', 'missed_day', 'private', 3,
   'INCIDENTRAPPORT', '{name} hittade inte 30 minuter under ett helt dygn.');

-- events: E1 public/active(A), E2 private/Anna(A), E3 private/Erik(A),
--         E5 public/active(B). E4 (cancelled public A) is inserted by test #8.
insert into public.game_master_events
  (id, challenge_id, family, visibility, subject_user_id, severity, title_text, body_text)
values
  ('00000000-0000-0000-0000-0000000e0e01', '00000000-0000-0000-0000-0000000000fa',
   'general_system', 'public', null, 1, 'STATUS', 'Systemet observerar.'),
  ('00000000-0000-0000-0000-0000000e0e02', '00000000-0000-0000-0000-0000000000fa',
   'streak_long', 'private', '00000000-0000-0000-0000-0000000000d2', 3, 'STATUS', 'Anna, du ligger bra till.'),
  ('00000000-0000-0000-0000-0000000e0e03', '00000000-0000-0000-0000-0000000000fa',
   'streak_long', 'private', '00000000-0000-0000-0000-0000000000d3', 3, 'STATUS', 'Erik, du ligger bra till.'),
  ('00000000-0000-0000-0000-0000000e0e05', '00000000-0000-0000-0000-0000000000fb',
   'general_system', 'public', null, 1, 'STATUS', 'Annan utmaning.');

-- one memory + one run
insert into public.game_master_memories
  (challenge_id, subject_user_id, memory_type, fingerprint, memory_date, importance)
values
  ('00000000-0000-0000-0000-0000000000fa', '00000000-0000-0000-0000-0000000000d2',
   'streak_broken', 'fp-anna-streak-14', current_date, 3);

insert into public.game_master_runs (challenge_id, source, outcome)
values ('00000000-0000-0000-0000-0000000000fa', 'scheduled', 'silence');

-- one view row (owner = Anna) for the duplicate-PK + owner-visibility checks
insert into public.game_master_event_views (event_id, user_id)
values ('00000000-0000-0000-0000-0000000e0e01', '00000000-0000-0000-0000-0000000000d2');

-- ========================================================================
-- Section A — defaults, domain constraints, template validation (postgres)
-- ========================================================================
select is(
  (select enabled from public.game_master_settings
   where challenge_id = '00000000-0000-0000-0000-0000000000fa')::text,
  'true', 'game_master_settings.enabled defaults to true');
select is(
  (select intensity from public.game_master_settings
   where challenge_id = '00000000-0000-0000-0000-0000000000fa'),
  'normal', 'game_master_settings.intensity defaults to normal');

select throws_ok(
  $$insert into public.game_master_templates
      (template_key, family, visibility, severity, title_template, body_template)
    values ('t_sev6', 'missed_day', 'private', 6, 'X', 'Y')$$,
  null, null, 'template severity must be 1..5');

select throws_ok(
  $$insert into public.game_master_templates
      (template_key, family, visibility, severity, title_template, body_template)
    values ('t_visgroup', 'missed_day', 'group', 3, 'X', 'Y')$$,
  null, null, 'template visibility must be private/public');

select throws_ok(
  $$insert into public.game_master_events
      (challenge_id, family, visibility, severity, title_text, body_text, status)
    values ('00000000-0000-0000-0000-0000000000fa', 'general_system', 'public', 1, 'X', 'Y', 'pending')$$,
  null, null, 'event status must be active/expired/cancelled');

select throws_ok(
  $$insert into public.game_master_events
      (challenge_id, family, visibility, severity, title_text, body_text)
    values ('00000000-0000-0000-0000-0000000000fa', 'general_system', 'private', 3, 'X', 'Y')$$,
  null, null, 'a private event requires subject_user_id');

select throws_ok(
  $$insert into public.game_master_events
      (challenge_id, family, visibility, subject_user_id, severity, title_text, body_text, status)
    values ('00000000-0000-0000-0000-0000000000fa', 'general_system', 'public', null, 2, 'X', 'Y', 'cancelled')$$,
  null, null, 'a cancelled event without cancelled_at/by/reason is rejected');

select lives_ok(
  $$insert into public.game_master_events
      (id, challenge_id, family, visibility, severity, title_text, body_text,
       status, cancelled_at, cancelled_by, cancelled_reason)
    values ('00000000-0000-0000-0000-0000000e0e04', '00000000-0000-0000-0000-0000000000fa',
      'general_system', 'public', 2, 'X', 'Y',
      'cancelled', now(), '00000000-0000-0000-0000-0000000000d1', 'olämplig ton')$$,
  'a coherent cancelled event is accepted');

select throws_ok(
  $$insert into public.game_master_event_views (event_id, user_id)
    values ('00000000-0000-0000-0000-0000000e0e01', '00000000-0000-0000-0000-0000000000d2')$$,
  null, null, 'duplicate (event_id,user_id) view is rejected');

select throws_ok(
  $$insert into public.game_master_memories
      (challenge_id, subject_user_id, memory_type, fingerprint, memory_date, importance)
    values ('00000000-0000-0000-0000-0000000000fa', '00000000-0000-0000-0000-0000000000d3',
      'streak_broken', 'fp-anna-streak-14', current_date, 2)$$,
  null, null, 'memory (challenge_id,fingerprint) is unique');

select is(
  public._game_master_validate_template('Kravet var 30 minuter men {bogus} hände')::text,
  'false', '_game_master_validate_template rejects an unknown {placeholder}');
select is(
  public._game_master_validate_template(
    '{name} har {streak} dagar, skulden är {debt_sek} kr och {kassan_sek} i kassan')::text,
  'true', '_game_master_validate_template accepts approved placeholders');

select throws_ok(
  $$insert into public.game_master_templates
      (template_key, family, visibility, severity, title_template, body_template)
    values ('t_badph', 'missed_day', 'private', 3, 'RUBRIK', '{name} och {not_allowed} igen')$$,
  null, null, 'the templates trigger blocks an unknown placeholder');

select lives_ok(
  $$insert into public.game_master_templates
      (template_key, family, visibility, severity, title_template, body_template)
    values ('test_valid_002', 'missed_day', 'private', 3, 'RUBRIK',
      '{name} klarade {completed_days} av {eligible_days} dagar')$$,
  'the templates trigger allows only approved placeholders');

select lives_ok(
  $$insert into public.audit_log (actor_user_id, entity_type, action)
    values ('00000000-0000-0000-0000-0000000000d1', 'game_master_settings', 'game_master_settings_changed')$$,
  'audit vocabulary now allows game_master_settings');
select lives_ok(
  $$insert into public.audit_log (actor_user_id, entity_type, action)
    values ('00000000-0000-0000-0000-0000000000d1', 'game_master_event', 'game_master_event_cancelled')$$,
  'audit vocabulary now allows game_master_event');

-- ========================================================================
-- Section B — RLS as Anna (participant, member of challenge A)
-- ========================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated"}', true);

select is((select count(*)::int from public.game_master_settings), 0,
  'a participant cannot SELECT game_master_settings');
select is((select count(*)::int from public.game_master_templates), 0,
  'a participant cannot SELECT game_master_templates');
select is((select count(*)::int from public.game_master_memories), 0,
  'a participant cannot SELECT game_master_memories');
select is((select count(*)::int from public.game_master_runs), 0,
  'a participant cannot SELECT game_master_runs');

select throws_ok(
  $$insert into public.game_master_events
      (challenge_id, family, visibility, severity, title_text, body_text)
    values ('00000000-0000-0000-0000-0000000000fa', 'general_system', 'public', 1, 'X', 'Y')$$,
  null, null, 'a participant cannot INSERT a game_master_events row');
select throws_ok(
  $$insert into public.game_master_templates
      (template_key, family, visibility, severity, title_template, body_template)
    values ('t_anna', 'missed_day', 'private', 3, 'X', 'Y')$$,
  null, null, 'a participant cannot INSERT a game_master_templates row');
select throws_ok(
  $$update public.game_master_memories set importance = 1$$,
  null, null, 'a participant cannot UPDATE game_master_memories');
select throws_ok(
  $$delete from public.game_master_runs$$,
  null, null, 'a participant cannot DELETE game_master_runs');

select is(
  (select count(*)::int from public.game_master_events
   where id = '00000000-0000-0000-0000-0000000e0e01'),
  1, 'Anna sees a public active event of her challenge');
select is(
  (select count(*)::int from public.game_master_events
   where id = '00000000-0000-0000-0000-0000000e0e02'),
  1, 'Anna sees her own private event');
select is(
  (select count(*)::int from public.game_master_events
   where id = '00000000-0000-0000-0000-0000000e0e03'),
  0, 'Anna never sees another user''s private event');
select is(
  (select count(*)::int from public.game_master_events
   where id = '00000000-0000-0000-0000-0000000e0e04'),
  0, 'Anna never sees a cancelled event');
select is(
  (select count(*)::int from public.game_master_events
   where id = '00000000-0000-0000-0000-0000000e0e05'),
  0, 'Anna never sees a public event of a challenge she is not in');
select is((select count(*)::int from public.game_master_events), 2,
  'Anna sees exactly her two eligible events');

select is((select count(*)::int from public.game_master_event_views), 1,
  'Anna sees her own event-view row');

-- ========================================================================
-- Section C — RLS as Erik (participant, member of challenge A)
-- ========================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000d3","role":"authenticated"}', true);

select is(
  (select count(*)::int from public.game_master_events
   where id = '00000000-0000-0000-0000-0000000e0e03'),
  1, 'Erik sees his own private event');
select is(
  (select count(*)::int from public.game_master_events
   where id = '00000000-0000-0000-0000-0000000e0e02'),
  0, 'Erik never sees Anna''s private event');
select is((select count(*)::int from public.game_master_events), 2,
  'Erik sees exactly his two eligible events (public + own private)');

-- ========================================================================
-- Section D — RLS as admin
-- ========================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}', true);

select is((select count(*)::int from public.game_master_events), 5,
  'an admin sees every event (incl. private and cancelled)');
select is((select count(*)::int from public.game_master_settings), 1,
  'an admin can SELECT game_master_settings');
select is((select count(*)::int from public.game_master_templates), 2,
  'an admin can SELECT game_master_templates');
select is((select count(*)::int from public.game_master_memories), 1,
  'an admin can SELECT game_master_memories');
select is((select count(*)::int from public.game_master_runs), 1,
  'an admin can SELECT game_master_runs');
select is((select count(*)::int from public.game_master_event_views), 0,
  'event views stay owner-only — an admin does not see another user''s view row');

select * from finish();
rollback;
