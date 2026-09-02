-- ============================================================================
-- Hälsoutmaningen — Phase 9 / 0005  multiple training sessions per day
--
-- Depends on 0001–0002. Forward-only, non-destructive.
--
-- Pre-Phase-9 the schema allowed exactly one `training_entries` row per
-- (challenge, user, challenge_date). "Dubbelpass" and honest multi-session days
-- need genuinely separate sessions. This migration:
--   * adds `session_seq` (1-based ordinal within a participant-day)
--   * backfills every existing row to session_seq = 1 (they are already unique
--     per day, so nothing changes for them)
--   * replaces UNIQUE(challenge,user,date) with
--     UNIQUE(challenge,user,date,session_seq)
--   * teaches `training_entries_guard` that "current day only / membership
--     active / challenge active" apply per *session*, and identity columns now
--     also include session_seq
--   * adds `add_training_session()` — the concurrency-safe way to append an
--     extra session for today.
--
-- The existing client `submitTraining()` upsert keeps working unchanged: it
-- targets session_seq = 1 (the day's primary session).
-- ============================================================================

alter table public.training_entries
  add column if not exists session_seq smallint not null default 1;

update public.training_entries set session_seq = 1 where session_seq is null;

alter table public.training_entries
  add constraint training_entries_session_seq_positive
  check (session_seq >= 1 and session_seq <= 20);

-- Swap the day-uniqueness constraint for a session-uniqueness one.
alter table public.training_entries
  drop constraint if exists training_entries_unique_day;

alter table public.training_entries
  add constraint training_entries_unique_session
  unique (challenge_id, user_id, challenge_date, session_seq);

comment on column public.training_entries.session_seq is
  '1-based ordinal of this session within (challenge,user,challenge_date). '
  'Gaps are allowed (deleting session 2 of 3 leaves 1 and 3). The client''s '
  'primary "log today" path always uses 1; extra sessions come from '
  'add_training_session().';

-- ----------------------------------------------------------------------------
-- Guard: session_seq joins the immutable identity columns; every per-session
-- eligibility rule is unchanged (they were always evaluated per row).
-- ----------------------------------------------------------------------------
create or replace function public.training_entries_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid            uuid    := (select auth.uid());
  is_admin_actor boolean := (uid is null) or public.is_admin();
  c_status       text;
  today          date;
  m_active       boolean;
  eff_start      date;
  eff_end        date;
begin
  if tg_op = 'DELETE' then
    if not is_admin_actor then
      if old.user_id <> uid then
        raise exception 'You may only delete your own training entry';
      end if;
      if old.challenge_date <> public.challenge_current_date(old.challenge_id) then
        raise exception 'A training entry can only be deleted on its own challenge day';
      end if;
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' then
    if new.challenge_id   is distinct from old.challenge_id
    or new.user_id        is distinct from old.user_id
    or new.challenge_date is distinct from old.challenge_date
    or new.session_seq    is distinct from old.session_seq then
      raise exception 'challenge_id, user_id, challenge_date and session_seq are immutable';
    end if;
    if not is_admin_actor then
      if old.user_id <> uid then
        raise exception 'You may only edit your own training entry';
      end if;
      if new.status is distinct from old.status
      or new.invalidated_reason is distinct from old.invalidated_reason
      or new.invalidated_by is distinct from old.invalidated_by
      or new.invalidated_at is distinct from old.invalidated_at then
        raise exception 'Only an administrator may invalidate an entry';
      end if;
      if old.challenge_date <> public.challenge_current_date(old.challenge_id) then
        raise exception 'A training entry can only be edited on its own challenge day';
      end if;
    end if;
    return new;
  end if;

  -- INSERT
  select status into c_status from public.challenges where id = new.challenge_id;
  today := public.challenge_current_date(new.challenge_id);

  select m.active,
         greatest(c.start_date, m.participation_start_date),
         least(c.end_date, coalesce(m.participation_end_date, c.end_date))
    into m_active, eff_start, eff_end
  from public.challenge_memberships m
  join public.challenges c on c.id = m.challenge_id
  where m.challenge_id = new.challenge_id and m.user_id = new.user_id;

  if eff_start is null then
    raise exception 'No challenge membership for this participant';
  end if;

  if new.challenge_date < eff_start or new.challenge_date > eff_end then
    raise exception 'Challenge date % is outside the participation window %..%',
      new.challenge_date, eff_start, eff_end;
  end if;

  if not is_admin_actor then
    if new.user_id <> uid then
      raise exception 'You may only log your own training';
    end if;
    if c_status <> 'active' then
      raise exception 'Challenge is not active';
    end if;
    if not coalesce(m_active, false) then
      raise exception 'Your challenge membership is not active';
    end if;
    if new.challenge_date <> today then
      raise exception 'Participants may only log training for the current challenge day (%)', today;
    end if;
    if new.status <> 'active' then
      raise exception 'Participants may not create invalidated entries';
    end if;
  end if;

  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- add_training_session — append an extra session for the current challenge day.
-- Concurrency-safe: retries on the session_seq unique collision.
-- ----------------------------------------------------------------------------
create or replace function public.add_training_session(
  p_challenge_id     uuid,
  p_duration_minutes integer,
  p_activity         text default null,
  p_note             text default null
)
returns public.training_entries
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid       uuid := (select auth.uid());
  v_today   date;
  v_seq     smallint;
  v_row     public.training_entries;
  v_tries   int := 0;
begin
  if uid is null then
    raise exception 'add_training_session requires an authenticated session';
  end if;

  v_today := public.challenge_current_date(p_challenge_id);

  loop
    select coalesce(max(session_seq), 0) + 1 into v_seq
    from public.training_entries
    where challenge_id = p_challenge_id
      and user_id = uid
      and challenge_date = v_today;

    begin
      insert into public.training_entries (
        challenge_id, user_id, challenge_date, session_seq,
        duration_minutes, activity, note
      )
      values (
        p_challenge_id, uid, v_today, v_seq,
        p_duration_minutes,
        nullif(btrim(p_activity), ''),
        nullif(btrim(p_note), '')
      )
      returning * into v_row;
      return v_row;
    exception when unique_violation then
      v_tries := v_tries + 1;
      if v_tries > 20 then
        raise exception 'Kunde inte skapa passet, försök igen';
      end if;
    end;
  end loop;
end;
$$;

revoke all on function public.add_training_session(uuid, integer, text, text)
  from public, anon;
grant execute on function public.add_training_session(uuid, integer, text, text)
  to authenticated;

comment on function public.add_training_session is
  'Append an extra training session for the caller on the current challenge '
  'day. The guard trigger still enforces every eligibility rule; this only '
  'assigns the next session_seq atomically.';
