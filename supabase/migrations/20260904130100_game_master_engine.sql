-- ============================================================================
-- Hälsoutmaningen — GM1 / 0016  Game Master engine: scoring, silence, pulses
--
-- Depends on 0015 (Game Master persistence foundation) + the core read models
-- (challenge_results, challenge_day_states, challenge_streak_runs,
-- challenge_current_date, is_admin, is_challenge_member). Forward-only, ADDITIVE.
--
-- This migration is the SERVER-AUTHORITATIVE brain of the Game Master. It:
--   * reads ONLY authoritative challenge state to build scored candidate
--     observations (challenge_results / day-states / streak-runs / memories)
--   * applies hard eligibility + cooldown filters
--   * weighted-selects at most one candidate, then a template, then rolls a
--     separate emission probability — silence is a valid successful outcome
--   * freezes the rendered roast into game_master_events (never rewritten later)
--   * records one game_master_runs row per pulse decision, including silence
--   * NEVER re-raises: any candidate/render/selection error is swallowed into a
--     game_master_runs row with outcome='error'. A Game Master failure can only
--     ever manifest as "the Game Master was quiet".
--
-- ISOLATION GUARANTEE (spec §2): no core table, trigger or function calls
-- anything in this file. The frontend requests a best-effort pulse only AFTER a
-- core write already succeeded (wired in a later task). pg_cron calls the
-- internal dispatcher directly.
--
-- Function inventory
--   internal (NO app-role EXECUTE):
--     _game_master_escalation(uuid)            -> numeric   0.7 + p^2 finale curve
--     _game_master_intensity(uuid)             -> numeric   0.65 / 1.0 / 1.35
--     _game_master_score(numeric x5)           -> numeric   centralised 0..100
--     _game_master_render(text, jsonb)         -> text      approved placeholders
--     _game_master_candidates(uuid)            -> table      the 9 GM1 families
--     _run_game_master_pulse(uuid, text, numeric) -> uuid    one pulse decision
--     _game_master_tick_all()                  -> void      hourly cron dispatcher
--   authenticated RPCs:
--     request_game_master_pulse(uuid)              -> uuid
--     mark_game_master_event_seen(uuid, boolean)   -> void
--   admin RPCs:
--     update_game_master_settings(uuid, bool x4, text) -> void
--     cancel_game_master_event(uuid, text)             -> void
--
-- All SECURITY DEFINER, search_path='', schema-qualified.
-- ============================================================================

-- ============================================================================
-- 1. Finale escalation curve — mirror of
--    src/features/game-master/game-master.ts::escalationMultiplier
-- ============================================================================
create or replace function public._game_master_escalation(p_challenge_id uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ch    public.challenges;
  v_today date;
  p       numeric;
begin
  select * into v_ch from public.challenges where id = p_challenge_id;
  if v_ch.id is null or v_ch.end_date <= v_ch.start_date then
    return 1.7;  -- empty / degenerate range → treat as finale
  end if;
  v_today := public.challenge_current_date(p_challenge_id);
  p := greatest(0, least(1,
    (v_today - v_ch.start_date)::numeric / (v_ch.end_date - v_ch.start_date)::numeric));
  return 0.7 + p * p;
end;
$$;

comment on function public._game_master_escalation(uuid) is
  'GM1 finale escalation multiplier 0.7 + p^2 (p = clamped challenge progress). '
  'Empty range → 1.7. Mirrors game-master.ts::escalationMultiplier. Internal.';

revoke all on function public._game_master_escalation(uuid) from public, anon, authenticated;

-- ============================================================================
-- 2. Intensity multiplier from the per-challenge settings row
-- ============================================================================
create or replace function public._game_master_intensity(p_challenge_id uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_intensity text;
begin
  select intensity into v_intensity
  from public.game_master_settings
  where challenge_id = p_challenge_id;
  -- missing row → 'normal'
  if v_intensity = 'low' then
    return 0.65;
  elsif v_intensity = 'high' then
    return 1.35;
  end if;
  return 1.0;
end;
$$;

comment on function public._game_master_intensity(uuid) is
  'GM1 intensity multiplier: low 0.65 / normal 1.0 / high 1.35. Missing settings '
  'row is treated as normal. Internal — scales probability, never integrity.';

revoke all on function public._game_master_intensity(uuid) from public, anon, authenticated;

-- ============================================================================
-- 3. Centralised candidate scoring (spec §4). Conceptual 0..100:
--    base 20..40 + magnitude 0..30 + novelty 0..20 + final 0..10
--    + attention balance -20..+10
-- ============================================================================
create or replace function public._game_master_score(
  p_base      numeric,
  p_magnitude numeric,
  p_novelty   numeric,
  p_final     numeric,
  p_attention numeric
)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select greatest(0, least(100,
      least(40, greatest(20, coalesce(p_base, 20)))
    + least(30, greatest(0,  coalesce(p_magnitude, 0)))
    + least(20, greatest(0,  coalesce(p_novelty, 0)))
    + least(10, greatest(0,  coalesce(p_final, 0)))
    + least(10, greatest(-20, coalesce(p_attention, 0)))
  ));
$$;

comment on function public._game_master_score(numeric, numeric, numeric, numeric, numeric) is
  'GM1 candidate score. Clamps each spec §4 component to its band and the total '
  'to 0..100. The single place candidate relevance is defined. Internal.';

revoke all on function public._game_master_score(numeric, numeric, numeric, numeric, numeric)
  from public, anon, authenticated;

-- ============================================================================
-- 4. Template rendering — ONLY the 12 approved placeholders (spec §18).
--    * an unknown {placeholder} in the template raises (templates are validated
--      on insert, so this is defence in depth)
--    * a placeholder whose payload key is ABSENT renders as the empty string
--      (documented choice: never leave a literal "{name}" in a frozen roast)
-- ============================================================================
create or replace function public._game_master_render(p_template text, p_payload jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_out     text := coalesce(p_template, '');
  v_allowed text[] := array[
    'name', 'streak', 'previous_streak', 'missed_days', 'debt_sek',
    'kassan_sek', 'rank', 'participant_count', 'days_until_final',
    'final_date', 'eligible_days', 'completed_days'
  ];
  v_key     text;
  v_unknown text;
begin
  -- defence in depth: templates are validated on insert (0015), but never
  -- render an unapproved placeholder into a frozen event.
  select string_agg(x.m[1], ', ') into v_unknown
  from regexp_matches(v_out, '\{([^{}]+)\}', 'g') as x(m)
  where not (x.m[1] = any (v_allowed));

  if v_unknown is not null and v_unknown <> '' then
    raise exception 'game master render: unapproved placeholder(s): %', v_unknown
      using errcode = 'check_violation';
  end if;

  foreach v_key in array v_allowed loop
    v_out := replace(v_out, '{' || v_key || '}',
                     coalesce(p_payload ->> v_key, ''));
  end loop;

  return v_out;
end;
$$;

comment on function public._game_master_render(text, jsonb) is
  'Freeze-time roast renderer. Substitutes only the 12 approved GM1 placeholders '
  'from the payload; an absent key renders empty; an unapproved placeholder '
  'raises. Internal.';

revoke all on function public._game_master_render(text, jsonb) from public, anon, authenticated;

-- ============================================================================
-- 5. Candidate generation — the 9 GM1 families (plan Task 3 Step 3).
--
-- Every candidate is derived ONLY from authoritative reads:
--   challenge_results()  challenge_day_states()  challenge_streak_runs()
--   game_master_memories  profiles  game_master_events (own recency, for
--   novelty / attention balance only — never for challenge semantics)
--
-- Side effect: for a broken streak run >= 14 days it writes an idempotent
-- 'streak_collapse' memory (unique (challenge_id, fingerprint)) so a future
-- comeback / callback can reference it even if the streak_broken roast was
-- silence. This is the only write here and it touches no core table.
-- ============================================================================
create or replace function public._game_master_candidates(p_challenge_id uuid)
returns table (
  family          text,
  subject_user_id uuid,
  visibility      text,
  score           numeric,
  payload         jsonb,
  fingerprint     text
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_ch     public.challenges;
  v_today  date;
  v_dtf    integer;
  v_pcount integer;
  v_esc    numeric;
  v_final  numeric;
begin
  select * into v_ch from public.challenges where id = p_challenge_id;
  if v_ch.id is null or v_ch.status <> 'active' then
    return;
  end if;

  v_today := public.challenge_current_date(p_challenge_id);
  v_dtf   := v_ch.end_date - v_today;
  v_esc   := public._game_master_escalation(p_challenge_id);
  v_final := least(10, greatest(0, (v_esc - 0.7) * 10));

  select count(*) into v_pcount
  from public.challenge_memberships m
  where m.challenge_id = p_challenge_id
    and m.active
    and greatest(v_ch.start_date, m.participation_start_date) <= v_today
    and least(v_ch.end_date, coalesce(m.participation_end_date, v_ch.end_date)) >= v_today;

  -- ---- side effect: durable memory for a collapsed long streak ------------
  insert into public.game_master_memories (
    challenge_id, subject_user_id, memory_type, fingerprint, memory_date,
    importance, payload, earliest_callback_at
  )
  select
    p_challenge_id,
    b.user_id,
    'streak_collapse',
    'streak_collapse:' || b.user_id::text || ':' || b.run_start::text,
    b.run_end,
    least(5, greatest(3, (b.run_len / 10))),
    jsonb_build_object('previous_streak', b.run_len, 'run_start', b.run_start::text),
    now() + interval '5 days'
  from (
    select
      m.user_id, sr.run_start, sr.run_len,
      sr.run_days[array_upper(sr.run_days, 1)] as run_end
    from public.challenge_memberships m
    cross join lateral public.challenge_streak_runs(p_challenge_id, m.user_id) sr
    where m.challenge_id = p_challenge_id
      and sr.run_len >= 14
  ) b
  where b.run_end < v_today
    and exists (
      select 1 from public.challenge_day_states(p_challenge_id, b.user_id) ds
      where ds.challenge_date = b.run_end + 1 and ds.state = 'missed'
    )
  on conflict (challenge_id, fingerprint) do nothing;

  -- ---- the families -----------------------------------------------------
  return query
  with res as (
    select * from public.challenge_results(p_challenge_id)
  ),
  prof as (
    select id, display_name from public.profiles
  ),
  ev_subject as (
    select e.subject_user_id, max(e.created_at) as last_at
    from public.game_master_events e
    where e.challenge_id = p_challenge_id and e.subject_user_id is not null
    group by e.subject_user_id
  ),
  ev_family as (
    select e.family,
           count(*) filter (where e.created_at > now() - interval '7 days') as recent7
    from public.game_master_events e
    where e.challenge_id = p_challenge_id
    group by e.family
  ),
  kassan_total as (
    select coalesce(sum(liability_sek), 0)::numeric as total from res
  )

  -- 1. missed_day (private) — most recent freshly missed eligible day -------
  select
    'missed_day'::text,
    x.user_id,
    'private'::text,
    public._game_master_score(
      30,
      least(30, 6 * x.recent_missed),
      greatest(0, 20 - 5 * coalesce(ef.recent7, 0)),
      v_final,
      case when es.last_at is null then 10
           when es.last_at > now() - interval '7 days' then -20
           else 0 end
    ),
    jsonb_build_object(
      'name', x.display_name,
      'missed_days', x.missed_days,
      'completed_days', x.completed_days,
      'eligible_days', x.eligible_days,
      'days_until_final', v_dtf,
      'final_date', v_ch.end_date::text,
      'participant_count', v_pcount,
      'fingerprint', x.fp
    ),
    x.fp
  from (
    select
      r.user_id, p.display_name, r.missed_days, r.completed_days, r.eligible_days,
      md.missed_date,
      'missed_day:' || r.user_id::text || ':' || md.missed_date::text as fp,
      (select count(*) from public.challenge_day_states(p_challenge_id, r.user_id) ds
        where ds.state = 'missed' and ds.challenge_date >= v_today - 7) as recent_missed
    from res r
    join prof p on p.id = r.user_id
    cross join lateral (
      select max(ds.challenge_date) as missed_date
      from public.challenge_day_states(p_challenge_id, r.user_id) ds
      where ds.state = 'missed' and ds.challenge_date >= v_today - 2
    ) md
    where md.missed_date is not null
  ) x
  left join ev_family ef on ef.family = 'missed_day'
  left join ev_subject es on es.subject_user_id = x.user_id

  union all

  -- 2. streak_long (public) — highest 7/14/21/30/45/60 threshold reached ----
  select
    'streak_long'::text,
    r.user_id,
    'public'::text,
    public._game_master_score(
      25,
      least(30, thr.threshold / 2.0),
      greatest(0, 20 - 5 * coalesce(ef.recent7, 0)),
      v_final,
      case when es.last_at is null then 10
           when es.last_at > now() - interval '7 days' then -20
           else 0 end
    ),
    jsonb_build_object(
      'name', p.display_name,
      'streak', r.current_streak,
      'days_until_final', v_dtf,
      'final_date', v_ch.end_date::text,
      'participant_count', v_pcount,
      'fingerprint', 'streak_long:' || r.user_id::text || ':' || thr.threshold::text
    ),
    'streak_long:' || r.user_id::text || ':' || thr.threshold::text
  from res r
  join prof p on p.id = r.user_id
  cross join lateral (
    select max(u.n) as threshold
    from unnest(array[7, 14, 21, 30, 45, 60]) as u(n)
    where u.n <= r.current_streak
  ) thr
  left join ev_family ef on ef.family = 'streak_long'
  left join ev_subject es on es.subject_user_id = r.user_id
  where thr.threshold is not null

  union all

  -- 3. streak_broken (public) — most recently ended run >= 5 days -----------
  select
    'streak_broken'::text,
    b.user_id,
    'public'::text,
    public._game_master_score(
      28,
      least(30, b.run_len),
      greatest(0, 20 - 5 * coalesce(ef.recent7, 0)),
      v_final,
      case when es.last_at is null then 10
           when es.last_at > now() - interval '7 days' then -20
           else 0 end
    ),
    jsonb_build_object(
      'name', p.display_name,
      'previous_streak', b.run_len,
      'streak', b.cur_streak,
      'days_until_final', v_dtf,
      'final_date', v_ch.end_date::text,
      'participant_count', v_pcount,
      'fingerprint', b.fp
    ),
    b.fp
  from (
    select
      m.user_id, sr.run_start, sr.run_len,
      sr.run_days[array_upper(sr.run_days, 1)] as run_end,
      r.current_streak as cur_streak,
      'streak_broken:' || m.user_id::text || ':' || sr.run_start::text as fp,
      row_number() over (partition by m.user_id order by sr.run_start desc) as rn
    from public.challenge_memberships m
    join res r on r.user_id = m.user_id
    cross join lateral public.challenge_streak_runs(p_challenge_id, m.user_id) sr
    where m.challenge_id = p_challenge_id
      and sr.run_len >= 5
  ) b
  join prof p on p.id = b.user_id
  left join ev_family ef on ef.family = 'streak_broken'
  left join ev_subject es on es.subject_user_id = b.user_id
  where b.rn = 1
    and b.run_end < v_today
    and exists (
      select 1 from public.challenge_day_states(p_challenge_id, b.user_id) ds
      where ds.challenge_date = b.run_end + 1 and ds.state = 'missed'
    )

  union all

  -- 4. debt_leader (public) — single highest positive liability ------------
  select
    'debt_leader'::text,
    dl.user_id,
    'public'::text,
    public._game_master_score(
      25,
      least(30, dl.liability_sek / 100.0),
      greatest(0, 20 - 5 * coalesce(ef.recent7, 0)),
      v_final,
      case when es.last_at is null then 10
           when es.last_at > now() - interval '7 days' then -20
           else 0 end
    ),
    jsonb_build_object(
      'name', p.display_name,
      'debt_sek', dl.liability_sek,
      'kassan_sek', (select total from kassan_total),
      'days_until_final', v_dtf,
      'final_date', v_ch.end_date::text,
      'participant_count', v_pcount,
      'fingerprint', 'debt_leader:' || dl.user_id::text || ':' || floor(dl.liability_sek / 500.0)::text
    ),
    'debt_leader:' || dl.user_id::text || ':' || floor(dl.liability_sek / 500.0)::text
  from (
    select r.user_id, r.liability_sek,
           row_number() over (order by r.liability_sek desc, r.user_id) as rn
    from res r
    where r.liability_sek > 0
  ) dl
  join prof p on p.id = dl.user_id
  left join ev_family ef on ef.family = 'debt_leader'
  left join ev_subject es on es.subject_user_id = dl.user_id
  where dl.rn = 1

  union all

  -- 5. kassan (public, no subject) — total liability bucketed by 1000 SEK ---
  select
    'kassan'::text,
    null::uuid,
    'public'::text,
    public._game_master_score(
      20,
      least(30, k.total / 500.0),
      greatest(0, 20 - 5 * coalesce(ef.recent7, 0)),
      v_final,
      0
    ),
    jsonb_build_object(
      'kassan_sek', k.total,
      'days_until_final', v_dtf,
      'final_date', v_ch.end_date::text,
      'participant_count', v_pcount,
      'fingerprint', 'kassan:' || floor(k.total / 1000.0)::text
    ),
    'kassan:' || floor(k.total / 1000.0)::text
  from kassan_total k
  left join ev_family ef on ef.family = 'kassan'
  where k.total > 0

  union all

  -- 6. comeback (public) — streak >= 7 after a stored >= 14 collapse --------
  select
    'comeback'::text,
    r.user_id,
    'public'::text,
    public._game_master_score(
      30,
      least(30, r.current_streak),
      greatest(0, 20 - 5 * coalesce(ef.recent7, 0)),
      v_final,
      case when es.last_at is null then 10
           when es.last_at > now() - interval '7 days' then -20
           else 0 end
    ),
    jsonb_build_object(
      'name', p.display_name,
      'streak', r.current_streak,
      'previous_streak', coalesce((mm.payload ->> 'previous_streak')::int, 0),
      'days_until_final', v_dtf,
      'final_date', v_ch.end_date::text,
      'participant_count', v_pcount,
      'fingerprint', 'comeback:' || r.user_id::text || ':' || mm.id::text
    ),
    'comeback:' || r.user_id::text || ':' || mm.id::text
  from res r
  join prof p on p.id = r.user_id
  join public.game_master_memories mm
    on mm.challenge_id = p_challenge_id
   and mm.subject_user_id = r.user_id
   and mm.memory_type in ('streak_collapse', 'streak_broken')
   and coalesce((mm.payload ->> 'previous_streak')::int, 0) >= 14
  left join ev_family ef on ef.family = 'comeback'
  left join ev_subject es on es.subject_user_id = r.user_id
  where r.current_streak >= 7

  union all

  -- 7. ranking_position (public) — current top OR bottom only --------------
  select
    'ranking_position'::text,
    rk.user_id,
    'public'::text,
    public._game_master_score(
      22,
      case when rk.pos = 1 then 20 else 15 end,
      greatest(0, 20 - 5 * coalesce(ef.recent7, 0)),
      v_final,
      case when es.last_at is null then 10
           when es.last_at > now() - interval '7 days' then -20
           else 0 end
    ),
    jsonb_build_object(
      'name', p.display_name,
      'rank', case when rk.pos = 1 then 1 else rk.n end,
      'completed_days', rk.completed_days,
      'participant_count', v_pcount,
      'days_until_final', v_dtf,
      'final_date', v_ch.end_date::text,
      'fingerprint', 'ranking_position:' || rk.user_id::text || ':' ||
        case when rk.pos = 1 then 'top' else 'bottom' end
    ),
    'ranking_position:' || rk.user_id::text || ':' ||
      case when rk.pos = 1 then 'top' else 'bottom' end
  from (
    select r.user_id, r.completed_days,
           row_number() over (order by r.completed_days desc, r.current_streak desc, r.user_id) as pos,
           count(*) over () as n
    from res r
    where r.membership_active
  ) rk
  join prof p on p.id = rk.user_id
  left join ev_family ef on ef.family = 'ranking_position'
  left join ev_subject es on es.subject_user_id = rk.user_id
  where rk.n >= 3
    and (rk.pos = 1 or rk.pos = rk.n)

  union all

  -- 8. historic_callback — a due memory, visibility matching the memory -----
  select
    'historic_callback'::text,
    mm.subject_user_id,
    case when mm.subject_user_id is not null
          and (mm.payload ->> 'visibility') = 'private'
         then 'private' else 'public' end,
    public._game_master_score(
      25,
      least(30, mm.importance * 6),
      greatest(0, 20 - 5 * coalesce(ef.recent7, 0)),
      v_final,
      case when mm.subject_user_id is null then 0
           when es.last_at is null then 10
           when es.last_at > now() - interval '7 days' then -20
           else 0 end
    ),
    jsonb_build_object(
      'name', coalesce(p.display_name, ''),
      'previous_streak', coalesce((mm.payload ->> 'previous_streak')::int, 0),
      'days_until_final', v_dtf,
      'final_date', v_ch.end_date::text,
      'participant_count', v_pcount,
      'fingerprint', 'callback:' || mm.id::text
    ),
    'callback:' || mm.id::text
  from public.game_master_memories mm
  left join prof p on p.id = mm.subject_user_id
  left join ev_family ef on ef.family = 'historic_callback'
  left join ev_subject es on es.subject_user_id = mm.subject_user_id
  where mm.challenge_id = p_challenge_id
    and mm.earliest_callback_at is not null
    and mm.earliest_callback_at <= now()
    and (mm.expires_at is null or mm.expires_at > now())

  union all

  -- 9. general_system (public, no subject) — deliberately below the 35 floor
  --    so a generic observation can NEVER, on its own, defeat silence and spam
  --    the group (plan Task 3 Step 3 #9). Max attainable here: 20+0+8+6+0 = 34.
  select
    'general_system'::text,
    null::uuid,
    'public'::text,
    public._game_master_score(
      20,
      0,
      greatest(0, 8 - 5 * coalesce(ef.recent7, 0)),
      least(6, v_final),
      0
    ),
    jsonb_build_object(
      'participant_count', v_pcount,
      'days_until_final', v_dtf,
      'final_date', v_ch.end_date::text,
      'kassan_sek', (select total from kassan_total),
      'fingerprint', 'general_system:' || v_today::text
    ),
    'general_system:' || v_today::text
  from (select 1) _
  left join ev_family ef on ef.family = 'general_system';
end;
$$;

comment on function public._game_master_candidates(uuid) is
  'GM1 candidate generator: the 9 approved families, scored via '
  '_game_master_score, derived only from authoritative reads. Idempotently '
  'writes a streak_collapse memory for a broken >= 14-day run. Internal.';

revoke all on function public._game_master_candidates(uuid) from public, anon, authenticated;

-- ============================================================================
-- 6. The pulse core. NEVER re-raises: every error path ends in a
--    game_master_runs row and a NULL return.
-- ============================================================================
create or replace function public._run_game_master_pulse(
  p_challenge_id uuid,
  p_source       text,
  p_forced_roll  numeric default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings    public.game_master_settings;
  v_cands       jsonb := '[]'::jsonb;
  v_eligible    jsonb := '[]'::jsonb;
  v_cand_count  integer := 0;
  v_elig_count  integer := 0;
  v_chosen      jsonb;
  v_family      text;
  v_visibility  text;
  v_subject     uuid;
  v_score       numeric;
  v_payload     jsonb;
  v_esc         numeric;
  v_intensity   numeric;
  v_template    public.game_master_templates;
  v_template_id uuid;
  v_sel_roll    numeric;
  v_tpl_roll    numeric;
  v_emit_roll   numeric;
  v_prob        numeric;
  v_event_id    uuid;
  v_pub_blocked boolean;
begin
  -- ---- 1. settings: missing row or disabled = quiet ---------------------
  select * into v_settings
  from public.game_master_settings
  where challenge_id = p_challenge_id;

  if v_settings.challenge_id is null or not v_settings.enabled then
    insert into public.game_master_runs (challenge_id, source, outcome, completed_at)
    values (p_challenge_id, p_source, 'disabled', now());
    return null;
  end if;

  -- ---- 2. global any-event cooldown (4 h) -------------------------------
  if exists (
    select 1 from public.game_master_events e
    where e.challenge_id = p_challenge_id
      and e.created_at > now() - interval '4 hours'
  ) then
    insert into public.game_master_runs (challenge_id, source, outcome, completed_at)
    values (p_challenge_id, p_source, 'cooldown', now());
    return null;
  end if;

  -- ---- 3..14 candidate → filter → select → emit (isolated) ------------
  begin
    v_esc       := public._game_master_escalation(p_challenge_id);
    v_intensity := public._game_master_intensity(p_challenge_id);
    v_sel_roll  := coalesce(p_forced_roll, random());
    v_tpl_roll  := coalesce(p_forced_roll, random());
    v_emit_roll := coalesce(p_forced_roll, random());

    -- 3. candidates (single call — it has an idempotent memory side effect)
    select coalesce(jsonb_agg(to_jsonb(x) order by x.fingerprint), '[]'::jsonb)
    into v_cands
    from public._game_master_candidates(p_challenge_id) x;

    v_cand_count := jsonb_array_length(v_cands);

    -- 4..5. filter chain + discard < 35
    v_pub_blocked := exists (
      select 1 from public.game_master_events e
      where e.challenge_id = p_challenge_id
        and e.visibility = 'public'
        and e.created_at > now() - interval '36 hours'
    );

    select
      coalesce(jsonb_agg(f.c order by f.c ->> 'fingerprint'), '[]'::jsonb),
      count(*)::int
    into v_eligible, v_elig_count
    from (
      select value as c,
             (value ->> 'score')::numeric as sc,
             value ->> 'visibility' as vis,
             value ->> 'family' as fam,
             nullif(value ->> 'subject_user_id', '')::uuid as subj
      from jsonb_array_elements(v_cands) value
    ) f
    where f.sc >= 35
      -- fingerprint already emitted (idempotent families never re-fire)
      and not exists (
        select 1 from public.game_master_events e
        where e.challenge_id = p_challenge_id
          and e.payload ->> 'fingerprint' = f.c ->> 'fingerprint'
          and e.status <> 'cancelled'
      )
      -- visibility toggles
      and (v_settings.private_roasts_enabled or f.vis <> 'private')
      and (v_settings.public_roasts_enabled  or f.vis <> 'public')
      -- public-event cooldown 36 h
      and not (f.vis = 'public' and v_pub_blocked)
      -- same-subject hard cooldown 48 h
      and not exists (
        select 1 from public.game_master_events e
        where e.challenge_id = p_challenge_id
          and f.subj is not null
          and e.subject_user_id = f.subj
          and e.created_at > now() - interval '48 hours'
      )
      -- same-family cooldown 72 h
      and not exists (
        select 1 from public.game_master_events e
        where e.challenge_id = p_challenge_id
          and e.family = f.fam
          and e.created_at > now() - interval '72 hours'
      );

    -- 6. nothing left → silence
    if v_elig_count = 0 then
      insert into public.game_master_runs (
        challenge_id, source, outcome, candidate_count, eligible_count,
        diagnostics, completed_at
      )
      values (
        p_challenge_id, p_source, 'silence', v_cand_count, 0,
        jsonb_build_object('reason', 'no_eligible_candidate'), now()
      );
      return null;
    end if;

    -- 7. weighted candidate selection using score^2
    with e as (
      select value as c, (value ->> 'score')::numeric as sc
      from jsonb_array_elements(v_eligible) value
    ),
    w as (
      select c, power(sc, 2) as wt from e
    ),
    cum as (
      select c,
             sum(wt) over (order by c ->> 'fingerprint'
               rows between unbounded preceding and current row) as running,
             sum(wt) over () as total
      from w
    )
    select c into v_chosen
    from cum
    where running >= v_sel_roll * total
    order by running
    limit 1;

    v_family     := v_chosen ->> 'family';
    v_visibility := v_chosen ->> 'visibility';
    v_subject    := nullif(v_chosen ->> 'subject_user_id', '')::uuid;
    v_score      := (v_chosen ->> 'score')::numeric;
    v_payload    := v_chosen -> 'payload';

    -- 8. template selection honouring template + once_per_subject cooldowns
    with t as (
      select tpl.id,
             tpl.weight * power(tpl.final_weight, greatest(0, v_esc - 0.7)) as eff_wt
      from public.game_master_templates tpl
      where tpl.family = v_family
        and tpl.visibility = v_visibility
        and tpl.enabled
        and not exists (
          select 1 from public.game_master_events e
          where e.template_id = tpl.id
            and e.challenge_id = p_challenge_id
            and e.created_at > now() - make_interval(hours => tpl.cooldown_hours)
        )
        and (
          not tpl.once_per_subject
          or not exists (
            select 1 from public.game_master_events e
            where e.template_id = tpl.id
              and e.challenge_id = p_challenge_id
              and e.subject_user_id is not distinct from v_subject
          )
        )
    ),
    cum as (
      select id,
             sum(eff_wt) over (order by id
               rows between unbounded preceding and current row) as running,
             sum(eff_wt) over () as total
      from t
    )
    select id into v_template_id
    from cum
    where running >= v_tpl_roll * total
    order by running
    limit 1;

    if v_template_id is null then
      insert into public.game_master_runs (
        challenge_id, source, outcome, candidate_count, eligible_count,
        diagnostics, completed_at
      )
      values (
        p_challenge_id, p_source, 'silence', v_cand_count, v_elig_count,
        jsonb_build_object('reason', 'no_eligible_template',
          'family', v_family, 'visibility', v_visibility, 'score', v_score),
        now()
      );
      return null;
    end if;

    select * into v_template
    from public.game_master_templates
    where id = v_template_id;

    -- 9. emission probability
    v_prob := least(0.60, greatest(0.05,
      ((v_score - 30) / 180.0) * v_intensity * v_esc));

    if v_emit_roll >= v_prob then
      insert into public.game_master_runs (
        challenge_id, source, outcome, candidate_count, eligible_count,
        diagnostics, completed_at
      )
      values (
        p_challenge_id, p_source, 'silence', v_cand_count, v_elig_count,
        jsonb_build_object('reason', 'emission_roll_lost',
          'family', v_family, 'score', v_score, 'probability', v_prob,
          'roll', v_emit_roll),
        now()
      );
      return null;
    end if;

    -- 10..11. render + freeze the event
    insert into public.game_master_events (
      challenge_id, family, visibility, subject_user_id, template_id, severity,
      title_text, body_text, payload, archive, status, starts_at, expires_at
    )
    values (
      p_challenge_id, v_family, v_visibility, v_subject, v_template.id,
      v_template.severity,
      public._game_master_render(v_template.title_template, v_payload),
      public._game_master_render(v_template.body_template, v_payload),
      v_payload,
      case when v_visibility = 'private' then false
           else v_template.archive and coalesce(v_settings.archive_enabled, false) end,
      'active', now(), now() + interval '14 days'
    )
    returning id into v_event_id;

    -- 12. run row
    insert into public.game_master_runs (
      challenge_id, source, outcome, candidate_count, eligible_count,
      selected_event_id, diagnostics, completed_at
    )
    values (
      p_challenge_id, p_source, 'event', v_cand_count, v_elig_count, v_event_id,
      jsonb_build_object('family', v_family, 'visibility', v_visibility,
        'score', v_score, 'probability', v_prob, 'selection_roll', v_sel_roll,
        'template_id', v_template.id, 'severity', v_template.severity),
      now()
    );

    -- 13. major memory: streak_collapse for a broken >= 14 run is already
    -- written idempotently in _game_master_candidates. Nothing else in GM1.

    return v_event_id;

  exception when others then
    -- ISOLATION GUARANTEE: swallow, record, never propagate.
    insert into public.game_master_runs (
      challenge_id, source, outcome, candidate_count, eligible_count,
      diagnostics, completed_at
    )
    values (
      p_challenge_id, p_source, 'error', v_cand_count, v_elig_count,
      jsonb_build_object('error', left(coalesce(sqlerrm, 'unknown'), 300)), now()
    );
    return null;
  end;
end;
$$;

comment on function public._run_game_master_pulse(uuid, text, numeric) is
  'One Game Master pulse decision. Reads authoritative state, filters, weighted-'
  'selects <=1 candidate + template, rolls emission, freezes an event or records '
  'silence. Records exactly one game_master_runs row per call. Swallows every '
  'error into an outcome=error run row — NEVER re-raises. Internal — the public '
  'wrapper always passes p_forced_roll = NULL; the parameter exists only for '
  'deterministic tests and has no app-role EXECUTE.';

revoke all on function public._run_game_master_pulse(uuid, text, numeric)
  from public, anon, authenticated;

-- ============================================================================
-- 7. Authenticated RPC — request a best-effort pulse (challenge_id ONLY)
-- ============================================================================
create or replace function public.request_game_master_pulse(p_challenge_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then
    raise exception 'Du måste vara inloggad';
  end if;

  if not (
    public.is_admin()
    or exists (
      select 1 from public.challenge_memberships m
      where m.challenge_id = p_challenge_id
        and m.user_id = uid
        and m.active
    )
  ) then
    raise exception 'Du är inte deltagare i den här utmaningen';
  end if;

  -- Server-side minimum request interval. Client spam is harmless: just NULL.
  if exists (
    select 1 from public.game_master_runs r
    where r.challenge_id = p_challenge_id
      and r.source = 'event'
      and r.started_at > now() - interval '90 seconds'
  ) then
    return null;
  end if;

  return public._run_game_master_pulse(p_challenge_id, 'event', null);
end;
$$;

comment on function public.request_game_master_pulse(uuid) is
  'Best-effort Game Master pulse requested by the browser after a successful '
  'core action. Accepts ONLY a challenge id — never a victim, template, score or '
  'text. Server owns all randomness and throttling. Returns the emitted event id '
  'or NULL (silence / throttled / disabled).';

revoke all on function public.request_game_master_pulse(uuid) from public, anon;
grant execute on function public.request_game_master_pulse(uuid) to authenticated;

-- ============================================================================
-- 8. Authenticated RPC — mark an event seen / dismissed (own visibility only)
-- ============================================================================
create or replace function public.mark_game_master_event_seen(
  p_event_id uuid,
  p_dismiss  boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then
    raise exception 'Du måste vara inloggad';
  end if;

  -- The caller must currently be able to SELECT the event — same predicate as
  -- the game_master_events_select RLS policy (0015). A user can never mark
  -- another user's private event.
  if not exists (
    select 1 from public.game_master_events e
    where e.id = p_event_id
      and (
        public.is_admin()
        or (e.visibility = 'public'  and e.status <> 'cancelled'
            and public.is_challenge_member(e.challenge_id))
        or (e.visibility = 'private' and e.status <> 'cancelled'
            and e.subject_user_id = uid)
      )
  ) then
    raise exception 'Händelsen finns inte eller är inte synlig för dig';
  end if;

  insert into public.game_master_event_views as v
    (event_id, user_id, first_seen_at, dismissed_at)
  values (p_event_id, uid, now(), case when p_dismiss then now() else null end)
  on conflict (event_id, user_id) do update
    set dismissed_at = case when p_dismiss then now() else v.dismissed_at end
    where p_dismiss;
end;
$$;

comment on function public.mark_game_master_event_seen(uuid, boolean) is
  'Records that the current user has seen (and optionally dismissed) a Game '
  'Master event they can currently read. Stops a browser refresh replaying an '
  'ambush. Cannot touch another user''s private event.';

revoke all on function public.mark_game_master_event_seen(uuid, boolean) from public, anon;
grant execute on function public.mark_game_master_event_seen(uuid, boolean) to authenticated;

-- ============================================================================
-- 9. Admin RPC — settings emergency brake (audited)
-- ============================================================================
create or replace function public.update_game_master_settings(
  p_challenge_id           uuid,
  p_enabled                boolean,
  p_private_roasts_enabled boolean,
  p_public_roasts_enabled  boolean,
  p_archive_enabled        boolean,
  p_intensity              text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid      uuid := (select auth.uid());
  v_before jsonb;
  v_after  jsonb;
begin
  if not ((uid is null) or public.is_admin()) then
    raise exception 'Endast administratörer får ändra Game Master-inställningar';
  end if;
  if p_intensity is null or p_intensity not in ('low', 'normal', 'high') then
    raise exception 'Ogiltig intensitet: %', coalesce(p_intensity, 'null');
  end if;
  if not exists (select 1 from public.challenges where id = p_challenge_id) then
    raise exception 'Utmaningen finns inte';
  end if;

  select to_jsonb(s) into v_before
  from public.game_master_settings s
  where s.challenge_id = p_challenge_id;

  insert into public.game_master_settings (
    challenge_id, enabled, private_roasts_enabled, public_roasts_enabled,
    archive_enabled, intensity
  )
  values (
    p_challenge_id, p_enabled, p_private_roasts_enabled, p_public_roasts_enabled,
    p_archive_enabled, p_intensity
  )
  on conflict (challenge_id) do update
    set enabled                = excluded.enabled,
        private_roasts_enabled = excluded.private_roasts_enabled,
        public_roasts_enabled  = excluded.public_roasts_enabled,
        archive_enabled        = excluded.archive_enabled,
        intensity              = excluded.intensity;

  select to_jsonb(s) into v_after
  from public.game_master_settings s
  where s.challenge_id = p_challenge_id;

  insert into public.audit_log (
    actor_user_id, challenge_id, entity_type, entity_id, action,
    before_data, after_data
  )
  values (
    uid, p_challenge_id, 'game_master_settings', p_challenge_id,
    'game_master_settings_changed', v_before, v_after
  );
end;
$$;

comment on function public.update_game_master_settings(uuid, boolean, boolean, boolean, boolean, text) is
  'Admin emergency brake: upsert the per-challenge Game Master settings row and '
  'write the audit trail. Admin only (null-uid break-glass allowed like the '
  'other admin RPCs).';

revoke all on function public.update_game_master_settings(uuid, boolean, boolean, boolean, boolean, text)
  from public, anon;
grant execute on function public.update_game_master_settings(uuid, boolean, boolean, boolean, boolean, text)
  to authenticated;

-- ============================================================================
-- 10. Admin RPC — cancel / hide an event, mandatory reason (audited)
-- ============================================================================
create or replace function public.cancel_game_master_event(
  p_event_id uuid,
  p_reason   text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid     uuid := (select auth.uid());
  v_ev    public.game_master_events;
  v_actor uuid;
begin
  if not ((uid is null) or public.is_admin()) then
    raise exception 'Endast administratörer får dölja en Game Master-händelse';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Ange en anledning';
  end if;

  select * into v_ev from public.game_master_events where id = p_event_id for update;
  if v_ev.id is null then
    raise exception 'Händelsen finns inte';
  end if;
  if v_ev.status = 'cancelled' then
    raise exception 'Händelsen är redan dold';
  end if;

  -- The cancelled-coherence CHECK needs cancelled_by NOT NULL. uid is only null
  -- on a no-JWT break-glass backend call — fall back like the retroactive RPCs.
  v_actor := coalesce(
    uid,
    v_ev.subject_user_id,
    (select p.id from public.profiles p
     where p.role = 'admin' and p.active order by p.created_at limit 1)
  );

  update public.game_master_events
    set status           = 'cancelled',
        cancelled_at     = now(),
        cancelled_by     = v_actor,
        cancelled_reason = btrim(p_reason)
  where id = p_event_id;

  insert into public.audit_log (
    actor_user_id, challenge_id, target_user_id, entity_type, entity_id, action,
    before_data, after_data, note
  )
  values (
    uid, v_ev.challenge_id, v_ev.subject_user_id, 'game_master_event', p_event_id,
    'game_master_event_cancelled',
    jsonb_build_object('family', v_ev.family, 'visibility', v_ev.visibility,
      'severity', v_ev.severity, 'status', v_ev.status),
    jsonb_build_object('status', 'cancelled'),
    btrim(p_reason)
  );
end;
$$;

comment on function public.cancel_game_master_event(uuid, text) is
  'Admin: hide an inappropriate Game Master event. Mandatory reason, audited. '
  'A cancelled event disappears from every non-admin SELECT (0015 RLS) and can '
  'never be re-emitted (fingerprint match). Audit rows carry no roast text.';

revoke all on function public.cancel_game_master_event(uuid, text) from public, anon;
grant execute on function public.cancel_game_master_event(uuid, text) to authenticated;

-- ============================================================================
-- 11. Scheduled dispatcher (plan Task 3 Step 4)
--
-- Hourly pg_cron job. For every active challenge with Game Master enabled, run
-- a scheduled pulse only in local hour 08 or 20, at most once per local
-- {date, hour} window. One challenge failing NEVER aborts the loop.
-- ============================================================================
create or replace function public._game_master_tick_all()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c            record;
  v_local_hour integer;
  v_local_date date;
begin
  for c in
    select ch.id, ch.timezone
    from public.challenges ch
    join public.game_master_settings s on s.challenge_id = ch.id
    where ch.status = 'active'
      and s.enabled
  loop
    begin
      v_local_hour := extract(hour from (now() at time zone c.timezone))::int;
      v_local_date := (now() at time zone c.timezone)::date;

      if v_local_hour not in (8, 20) then
        continue;
      end if;

      -- Dedupe: already ran a scheduled pulse this local date + hour?
      if exists (
        select 1 from public.game_master_runs r
        where r.challenge_id = c.id
          and r.source = 'scheduled'
          and (r.started_at at time zone c.timezone)::date = v_local_date
          and extract(hour from (r.started_at at time zone c.timezone))::int = v_local_hour
      ) then
        continue;
      end if;

      perform public._run_game_master_pulse(c.id, 'scheduled', null);

    exception when others then
      -- Never let one challenge abort the others.
      insert into public.game_master_runs (
        challenge_id, source, outcome, diagnostics, completed_at
      )
      values (
        c.id, 'scheduled', 'error',
        jsonb_build_object('error', 'tick: ' || left(coalesce(sqlerrm, 'unknown'), 200)),
        now()
      );
    end;
  end loop;
end;
$$;

comment on function public._game_master_tick_all() is
  'Hourly pg_cron dispatcher: runs a scheduled Game Master pulse for each active '
  'enabled challenge, but only in its local hour 08 / 20 and at most once per '
  'local window. Per-challenge errors are recorded, never propagated. Internal — '
  'no app-role EXECUTE (cron runs as the table owner).';

revoke all on function public._game_master_tick_all() from public, anon, authenticated;

-- ---- pg_cron wiring --------------------------------------------------------
-- Guarded so the migration chain NEVER breaks in an environment without pg_cron
-- preloaded. The dispatcher function above exists unconditionally (tests call
-- it directly); only the schedule is best-effort.
do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule(
    'halsoutmaningen-game-master-hourly',
    '17 * * * *',
    'select public._game_master_tick_all();'
  );
  raise notice 'game master: hourly pg_cron dispatcher scheduled';
exception when others then
  raise notice 'game master: pg_cron unavailable (%), scheduled dispatcher not registered — _game_master_tick_all() still exists and can be driven externally', sqlerrm;
end
$$;
