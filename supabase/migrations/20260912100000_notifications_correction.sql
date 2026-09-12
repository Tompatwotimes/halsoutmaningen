-- ============================================================================
-- Hälsoutmaningen — PWA + Web Push V1 / POST-RELEASE CORRECTION / 0036
--
-- Fixes three verified product gaps in the shipped notification subsystem
-- (20260911090000–20260911090400). Purely additive/replacement — no existing
-- table, RLS policy, RPC signature or app behaviour outside the three items
-- below changes.
--
--   1. Scheduler fired training reminders around 19:30/22:30 instead of
--      19:00/22:00 (the hourly tick's own local-hour check was correct, but
--      the cron minute (:30) meant the FIRST hourly sample after each target
--      hour began landed half an hour late). Fixed by ticking every 5 minutes
--      and checking a bounded local-time window per slot
--      (06:30–06:39 / 19:00–19:09 / 22:00–22:09) instead of a bare hour
--      match. The existing date-keyed natural_key/unique-constraint dedupe is
--      untouched and still makes repeated ticks inside a window safe no-ops.
--
--   2. The 06:30 morning report used a generic "Gårdagens resultat" /
--      count-only body. Replaced with the locked Game Master voice: title
--      "GAME MASTER", body names the missed participants (real display
--      names, Swedish "A, B och C" joining, never silently omitted) and the
--      day's own missed-day cost total; a distinct, restrained copy variant
--      when nobody missed. notification_outbox.body's length cap is widened
--      to 500 (from 300) to give a long missed-name list room without
--      truncation.
--
--   3. Two "important personal status" events from the original locked scope
--      were missing: a participant's OWN training being invalidated/
--      revalidated by an admin correction, and challenge start/completion.
--      Both are new AFTER triggers on the existing authoritative tables
--      (training_entries, challenges) — no existing RPC body is touched.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Widen notification_outbox.body — a long missed-participant name list
--    must never be silently truncated.
-- ----------------------------------------------------------------------------
alter table public.notification_outbox
  drop constraint notification_outbox_body_len;
alter table public.notification_outbox
  add constraint notification_outbox_body_len
  check (char_length(body) between 1 and 500);

-- ----------------------------------------------------------------------------
-- 1. _join_swedish_names — "Filip" / "Filip och David" / "Filip, David och
--    Tomas". Never drops a name.
-- ----------------------------------------------------------------------------
create or replace function public._join_swedish_names(p_names text[])
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when array_length(p_names, 1) is null then ''
    when array_length(p_names, 1) = 1 then p_names[1]
    else array_to_string(p_names[1:array_length(p_names, 1) - 1], ', ')
           || ' och ' || p_names[array_length(p_names, 1)]
  end;
$$;

revoke all on function public._join_swedish_names(text[])
  from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 1b. _notification_local_slot — pure, deterministic slot classification.
--     Extracted out of the scheduler tick itself so its exact boundary
--     behaviour (19:00–19:09, not 19:30) is directly pgTAP-testable without
--     depending on real wall-clock time.
-- ----------------------------------------------------------------------------
create or replace function public._notification_local_slot(
  p_local_hour   integer,
  p_local_minute integer
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_local_hour = 19 and p_local_minute < 10 then 'reminder_19'
    when p_local_hour = 22 and p_local_minute < 10 then 'reminder_22'
    when p_local_hour = 6  and p_local_minute between 30 and 39 then 'morning_report'
    else null
  end;
$$;

comment on function public._notification_local_slot(integer, integer) is
  'Which (if any) scheduler slot a given LOCAL hour/minute falls in. Pure and '
  'now()-independent so pgTAP can prove the exact boundaries deterministically '
  '(e.g. slot(19,30) is null — the fixed 19:30-drift bug — while slot(19,0) '
  'through slot(19,9) are ''reminder_19''). The scheduler tick below is the '
  'only caller and always passes a LOCAL time already converted via '
  '`at time zone <challenge timezone>` — never a bare UTC hour.';

revoke all on function public._notification_local_slot(integer, integer)
  from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 1c. _notification_morning_report_body — pure copy builder, extracted for
--     the same reason: exact Swedish-name-joining and cost-amount copy needs
--     to be pgTAP-testable without depending on real wall-clock time or a
--     specific challenge_day_states fixture.
-- ----------------------------------------------------------------------------
create or replace function public._notification_morning_report_body(
  p_missed_names text[],
  p_amount       integer,
  p_variant      integer
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_missed_names is null or array_length(p_missed_names, 1) is null then
      case p_variant % 3
        when 0 then 'Ingen bommade igår. Julbordet blev utan bidrag. Ovanligt.'
        when 1 then 'Alla tränade igår. Julbordet fick vila.'
        else 'Full pott igår — ingen missade. Sällsynt syn.'
      end
    else
      case p_variant % 3
        when 0 then 'Gårdagens bommar: ' || public._join_swedish_names(p_missed_names)
                       || '. Julbordet tackar för ' || p_amount::text || ' kr.'
        when 1 then public._join_swedish_names(p_missed_names)
                       || ' uteblev igår. Kassan är rikare med ' || p_amount::text || ' kr.'
        else 'Gårdagens missar: ' || public._join_swedish_names(p_missed_names)
                       || '. ' || p_amount::text || ' kr rakt in i Julbordet.'
      end
  end;
$$;

comment on function public._notification_morning_report_body(text[], integer, integer) is
  'Pure Game-Master-voice copy builder for the 06:30 report. Never silently '
  'drops a missed name (public._join_swedish_names joins all of them); the '
  'amount is always p_amount as computed by the caller (missed count × the '
  'challenge''s own missed_day_cost — never hardcoded). p_variant is a '
  'deterministic index (day-of-year, not random) into a restrained 3-entry '
  'bank per case, so the exact copy for a given input is reproducible.';

revoke all on function public._notification_morning_report_body(text[], integer, integer)
  from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. _notification_scheduler_tick — corrected local-time slot windows +
--    Game Master morning-report copy with real missed-participant names.
--
-- Slot design: this function now runs every 5 minutes (cron change below).
-- Each slot is a bounded LOCAL-time window (never a bare UTC offset), wide
-- enough (10 minutes) that a 5-minute tick cadence always lands inside it at
-- least once for any constant challenge UTC offset, including fractional
-- ones (UTC+5:45 etc.) — the window width just needs to exceed the tick
-- period, which it does (10 > 5). The existing natural_key (today/yesterday
-- date, not a slot timestamp) is unchanged, so repeated ticks inside the same
-- window remain a structural on-conflict-do-nothing no-op, and a scheduler
-- outage never causes a stale late send: the check is "is local time inside
-- the window right now", never "how long ago was the window supposed to
-- start".
-- ----------------------------------------------------------------------------
create or replace function public._notification_scheduler_tick()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c              record;
  v_local_hour   integer;
  v_local_minute integer;
  v_slot         text;
  v_today        date;
  v_yesterday    date;
  v_slot_1900    boolean;
  v_slot_2200    boolean;
  v_slot_0630    boolean;
  m              record;
  v_state        text;
  v_pref         boolean;
  v_completed    integer;
  v_missed       integer;
  v_total        integer;
  v_missed_names text[];
  v_amount       integer;
  v_variant      integer;
  v_body         text;
begin
  for c in
    select ch.id, ch.timezone, ch.missed_day_cost
    from public.challenges ch
    where ch.status = 'active' and ch.push_enabled
  loop
    begin
      v_local_hour   := extract(hour   from (now() at time zone c.timezone))::int;
      v_local_minute := extract(minute from (now() at time zone c.timezone))::int;
      v_today        := (now() at time zone c.timezone)::date;
      v_yesterday    := v_today - 1;

      v_slot := public._notification_local_slot(v_local_hour, v_local_minute);
      v_slot_1900 := v_slot = 'reminder_19';
      v_slot_2200 := v_slot = 'reminder_22';
      v_slot_0630 := v_slot = 'morning_report';

      -- ---- 19:00 / 22:00 training reminders --------------------------------
      if v_slot_1900 or v_slot_2200 then
        for m in select user_id from public._notification_eligible_members(c.id, null, v_today)
        loop
          select ds.state into v_state
          from public.challenge_day_states(c.id, m.user_id) ds
          where ds.challenge_date = v_today;

          if v_state <> 'pending' then
            continue;
          end if;

          select coalesce(np.training_reminders, true) into v_pref
          from public.notification_preferences np
          where np.user_id = m.user_id and np.challenge_id = c.id;

          if coalesce(v_pref, true) then
            perform public._enqueue_notification(
              c.id, m.user_id,
              case when v_slot_1900 then 'training_reminder_19' else 'training_reminder_22' end,
              v_today::text,
              'Dags att träna',
              case when v_slot_1900
                then 'Du har inte loggat dagens träning än.'
                else 'Sista chansen att logga dagens träning.'
              end,
              '/logga',
              'training-reminder-' || v_today::text
            );
          end if;
        end loop;
      end if;

      -- ---- 06:30 morning report (yesterday), Game Master voice --------------
      if v_slot_0630 then
        v_completed := 0;
        v_missed := 0;
        v_missed_names := array[]::text[];
        v_total := 0;
        for m in
          select nem.user_id, p.display_name
          from public._notification_eligible_members(c.id, null, v_yesterday) nem
          join public.profiles p on p.id = nem.user_id
        loop
          v_total := v_total + 1;
          select ds.state into v_state
          from public.challenge_day_states(c.id, m.user_id) ds
          where ds.challenge_date = v_yesterday;
          if v_state = 'completed' then
            v_completed := v_completed + 1;
          elsif v_state = 'missed' then
            v_missed := v_missed + 1;
            v_missed_names := v_missed_names || m.display_name;
          end if;
        end loop;

        if v_total > 0 then
          v_amount := v_missed * c.missed_day_cost;
          -- Deterministic (not random) variant pick so the exact copy for a
          -- given challenge/date is reproducible and testable — day-of-year
          -- mod the bank size, never wall-clock-of-send.
          v_variant := extract(doy from v_yesterday)::int % 3;
          v_body := public._notification_morning_report_body(
            case when v_missed > 0 then v_missed_names else null end,
            v_amount, v_variant
          );

          for m in select user_id from public._notification_eligible_members(c.id, null, v_today)
          loop
            select coalesce(np.daily_group_summary, true) into v_pref
            from public.notification_preferences np
            where np.user_id = m.user_id and np.challenge_id = c.id;

            if coalesce(v_pref, true) then
              perform public._enqueue_notification(
                c.id, m.user_id, 'daily_morning_report', v_yesterday::text,
                'GAME MASTER', v_body,
                '/gruppen', 'morning-report-' || v_yesterday::text
              );
            end if;
          end loop;
        end if;
      end if;
    exception when others then
      raise notice 'notification scheduler: challenge % failed (%), continuing', c.id, sqlerrm;
    end;
  end loop;
end;
$$;

comment on function public._notification_scheduler_tick() is
  'Runs every 5 minutes (cron below): training reminders inside the local '
  '19:00–19:09 / 22:00–22:09 windows, a Game-Master-voice yesterday summary '
  '(real missed-participant names, Swedish joining, day-cost total) inside '
  '06:30–06:39, for every active push-enabled challenge. Per-challenge errors '
  'are recorded, never propagated. Internal — no app-role EXECUTE.';

-- ---- pg_cron reschedule: hourly -> every 5 minutes --------------------------
-- cron.schedule() on an EXISTING job name updates its schedule/command in
-- place (same idempotent registration pattern as the original migration) —
-- never drops/recreates the job, never touches any other cron job.
do $$
begin
  perform cron.schedule(
    'halsoutmaningen-notifications-hourly',
    '*/5 * * * *',
    'select public._notification_scheduler_tick();'
  );
  raise notice 'notifications: scheduler tick cadence updated to every 5 minutes';
exception when others then
  raise notice 'notifications: pg_cron unavailable (%), cadence not updated — _notification_scheduler_tick() still exists and can be driven externally', sqlerrm;
end
$$;

-- ----------------------------------------------------------------------------
-- 3. Personal status — training invalidated/revalidated by an admin
--    correction. Hooks the existing authoritative RPCs' single write path
--    (training_entries.status) rather than modifying invalidate_training_
--    session / revalidate_training_session themselves.
--
--    natural_key includes clock_timestamp() — NOT now()/updated_at, which is
--    fixed for the whole enclosing transaction and would collide if two
--    corrections on the same entry happened inside one transaction (e.g. an
--    admin batch-correction, or two RPC calls a test wraps together): unlike
--    the chat-like dedupe key fixed earlier, each invalidate/revalidate here
--    is a rare, trusted, deliberate ADMIN action — a second real correction
--    on the same entry is a genuinely new event the participant should be
--    told about, not abuse to collapse away.
-- ----------------------------------------------------------------------------
create or replace function public.tg_notify_training_invalidation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pref  boolean;
  v_title text;
  v_body  text;
begin
  if new.status = old.status then
    return null;
  end if;
  if not (
    (old.status = 'active' and new.status = 'invalidated')
    or (old.status = 'invalidated' and new.status = 'active')
  ) then
    return null;
  end if;

  select coalesce(np.personal_status, true) into v_pref
  from public.notification_preferences np
  where np.user_id = new.user_id and np.challenge_id = new.challenge_id;

  if not coalesce(v_pref, true) then
    return null;
  end if;

  if new.status = 'invalidated' then
    v_title := 'Träningspass ogiltigförklarat';
    v_body := 'Ett träningspass du loggat har ogiltigförklarats av en administratör.';
  else
    v_title := 'Träningspass återställt';
    v_body := 'Ett tidigare ogiltigförklarat träningspass har återställts.';
  end if;

  perform public._enqueue_notification(
    new.challenge_id, new.user_id, 'personal_status',
    new.id::text || ':' || new.status || ':' || clock_timestamp()::text,
    v_title, v_body, '/oversikt', 'personal-status-training-' || new.id::text
  );

  return null;
end;
$$;

revoke all on function public.tg_notify_training_invalidation()
  from public, anon, authenticated;

create trigger training_entries_notify_invalidation
  after update of status on public.training_entries
  for each row execute function public.tg_notify_training_invalidation();

-- ----------------------------------------------------------------------------
-- 4. Personal status — challenge starts / completes. AFTER trigger on
--    challenges, distinct from challenges_guard (BEFORE, sets activated_at/
--    completed_at) and challenges_audit (AFTER, generic audit log) — neither
--    touched.
-- ----------------------------------------------------------------------------
create or replace function public.tg_notify_challenge_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r          record;
  v_title    text;
  v_body     text;
  v_key      text;
begin
  if new.status = old.status then
    return null;
  end if;

  if old.status = 'draft' and new.status = 'active' then
    v_title := 'Utmaningen har startat';
    v_body := new.name || ' har startat. Lycka till!';
    -- clock_timestamp(), not activated_at/now(): a challenge can only leave
    -- 'draft' once, so this specific branch can't naturally repeat, but using
    -- the real invocation-time clock (not the transaction-fixed now()) keeps
    -- this consistent with the completed branch below and immune to two
    -- lifecycle changes ever colliding inside one transaction.
    v_key := 'started:' || clock_timestamp()::text;
  elsif old.status = 'active' and new.status = 'completed' then
    v_title := 'Utmaningen är slut';
    v_body := new.name || ' är nu avslutad. Bra jobbat!';
    -- completed_at is NOT idempotent across a reopen→re-complete cycle (it is
    -- reset every time status becomes 'completed') — use clock_timestamp()
    -- so re-completing after a reopen always notifies once more, even if
    -- both transitions somehow happened in the same transaction.
    v_key := 'completed:' || clock_timestamp()::text;
  else
    return null;
  end if;

  for r in select user_id from public._notification_eligible_members(new.id)
  loop
    if coalesce((
      select np.personal_status from public.notification_preferences np
      where np.user_id = r.user_id and np.challenge_id = new.id
    ), true) then
      perform public._enqueue_notification(
        new.id, r.user_id, 'personal_status',
        new.id::text || ':' || v_key,
        v_title, v_body, '/', 'challenge-lifecycle-' || new.id::text || ':' || new.status
      );
    end if;
  end loop;

  return null;
end;
$$;

revoke all on function public.tg_notify_challenge_lifecycle()
  from public, anon, authenticated;

create trigger challenges_notify_lifecycle
  after update of status on public.challenges
  for each row execute function public.tg_notify_challenge_lifecycle();
