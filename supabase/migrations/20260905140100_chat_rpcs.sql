-- ============================================================================
-- Hälsoutmaningen — Shared Chat / 0019  participant + moderation RPCs
--
-- Spec: docs/superpowers/specs/2026-09-05-shared-chat-design.md §3
-- Plan: docs/superpowers/plans/2026-09-05-shared-chat-implementation.md (Tasks 3–4)
--
-- Depends on 0018. Forward-only. All functions SECURITY DEFINER,
-- search_path='', schema-qualified, EXECUTE revoked from public/anon and
-- granted to authenticated only for the participant-facing ones — the same
-- convention as 20260904100100_retroactive_registration_rpcs.sql /
-- 20260904130100_game_master_engine.sql.
--
--   post_chat_message(challenge, body)  participant writes their own message.
--       sender_user_id is ALWAYS auth.uid() (never a parameter); sender_type
--       is ALWAYS 'participant'. A 1000-char cap and a 10-message / rolling
--       30-second per-user rate limit are enforced here, server-side.
--   mark_chat_read(challenge, seq)      advance the caller's read cursor.
--       The seq must belong to the challenge; last_read_seq never moves
--       backwards.
--   hide_chat_message(message, reason)  admin-only moderation (appended to
--       this file by the next task). Sets status='hidden' + the moderation
--       trail, writes one audit row, keeps the row and its body. Refuses a
--       game_master-authored row (those are hidden via
--       cancel_game_master_event, Plan 3).
--
-- Ruling: post_chat_message ships WITH its rate-limit clause here (not deferred
-- to the hide_chat_message task) so no commit in history contains an
-- unthrottled chat endpoint.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- post_chat_message
-- ----------------------------------------------------------------------------
create or replace function public.post_chat_message(
  p_challenge_id uuid,
  p_body         text
)
returns public.chat_messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid    uuid := (select auth.uid());
  v_body text := btrim(coalesce(p_body, ''));
  v_row  public.chat_messages;
begin
  if uid is null then
    raise exception 'Du måste vara inloggad för att skriva i chatten';
  end if;

  if not exists (
    select 1 from public.challenge_memberships m
    where m.challenge_id = p_challenge_id
      and m.user_id = uid
      and m.active
  ) then
    raise exception 'Du är inte aktiv deltagare i den här utmaningen';
  end if;

  if char_length(v_body) < 1 then
    raise exception 'Meddelandet kan inte vara tomt';
  end if;
  if char_length(v_body) > 1000 then
    raise exception 'Meddelandet får vara högst 1000 tecken';
  end if;

  -- Rate limit: at most 10 participant messages per rolling 30 seconds per
  -- user. Self-query against chat_messages, no separate table — same shape as
  -- request_game_master_pulse's 90-second throttle.
  if (
    select count(*)
    from public.chat_messages c
    where c.sender_type = 'participant'
      and c.sender_user_id = uid
      and c.created_at > now() - interval '30 seconds'
  ) >= 10 then
    raise exception 'För många meddelanden på kort tid. Vänta en liten stund.';
  end if;

  insert into public.chat_messages (challenge_id, sender_type, sender_user_id, body)
  values (p_challenge_id, 'participant', uid, v_body)
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.post_chat_message(uuid, text) is
  'Participant writes one message to a challenge''s shared room. sender_user_id '
  'is always auth.uid() and sender_type is always ''participant'' — neither is a '
  'parameter, so a client cannot impersonate another user or post as Game '
  'Master. 1000-char cap and a 10 / 30s rate limit enforced here.';

revoke all on function public.post_chat_message(uuid, text) from public, anon;
grant execute on function public.post_chat_message(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- mark_chat_read
-- ----------------------------------------------------------------------------
create or replace function public.mark_chat_read(
  p_challenge_id uuid,
  p_seq          bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid          uuid := (select auth.uid());
  v_message_id uuid;
begin
  if uid is null then
    raise exception 'Du måste vara inloggad';
  end if;

  -- Membership existence (active or not) — matches is_challenge_member's
  -- semantics; someone who left the challenge still keeps a read cursor.
  if not public.is_challenge_member(p_challenge_id) then
    raise exception 'Du är inte med i den här utmaningen';
  end if;

  -- The seq must be a real message in THIS challenge (seq is a single global
  -- identity across the whole table, so a client could otherwise pass a seq
  -- from a different room).
  select c.id into v_message_id
  from public.chat_messages c
  where c.seq = p_seq
    and c.challenge_id = p_challenge_id;

  if v_message_id is null then
    raise exception 'Ogiltig läsposition';
  end if;

  insert into public.chat_read_state as crs
    (challenge_id, user_id, last_read_seq, last_read_message_id)
  values (p_challenge_id, uid, p_seq, v_message_id)
  on conflict (challenge_id, user_id) do update
    set last_read_seq = greatest(crs.last_read_seq, excluded.last_read_seq),
        last_read_message_id = case
          when excluded.last_read_seq > crs.last_read_seq
            then excluded.last_read_message_id
          else crs.last_read_message_id
        end,
        updated_at = now();
end;
$$;

comment on function public.mark_chat_read(uuid, bigint) is
  'Advance the caller''s read cursor. p_seq must belong to a message in '
  'p_challenge_id. last_read_seq can never move backwards (greatest()).';

revoke all on function public.mark_chat_read(uuid, bigint) from public, anon;
grant execute on function public.mark_chat_read(uuid, bigint) to authenticated;

-- hide_chat_message (admin moderation) is added to this file by the next task.
