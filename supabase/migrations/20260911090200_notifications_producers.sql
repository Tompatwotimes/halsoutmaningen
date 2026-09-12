-- ============================================================================
-- Hälsoutmaningen — PWA + Web Push Notifications V1 / 0033  producer hooks
--
-- Spec: docs/superpowers/specs/2026-09-11-pwa-push-v1-design.md §3
-- Plan: docs/superpowers/plans/2026-09-11-pwa-push-v1.md (Task 3)
--
-- Depends on 0031–0032. Forward-only, ADDITIVE. Every producer below is a
-- brand-new AFTER trigger (or a new column with a table default) on an
-- existing table — no existing function body is modified, mirroring how
-- tg_training_entry_chat_card (20260907120000) and tg_chat_activity_fanout
-- (20260905140200) were bolted onto chat_messages/training_entries without
-- touching post_chat_message / the training RPCs.
--
--   _notification_eligible_members(challenge, exclude?)   shared audience helper
--   _enqueue_notification(...)                             shared insert helper
--
--   tg_notify_chat_reply           AFTER INSERT chat_messages
--   tg_notify_chat_like            AFTER INSERT chat_message_likes
--   tg_notify_chat_all             AFTER INSERT chat_messages
--   tg_notify_straffbanken         AFTER INSERT penalty_assignments
--   game_master_events.push_enabled (new column, default true)
--   tg_notify_game_master          AFTER INSERT game_master_events
--   tg_notify_daily_first_completed AFTER INSERT training_entries
--   tg_notify_personal_status      AFTER UPDATE retroactive_training_requests
--
-- No producer ever quotes a chat body, note, or proof path in a push payload
-- (spec §2, "never a signed image URL / never quote the message body
-- verbatim") — every title/body below is fixed, category-generic Swedish
-- copy. Every producer respects challenges.push_enabled and the recipient's
-- notification_preferences (defaulting to the column default when no
-- preference row exists yet — get_notification_preferences materialises the
-- same defaults for the read side).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- _notification_eligible_members — active, currently-eligible members of a
-- challenge today, optionally excluding one user (the actor). Mirrors the
-- eligibility shape already used by _game_master_candidates (20260904130100)
-- and _retroactive_request_eligibility_check (20260904100100).
-- ----------------------------------------------------------------------------
create or replace function public._notification_eligible_members(
  p_challenge_id     uuid,
  p_exclude_user_id  uuid default null,
  p_as_of_date       date default null
)
returns table (user_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select m.user_id
  from public.challenge_memberships m
  join public.challenges c on c.id = m.challenge_id
  where m.challenge_id = p_challenge_id
    and m.active
    and (p_exclude_user_id is null or m.user_id <> p_exclude_user_id)
    and greatest(c.start_date, m.participation_start_date)
          <= coalesce(p_as_of_date, (now() at time zone c.timezone)::date)
    and least(c.end_date, coalesce(m.participation_end_date, c.end_date))
          >= coalesce(p_as_of_date, (now() at time zone c.timezone)::date);
$$;

revoke all on function public._notification_eligible_members(uuid, uuid, date)
  from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- _enqueue_notification — the one insert path every producer uses.
-- Silently does nothing if the challenge has push disabled; the natural-key
-- unique index handles dedupe (on conflict do nothing).
-- ----------------------------------------------------------------------------
create or replace function public._enqueue_notification(
  p_challenge_id       uuid,
  p_recipient_id       uuid,
  p_category           text,
  p_natural_key        text,
  p_title              text,
  p_body               text,
  p_url                text,
  p_tag                text,
  p_not_before         timestamptz default now(),
  p_source_message_id  uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.challenges c
    where c.id = p_challenge_id and c.push_enabled
  ) then
    return;
  end if;

  insert into public.notification_outbox
    (challenge_id, recipient_id, category, natural_key, title, body, url, tag,
     not_before, source_message_id)
  values
    (p_challenge_id, p_recipient_id, p_category, p_natural_key, p_title, p_body, p_url, p_tag,
     p_not_before, p_source_message_id)
  on conflict (challenge_id, recipient_id, category, natural_key) do nothing;
end;
$$;

revoke all on function public._enqueue_notification(
  uuid, uuid, text, text, text, text, text, text, timestamptz, uuid
) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 1. Chat reply
-- ----------------------------------------------------------------------------
create or replace function public.tg_notify_chat_reply()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent_sender uuid;
  v_pref          boolean;
begin
  if new.reply_to_message_id is null then
    return null;
  end if;

  select c.sender_user_id into v_parent_sender
  from public.chat_messages c
  where c.id = new.reply_to_message_id;

  -- No parent, GM parent (no user), or a self-reply: nothing to notify.
  if v_parent_sender is null or v_parent_sender = new.sender_user_id then
    return null;
  end if;

  select coalesce(np.chat_reply, true) into v_pref
  from public.notification_preferences np
  where np.user_id = v_parent_sender and np.challenge_id = new.challenge_id;

  if coalesce(v_pref, true) then
    perform public._enqueue_notification(
      new.challenge_id, v_parent_sender, 'chat_reply', new.id::text,
      'Nytt svar', 'Någon svarade på ditt meddelande i chatten.',
      '/?chat=1&seq=' || new.seq::text, 'chat-reply-' || new.reply_to_message_id::text,
      p_source_message_id := new.id
    );
  end if;

  return null;
end;
$$;

revoke all on function public.tg_notify_chat_reply() from public, anon, authenticated;

create trigger chat_messages_notify_reply
  after insert on public.chat_messages
  for each row execute function public.tg_notify_chat_reply();

-- ----------------------------------------------------------------------------
-- 2. Chat like
-- ----------------------------------------------------------------------------
create or replace function public.tg_notify_chat_like()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_message_owner uuid;
  v_challenge     uuid;
  v_seq           bigint;
  v_pref          boolean;
begin
  select c.sender_user_id, c.challenge_id, c.seq
    into v_message_owner, v_challenge, v_seq
  from public.chat_messages c
  where c.id = new.message_id;

  if v_message_owner is null or v_message_owner = new.user_id then
    return null;
  end if;

  select coalesce(np.chat_like, true) into v_pref
  from public.notification_preferences np
  where np.user_id = v_message_owner and np.challenge_id = v_challenge;

  if coalesce(v_pref, true) then
    -- Natural key is (message, liker) ONLY — deliberately no timestamp.
    -- `chat_message_likes` has no `liked` boolean to update in place: an
    -- unlike is a DELETE and a re-like is a fresh INSERT (see
    -- 20260908120000's set_chat_message_like), so this trigger fires again
    -- on every re-like with a NEW created_at. Keying on the timestamp would
    -- let a like/unlike/like/unlike/like cycle enqueue a fresh row each time
    -- — exactly the abuse case the spec requires "at most ONE like push ever
    -- per (message, liker, owner)" to prevent. Keying on (message, liker)
    -- alone means the SAME outbox row's unique constraint catches every
    -- subsequent re-like as a structural `on conflict do nothing`.
    perform public._enqueue_notification(
      v_challenge, v_message_owner, 'chat_like',
      new.message_id::text || ':' || new.user_id::text,
      'Ny gillning', 'Någon gillade ditt meddelande i chatten.',
      '/?chat=1&seq=' || v_seq::text, 'chat-like-' || new.message_id::text,
      p_source_message_id := new.message_id
    );
  end if;

  return null;
end;
$$;

revoke all on function public.tg_notify_chat_like() from public, anon, authenticated;

create trigger chat_message_likes_notify
  after insert on public.chat_message_likes
  for each row execute function public.tg_notify_chat_like();

-- ----------------------------------------------------------------------------
-- 3. Chat "all messages" (opt-in)
-- ----------------------------------------------------------------------------
create or replace function public.tg_notify_chat_all()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  if new.sender_type <> 'participant' or new.status <> 'active' then
    return null;
  end if;

  for r in
    select np.user_id
    from public.notification_preferences np
    where np.challenge_id = new.challenge_id
      and np.chat_all_messages
      and np.user_id <> new.sender_user_id
      and exists (
        select 1 from public.challenge_memberships m
        where m.challenge_id = new.challenge_id
          and m.user_id = np.user_id
          and m.active
      )
  loop
    perform public._enqueue_notification(
      new.challenge_id, r.user_id, 'chat_all', new.id::text,
      'Nytt meddelande', 'Nytt meddelande i chatten.',
      '/?chat=1&seq=' || new.seq::text, 'chat-all-' || new.id::text,
      p_source_message_id := new.id
    );
  end loop;

  return null;
end;
$$;

revoke all on function public.tg_notify_chat_all() from public, anon, authenticated;

create trigger chat_messages_notify_all
  after insert on public.chat_messages
  for each row execute function public.tg_notify_chat_all();

-- ----------------------------------------------------------------------------
-- 4. Straffbanken (a penalty assignment)
-- ----------------------------------------------------------------------------
create or replace function public.tg_notify_straffbanken()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pref boolean;
begin
  if new.status <> 'active' then
    return null;
  end if;

  select coalesce(np.straffbanken, true) into v_pref
  from public.notification_preferences np
  where np.user_id = new.to_user_id and np.challenge_id = new.challenge_id;

  if coalesce(v_pref, true) then
    perform public._enqueue_notification(
      new.challenge_id, new.to_user_id, 'straffbanken', new.id::text,
      'Ny uppgift i Straffbanken', 'Du har fått en ny uppgift i Straffbanken.',
      '/straffbanken', 'straffbanken-' || new.id::text
    );
  end if;

  return null;
end;
$$;

revoke all on function public.tg_notify_straffbanken() from public, anon, authenticated;

create trigger penalty_assignments_notify
  after insert on public.penalty_assignments
  for each row execute function public.tg_notify_straffbanken();

-- ----------------------------------------------------------------------------
-- 5. Game Master
-- ----------------------------------------------------------------------------
alter table public.game_master_events
  add column push_enabled boolean not null default true;

comment on column public.game_master_events.push_enabled is
  'Whether this frozen event should also enqueue a push notification (0033). '
  'Defaults true for every existing/new event; _run_game_master_pulse never '
  'sets it explicitly, so this is a pure additive default, not a behaviour '
  'change to the emission engine.';

create or replace function public.tg_notify_game_master()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  if new.status <> 'active' or not new.push_enabled then
    return null;
  end if;

  if new.visibility = 'private' then
    if new.subject_user_id is null then
      return null;
    end if;
    if coalesce((
      select np.game_master from public.notification_preferences np
      where np.user_id = new.subject_user_id and np.challenge_id = new.challenge_id
    ), true) then
      perform public._enqueue_notification(
        new.challenge_id, new.subject_user_id, 'game_master', new.id::text,
        'Game Master', 'Game Master har något åt dig.',
        '/', 'gm-' || new.id::text
      );
    end if;
    return null;
  end if;

  -- Public event: every eligible active member.
  for r in select user_id from public._notification_eligible_members(new.challenge_id)
  loop
    if coalesce((
      select np.game_master from public.notification_preferences np
      where np.user_id = r.user_id and np.challenge_id = new.challenge_id
    ), true) then
      perform public._enqueue_notification(
        new.challenge_id, r.user_id, 'game_master', new.id::text,
        'Game Master', 'Game Master har slagit till i gruppen.',
        '/', 'gm-' || new.id::text
      );
    end if;
  end loop;

  return null;
end;
$$;

revoke all on function public.tg_notify_game_master() from public, anon, authenticated;

create trigger game_master_events_notify
  after insert on public.game_master_events
  for each row execute function public.tg_notify_game_master();

-- ----------------------------------------------------------------------------
-- 6. Daily group — first completed day (event-driven, atomic claim)
--
-- Fires only for a LIVE same-day submission: new.challenge_date must equal
-- today (challenge_current_date). A retroactive/backfilled/admin-corrected
-- entry is, by construction, never inserted with today's date as its
-- challenge_date (approve_retroactive_registration always writes the
-- ORIGINAL historical challenge_date — see 20260904100100 §"approve_..."),
-- so no separate "is this retroactive" flag is needed: the date comparison
-- alone is the structural exclusion the spec requires.
-- ----------------------------------------------------------------------------
create or replace function public.tg_notify_daily_first_completed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today     date;
  v_state     text;
  v_claimed   boolean := false;
  r           record;
begin
  if new.status <> 'active' then
    return null;
  end if;

  v_today := public.challenge_current_date(new.challenge_id);
  if new.challenge_date <> v_today then
    return null;
  end if;

  select ds.state into v_state
  from public.challenge_day_states(new.challenge_id, new.user_id) ds
  where ds.challenge_date = v_today;

  if v_state <> 'completed' then
    return null;
  end if;

  insert into public._daily_first_completion_claims (challenge_id, challenge_date, claimed_by)
  values (new.challenge_id, v_today, new.user_id)
  on conflict (challenge_id, challenge_date) do nothing;
  v_claimed := found;

  if not v_claimed then
    return null;
  end if;

  for r in select user_id from public._notification_eligible_members(new.challenge_id, new.user_id)
  loop
    if coalesce((
      select np.daily_group_summary from public.notification_preferences np
      where np.user_id = r.user_id and np.challenge_id = new.challenge_id
    ), true) then
      perform public._enqueue_notification(
        new.challenge_id, r.user_id, 'daily_first_completed', v_today::text,
        'Första passet idag', 'Någon i gruppen har redan tränat idag.',
        '/gruppen', 'daily-first-' || v_today::text
      );
    end if;
  end loop;

  return null;
end;
$$;

revoke all on function public.tg_notify_daily_first_completed() from public, anon, authenticated;

create trigger training_entries_notify_first_completed
  after insert on public.training_entries
  for each row execute function public.tg_notify_daily_first_completed();

-- ----------------------------------------------------------------------------
-- 7. Personal status (retroactive registration decided)
-- ----------------------------------------------------------------------------
create or replace function public.tg_notify_personal_status()
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
  if old.status <> 'pending' or new.status not in ('approved', 'rejected') then
    return null;
  end if;

  select coalesce(np.personal_status, true) into v_pref
  from public.notification_preferences np
  where np.user_id = new.user_id and np.challenge_id = new.challenge_id;

  if not coalesce(v_pref, true) then
    return null;
  end if;

  if new.status = 'approved' then
    v_title := 'Efterregistrering godkänd';
    v_body := 'Din efterregistrering har godkänts.';
  else
    v_title := 'Efterregistrering avslagen';
    v_body := 'Din efterregistrering har avslagits.';
  end if;

  perform public._enqueue_notification(
    new.challenge_id, new.user_id, 'personal_status', new.id::text,
    v_title, v_body, '/oversikt', 'personal-status-' || new.id::text
  );

  return null;
end;
$$;

revoke all on function public.tg_notify_personal_status() from public, anon, authenticated;

create trigger retroactive_training_requests_notify
  after update of status on public.retroactive_training_requests
  for each row execute function public.tg_notify_personal_status();
