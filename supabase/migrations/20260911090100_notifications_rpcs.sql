-- ============================================================================
-- Hälsoutmaningen — PWA + Web Push Notifications V1 / 0032  subscription +
--                                                            preference RPCs
--
-- Spec: docs/superpowers/specs/2026-09-11-pwa-push-v1-design.md §2, §6
-- Plan: docs/superpowers/plans/2026-09-11-pwa-push-v1.md (Task 2)
--
-- Depends on 0031. Forward-only. All SECURITY DEFINER, search_path='',
-- schema-qualified, EXECUTE revoked from public/anon, granted to
-- authenticated only — the house convention.
--
--   register_push_subscription(endpoint, p256dh, auth_key, user_agent?)
--       Upserts the caller's PushSubscription. Re-registering the same
--       endpoint (e.g. the browser renews it) just refreshes last_seen_at /
--       keys and un-retires it — never creates a duplicate row.
--   unregister_push_subscription(endpoint)
--       Removes the caller's own subscription (logout / explicit disable).
--       No-op if the endpoint does not belong to the caller or does not exist.
--   get_notification_preferences(challenge_id)
--       Returns the caller's preference row for the challenge, materialising
--       the table defaults on first read (never writes unless updating).
--   update_notification_preferences(challenge_id, ...booleans)
--       Upserts the caller's own preference row. Every boolean parameter
--       defaults to NULL meaning "leave unchanged" so a partial update from
--       the UI never resets the other toggles.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- register_push_subscription
-- ----------------------------------------------------------------------------
create or replace function public.register_push_subscription(
  p_endpoint   text,
  p_p256dh     text,
  p_auth_key   text,
  p_user_agent text default null
)
returns public.push_subscriptions
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid   uuid := (select auth.uid());
  v_row public.push_subscriptions;
begin
  if uid is null then
    raise exception 'Du måste vara inloggad';
  end if;
  if coalesce(btrim(p_endpoint), '') = '' then
    raise exception 'Ogiltig push-endpoint';
  end if;
  if coalesce(btrim(p_p256dh), '') = '' or coalesce(btrim(p_auth_key), '') = '' then
    raise exception 'Ogiltiga push-nycklar';
  end if;

  insert into public.push_subscriptions
    (user_id, endpoint, p256dh, auth_key, user_agent)
  values (uid, p_endpoint, p_p256dh, p_auth_key, nullif(btrim(p_user_agent), ''))
  on conflict (endpoint) do update
    set user_id      = excluded.user_id,
        p256dh       = excluded.p256dh,
        auth_key     = excluded.auth_key,
        user_agent   = excluded.user_agent,
        last_seen_at = now(),
        retired_at   = null
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.register_push_subscription(text, text, text, text) is
  'Upsert the caller''s PushSubscription. Re-registering the same endpoint '
  'refreshes it in place (and un-retires it) rather than duplicating. If the '
  'endpoint previously belonged to a different signed-out user on a shared '
  'device, ownership transfers to the new caller — the same trust model as '
  'the browser itself (whoever currently holds the PushSubscription object).';

revoke all on function public.register_push_subscription(text, text, text, text)
  from public, anon;
grant execute on function public.register_push_subscription(text, text, text, text)
  to authenticated;

-- ----------------------------------------------------------------------------
-- unregister_push_subscription
-- ----------------------------------------------------------------------------
create or replace function public.unregister_push_subscription(
  p_endpoint text
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

  delete from public.push_subscriptions
  where endpoint = p_endpoint and user_id = uid;
end;
$$;

comment on function public.unregister_push_subscription(text) is
  'Remove the caller''s own subscription (logout / explicit disable). Silently '
  'a no-op if the endpoint does not exist or belongs to someone else.';

revoke all on function public.unregister_push_subscription(text) from public, anon;
grant execute on function public.unregister_push_subscription(text) to authenticated;

-- ----------------------------------------------------------------------------
-- get_notification_preferences
-- ----------------------------------------------------------------------------
create or replace function public.get_notification_preferences(
  p_challenge_id uuid
)
returns public.notification_preferences
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid   uuid := (select auth.uid());
  v_row public.notification_preferences;
begin
  if uid is null then
    raise exception 'Du måste vara inloggad';
  end if;

  select * into v_row
  from public.notification_preferences
  where user_id = uid and challenge_id = p_challenge_id;

  if found then
    return v_row;
  end if;

  -- No row yet: return the table defaults without writing one. A write only
  -- happens when the user actually changes a toggle (update_..., below).
  v_row.user_id = uid;
  v_row.challenge_id = p_challenge_id;
  v_row.chat_reply = true;
  v_row.chat_like = true;
  v_row.chat_all_messages = false;
  v_row.straffbanken = true;
  v_row.game_master = true;
  v_row.training_reminders = true;
  v_row.personal_status = true;
  v_row.daily_group_summary = true;
  v_row.updated_at = now();
  return v_row;
end;
$$;

comment on function public.get_notification_preferences(uuid) is
  'The caller''s own notification preferences for a challenge, materialising '
  'the column defaults on first read (no row exists yet) so the client always '
  'gets a full, current set of toggles.';

revoke all on function public.get_notification_preferences(uuid) from public, anon;
grant execute on function public.get_notification_preferences(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- update_notification_preferences — partial upsert (NULL = leave unchanged)
-- ----------------------------------------------------------------------------
create or replace function public.update_notification_preferences(
  p_challenge_id        uuid,
  p_chat_reply          boolean default null,
  p_chat_like           boolean default null,
  p_chat_all_messages   boolean default null,
  p_straffbanken        boolean default null,
  p_game_master         boolean default null,
  p_training_reminders  boolean default null,
  p_personal_status     boolean default null,
  p_daily_group_summary boolean default null
)
returns public.notification_preferences
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid   uuid := (select auth.uid());
  v_row public.notification_preferences;
begin
  if uid is null then
    raise exception 'Du måste vara inloggad';
  end if;

  insert into public.notification_preferences as np
    (user_id, challenge_id, chat_reply, chat_like, chat_all_messages,
     straffbanken, game_master, training_reminders, personal_status,
     daily_group_summary)
  values (
    uid, p_challenge_id,
    coalesce(p_chat_reply, true),
    coalesce(p_chat_like, true),
    coalesce(p_chat_all_messages, false),
    coalesce(p_straffbanken, true),
    coalesce(p_game_master, true),
    coalesce(p_training_reminders, true),
    coalesce(p_personal_status, true),
    coalesce(p_daily_group_summary, true)
  )
  on conflict (user_id, challenge_id) do update
    set chat_reply          = coalesce(p_chat_reply, np.chat_reply),
        chat_like           = coalesce(p_chat_like, np.chat_like),
        chat_all_messages   = coalesce(p_chat_all_messages, np.chat_all_messages),
        straffbanken        = coalesce(p_straffbanken, np.straffbanken),
        game_master         = coalesce(p_game_master, np.game_master),
        training_reminders  = coalesce(p_training_reminders, np.training_reminders),
        personal_status     = coalesce(p_personal_status, np.personal_status),
        daily_group_summary = coalesce(p_daily_group_summary, np.daily_group_summary),
        updated_at          = now()
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.update_notification_preferences(
  uuid, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean
) is
  'Partial upsert of the caller''s own notification preferences. Every '
  'boolean parameter left NULL keeps its current (or default) value — a '
  'single-toggle UI change never resets the others.';

revoke all on function public.update_notification_preferences(
  uuid, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean
) from public, anon;
grant execute on function public.update_notification_preferences(
  uuid, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean
) to authenticated;

-- ----------------------------------------------------------------------------
-- try_claim_self_test_notification — kill-switch + ~once/minute/user throttle
-- for the "Skicka testnotis" button (notification-dispatcher's "self-test"
-- action calls this before sending). Returns true iff the caller may send a
-- self-test push right now; false means "wait" (rate limited); raises if
-- every one of the caller's active challenges currently has push disabled,
-- so an admin's emergency kill switch also blocks the verification path
-- rather than giving a false "notifications work" signal while it is on.
-- ----------------------------------------------------------------------------
create or replace function public.try_claim_self_test_notification()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid       uuid := (select auth.uid());
  v_updated integer;
begin
  if uid is null then
    raise exception 'Du måste vara inloggad';
  end if;

  if not exists (
    select 1
    from public.challenge_memberships m
    join public.challenges c on c.id = m.challenge_id
    where m.user_id = uid and m.active and c.push_enabled
  ) then
    raise exception 'Notiser är avstängda just nu.';
  end if;

  insert into public._self_test_rate_limit (user_id, last_sent_at)
  values (uid, now())
  on conflict (user_id) do update
    set last_sent_at = now()
    where public._self_test_rate_limit.last_sent_at <= now() - interval '60 seconds';

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

comment on function public.try_claim_self_test_notification() is
  'Atomic claim for the self-test push: true = send now (and the claim is '
  'recorded), false = rate limited (try again later). Raises if the caller '
  'has no active membership in a push-enabled challenge, so the kill switch '
  'blocks self-test too.';

revoke all on function public.try_claim_self_test_notification() from public, anon;
grant execute on function public.try_claim_self_test_notification() to authenticated;
