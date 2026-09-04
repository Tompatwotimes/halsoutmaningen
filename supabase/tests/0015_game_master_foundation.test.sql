-- ============================================================================
-- pgTAP — GM1 / 0015: Game Master persistence foundation.
--
--   * game_master_settings defaults (enabled, normal intensity)
--   * domain CHECKs: template severity 1..5, visibility private/public,
--     event status active/expired/cancelled, private-event-needs-subject,
--     cancelled-event coherence, duplicate view PK, memory fingerprint unique
--   * _game_master_validate_template + the templates validation trigger
--   * the seeded 96-template roast bank (20260904130200): exact total, exact
--     per-family distribution, severity spread, the 16 severity-5 rows and
--     their once/cooldown discipline, per-family placeholder discipline, no
--     reward-promise copy, unique keys, private+public both present
--   * widened audit vocabulary (game_master_settings / game_master_event)
--   * RLS: participants cannot read settings/templates/memories/runs and
--     cannot write ANY Game Master table; a participant sees only their own
--     private event + non-cancelled public events of their challenge; an admin
--     sees everything; event views are owner-only
-- ============================================================================
begin;
create extension if not exists pgtap;
select plan(55);

set local role postgres;

-- ========================================================================
-- Section 0 — the seeded roast bank (migration 20260904130200).
-- Runs BEFORE any fixture template insert, so the table holds exactly the
-- 96 seeded rows and nothing else.
-- ========================================================================
select is(
  (select count(*)::int from public.game_master_templates where enabled),
  96, 'exactly 96 enabled Game Master templates are seeded');

select is(
  (select string_agg(family || '=' || c, ',' order by family)
   from (select family, count(*)::int c
         from public.game_master_templates where enabled
         group by family) s),
  'comeback=10,debt_leader=10,general_system=8,historic_callback=10,kassan=10,'
    || 'missed_day=14,ranking_position=8,streak_broken=14,streak_long=12',
  'each of the nine GM1 families has its exact seeded count');

select is(
  (select count(distinct severity)::int
   from public.game_master_templates where enabled),
  5, 'all five severities (1..5) are represented in the seed');
select is(
  (select min(severity)::int from public.game_master_templates where enabled),
  1, 'the seed contains a severity-1 template');
select is(
  (select max(severity)::int from public.game_master_templates where enabled),
  5, 'the seed contains a severity-5 template');

select is(
  (select count(*)::int
   from public.game_master_templates where enabled and severity = 5),
  16, 'exactly 16 seeded templates are severity 5');

select is(
  (select count(*)::int
   from public.game_master_templates
   where enabled and severity = 5
     and not (once_per_subject or cooldown_hours >= 336)),
  0, 'every severity-5 template is once_per_subject OR cooldown_hours >= 336');

select is(
  (select bool_and(
     public._game_master_validate_template(title_template)
     and public._game_master_validate_template(body_template))
   from public.game_master_templates where enabled)::text,
  'true', 'no seeded template uses an unapproved {placeholder}');

select is(
  (select count(*)::int
   from public.game_master_templates where enabled and visibility = 'private'),
  16, 'the seed has 16 private templates (missed_day 14 + historic_callback 2)');
select is(
  (select count(*)::int
   from public.game_master_templates where enabled and visibility = 'public'),
  80, 'the seed has 80 public templates');

-- Per-family placeholder discipline: a template may only use the placeholders
-- its family's engine payload provides. Catches e.g. a kassan/general_system
-- template using {name}.
select is(
  (select count(*)::int
   from public.game_master_templates t
   cross join lateral regexp_matches(
     t.title_template || ' ' || t.body_template, '\{([a-z_]+)\}', 'g') as m(g)
   where t.enabled
     and m.g[1] <> all (
     case t.family
       when 'missed_day' then array['name','missed_days','completed_days',
         'eligible_days','days_until_final','final_date','participant_count']
       when 'streak_long' then array['name','streak','days_until_final',
         'final_date','participant_count']
       when 'streak_broken' then array['name','previous_streak','streak',
         'days_until_final','final_date','participant_count']
       when 'debt_leader' then array['name','debt_sek','kassan_sek',
         'days_until_final','final_date','participant_count']
       when 'kassan' then array['kassan_sek','days_until_final','final_date',
         'participant_count']
       when 'comeback' then array['name','streak','previous_streak',
         'days_until_final','final_date','participant_count']
       when 'ranking_position' then array['name','rank','completed_days',
         'participant_count','days_until_final','final_date']
       when 'historic_callback' then array['name','previous_streak',
         'days_until_final','final_date','participant_count']
       when 'general_system' then array['participant_count','days_until_final',
         'final_date','kassan_sek']
       else array[]::text[]
     end
   )),
  0, 'every seeded template only uses placeholders its family payload provides');

select is(
  (select count(*)::int
   from public.game_master_templates
   where enabled
     and (title_template || ' ' || body_template)
         ~* 'competition token|tävlingspoll|du vinner|priset är|du får en titel'),
  0, 'no seeded template promises a competition / token / title / prize (GM1)');

select is(
  (select count(distinct template_key)::int
   from public.game_master_templates where enabled),
  96, 'all 96 seeded template_key values are distinct');

select is(
  (select body_template from public.game_master_templates
   where template_key = 'missed_day_001'),
  'Kravet var 30 minuter. Dygnet innehöll 1 440.',
  'the SYSTEMET HAR NOTERAT EN AVVIKELSE flagship is seeded verbatim');
select is(
  (select body_template from public.game_master_templates
   where template_key = 'kassan_001'),
  'Gruppen har nu gemensamt misslyckats ihop till {kassan_sek} kr. '
    || 'Det börjar likna en finansieringsmodell.',
  'the KASSAN finansieringsmodell flagship is seeded verbatim');

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
-- The migration backfills a settings row for every pre-existing challenge
-- (incl. the seeded first challenge), so scope the admin-visibility check to
-- challenge A; the point is that the admin policy lets an admin read the row.
select is(
  (select count(*)::int from public.game_master_settings
   where challenge_id = '00000000-0000-0000-0000-0000000000fa'),
  1, 'an admin can SELECT game_master_settings');
-- 96 seeded rows (20260904130200) + the 2 valid templates this test inserts.
select is((select count(*)::int from public.game_master_templates), 98,
  'an admin can SELECT game_master_templates');
select is((select count(*)::int from public.game_master_memories), 1,
  'an admin can SELECT game_master_memories');
select is((select count(*)::int from public.game_master_runs), 1,
  'an admin can SELECT game_master_runs');
select is((select count(*)::int from public.game_master_event_views), 0,
  'event views stay owner-only — an admin does not see another user''s view row');

select * from finish();
rollback;
