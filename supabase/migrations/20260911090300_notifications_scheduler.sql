-- ============================================================================
-- Hälsoutmaningen — PWA + Web Push Notifications V1 / 0034  scheduler + cron
--
-- Spec: docs/superpowers/specs/2026-09-11-pwa-push-v1-design.md §4
-- Plan: docs/superpowers/plans/2026-09-11-pwa-push-v1.md (Task 4)
--
-- Depends on 0031–0033. Forward-only, ADDITIVE.
--
--   _notification_scheduler_tick()   hourly, per-challenge, timezone-aware:
--       - 19:00 / 22:00 local hour window: "you haven't trained today" to
--         every eligible member whose challenge_day_states row for today is
--         'pending' and who wants training_reminders.
--       - 06:30 local hour window: yesterday's group summary to every
--         eligible (as of yesterday) opted-in member.
--   pg_cron registration, guarded exactly like _game_master_tick_all's
--   (20260904130100) — the migration NEVER fails if pg_cron is unavailable.
--
-- The unique index on notification_outbox (challenge_id, recipient_id,
-- category, natural_key) makes a repeat tick inside the same local hour a
-- structural no-op (`on conflict do nothing` inside _enqueue_notification),
-- so this function is safe to run more than once per hour and safe to run
-- manually (the Edge Function self-test / an admin re-trigger).
-- ============================================================================

create or replace function public._notification_scheduler_tick()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c              record;
  v_local_hour   integer;
  v_today        date;
  v_yesterday    date;
  m              record;
  v_state        text;
  v_pref         boolean;
  v_completed    integer;
  v_missed       integer;
  v_total        integer;
begin
  for c in
    select ch.id, ch.timezone, ch.missed_day_cost
    from public.challenges ch
    where ch.status = 'active' and ch.push_enabled
  loop
    begin
      v_local_hour := extract(hour from (now() at time zone c.timezone))::int;
      v_today := (now() at time zone c.timezone)::date;
      v_yesterday := v_today - 1;

      -- ---- 19:00 / 22:00 training reminders --------------------------------
      if v_local_hour in (19, 22) then
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
              case when v_local_hour = 19 then 'training_reminder_19' else 'training_reminder_22' end,
              v_today::text,
              'Dags att träna',
              case when v_local_hour = 19
                then 'Du har inte loggat dagens träning än.'
                else 'Sista chansen att logga dagens träning.'
              end,
              '/logga',
              'training-reminder-' || v_today::text
            );
          end if;
        end loop;
      end if;

      -- ---- 06:30 morning report (yesterday) ---------------------------------
      if v_local_hour = 6 then
        v_completed := 0;
        v_missed := 0;
        v_total := 0;
        for m in select user_id from public._notification_eligible_members(c.id, null, v_yesterday)
        loop
          v_total := v_total + 1;
          select ds.state into v_state
          from public.challenge_day_states(c.id, m.user_id) ds
          where ds.challenge_date = v_yesterday;
          if v_state = 'completed' then
            v_completed := v_completed + 1;
          elsif v_state = 'missed' then
            v_missed := v_missed + 1;
          end if;
        end loop;

        if v_total > 0 then
          for m in select user_id from public._notification_eligible_members(c.id, null, v_today)
          loop
            select coalesce(np.daily_group_summary, true) into v_pref
            from public.notification_preferences np
            where np.user_id = m.user_id and np.challenge_id = c.id;

            if coalesce(v_pref, true) then
              -- Cost total is yesterday's contribution only (v_missed × the
              -- challenge's own configured missed_day_cost) — never a
              -- lifetime/cumulative debt figure, and never a hardcoded SEK
              -- value, since a future challenge may configure a different cost.
              perform public._enqueue_notification(
                c.id, m.user_id, 'daily_morning_report', v_yesterday::text,
                'Gårdagens resultat',
                v_completed::text || ' av ' || v_total::text || ' tränade igår.'
                  || case when v_missed > 0
                       then ' ' || v_missed::text || ' missade dagar kostade '
                            || (v_missed * c.missed_day_cost)::text || ' kr.'
                       else ''
                     end,
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
  'Hourly pg_cron dispatcher: training reminders at local 19:00/22:00, a '
  'yesterday-summary morning report at local 06:30, for every active '
  'push-enabled challenge. Per-challenge errors are recorded, never '
  'propagated. Internal — no app-role EXECUTE (cron runs as the table owner).';

revoke all on function public._notification_scheduler_tick()
  from public, anon, authenticated;

-- ---- pg_cron wiring --------------------------------------------------------
-- Guarded so the migration chain NEVER breaks in an environment without
-- pg_cron preloaded — identical pattern to _game_master_tick_all's wiring.
do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule(
    'halsoutmaningen-notifications-hourly',
    '30 * * * *',
    'select public._notification_scheduler_tick();'
  );
  raise notice 'notifications: hourly pg_cron scheduler tick registered';
exception when others then
  raise notice 'notifications: pg_cron unavailable (%), scheduled tick not registered — _notification_scheduler_tick() still exists and can be driven externally', sqlerrm;
end
$$;
