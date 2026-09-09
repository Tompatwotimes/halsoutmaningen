-- ============================================================================
-- Hälsoutmaningen — Shared Chat: ❤️ likes + ↩️ replies / 0030  (schema — part 1)
--
-- Spec: docs/superpowers/specs/2026-09-07-chat-replies-likes-design.md §9
-- Plan: docs/superpowers/plans/2026-09-07-chat-replies-likes.md (Task A)
--
-- Depends on 0018–0021 (chat), 0027 (chat_messages_id_challenge_uniq — the
-- composite FK target), 0029 (training cards). Forward-only, ADDITIVE. This
-- PART 1 adds ONLY the schema foundation; it changes no existing object's
-- behaviour and adds no function. The write RPCs (a shared _create_chat_message
-- helper, a reply-aware post_chat_message, set_chat_message_like) and the
-- list_chat_messages v4 read model are Task B and are appended to THIS file
-- there.
--
-- ── Replies ────────────────────────────────────────────────────────────────
--   A reply is an ordinary chat_messages row that additionally points at the
--   message it quotes — there is NO separate replies table, so a reply keeps
--   every message behaviour (seq, rate limit, moderation, unread, attachments,
--   the chat_activity Realtime signal) for free.
--
--   chat_messages.reply_to_message_id — nullable. The composite FK
--   (reply_to_message_id, challenge_id) -> chat_messages(id, challenge_id) —
--   the same (id, challenge_id) unique key chat_message_attachments already
--   uses — FK-GUARANTEES a reply's parent is in the SAME challenge; a client
--   can never quote another challenge's message. MATCH SIMPLE: a row with a
--   NULL reply_to_message_id (every existing row, every non-reply) is
--   unconstrained.
--
--   ON DELETE SET NULL (reply_to_message_id) is the PG15+ column-list form:
--   physically deleting a parent nulls ONLY the child's link and keeps the
--   child (its NOT NULL challenge_id is untouched) — the child survives as a
--   plain message with no quote. The quote shown to clients is resolved LIVE by
--   list_chat_messages from the parent's CURRENT state (Task B), never a stored
--   snapshot, so moderating the parent later retroactively hides the quote.
--
-- ── Likes ──────────────────────────────────────────────────────────────────
--   chat_message_likes — one heart per (message, user). PRIMARY KEY
--   (message_id, user_id) enforces the "at most one" invariant in the database,
--   not the app. Composite FK (message_id, challenge_id) -> chat_messages
--   (id, challenge_id) ON DELETE CASCADE: a like's challenge_id is FK-guaranteed
--   equal to its message's (no cross-challenge like), and a like on a
--   physically removed message / challenge is meaningless so it goes with it.
--   user_id -> profiles ON DELETE CASCADE: removing an account removes its
--   hearts and the counts adjust naturally.
--
-- ── Security (mirrors chat_messages / chat_message_attachments) ─────────────
--   * chat_message_likes base SELECT is ADMIN-ONLY. Ordinary members never read
--     the table directly — Task B's list_chat_messages returns like_count /
--     liked_by_me per visible row and withholds both for a hidden message, so a
--     hidden message's like metadata (count, liker identity, liked_by_me) can
--     never leak via PostgREST.
--   * NO write policy. Task B's set_chat_message_like (SECURITY DEFINER) is the
--     only writer; a client cannot forge (message_id, challenge_id, user_id)
--     because there is no INSERT path that accepts arbitrary values —
--     structural, not a policy check.
--   * Nothing here is added to supabase_realtime. Task B makes a like bump the
--     existing chat_activity signal row; chat_message_likes itself stays
--     unpublished. No core table gains a foreign key to a social table.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. chat_messages.reply_to_message_id — nullable self-reference
-- ----------------------------------------------------------------------------
alter table public.chat_messages
  add column reply_to_message_id uuid;

alter table public.chat_messages
  add constraint chat_messages_reply_to_fk
  foreign key (reply_to_message_id, challenge_id)
  references public.chat_messages (id, challenge_id)
  on delete set null (reply_to_message_id);

alter table public.chat_messages
  add constraint chat_messages_reply_not_self
  check (reply_to_message_id is null or reply_to_message_id <> id);

comment on column public.chat_messages.reply_to_message_id is
  'NULL for a normal message; for a reply, the message it quotes. Composite FK '
  '(reply_to_message_id, challenge_id) -> chat_messages(id, challenge_id) '
  'guarantees the parent is in the same challenge. ON DELETE SET NULL '
  '(reply_to_message_id): a physically deleted parent nulls only this link, the '
  'child reply survives. The reply_preview shown to clients is resolved LIVE by '
  'list_chat_messages from the parent''s CURRENT state (Task B) — never a stored '
  'snapshot — so moderating the parent later retroactively hides the quote.';

-- Partial: only real reply links are indexed — moderation tooling and a future
-- "X replied to your message" notification lookup. The list_chat_messages
-- preview subquery itself resolves the parent by PRIMARY KEY, not this index.
create index chat_messages_reply_to_idx
  on public.chat_messages (reply_to_message_id)
  where reply_to_message_id is not null;

-- ----------------------------------------------------------------------------
-- 2. chat_message_likes — normalized one-heart-per-(message, user)
-- ----------------------------------------------------------------------------
create table public.chat_message_likes (
  message_id   uuid not null,
  challenge_id uuid not null,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  created_at   timestamptz not null default now(),

  -- One heart per user per message — the invariant lives in the database.
  primary key (message_id, user_id),

  -- The like's challenge_id is FK-guaranteed identical to its message's: a like
  -- can never be attached to a message in another challenge. ON DELETE CASCADE:
  -- a like on a physically removed message / challenge is meaningless.
  constraint chat_message_likes_message_fk
    foreign key (message_id, challenge_id)
    references public.chat_messages (id, challenge_id) on delete cascade
);

comment on table public.chat_message_likes is
  'One heart per (message, user). Written only by set_chat_message_like '
  '(Task B). Base SELECT is admin-only — members read like_count / liked_by_me '
  'through list_chat_messages, which withholds both for a hidden message. Not '
  'Realtime-published (a like bumps the existing chat_activity row instead).';

-- The PK (message_id, user_id) already serves both read-model lookups:
--   like_count  -> count(*) WHERE message_id = $1        (leading column)
--   liked_by_me -> WHERE message_id = $1 AND user_id = $2 (full key)
-- so no secondary index is added.

-- ----------------------------------------------------------------------------
-- RLS — admin-only base read, no write policy (the RPC is the only writer)
-- ----------------------------------------------------------------------------
alter table public.chat_message_likes enable row level security;
revoke all on public.chat_message_likes from anon, authenticated;
grant select on public.chat_message_likes to authenticated;

create policy chat_message_likes_select on public.chat_message_likes
  for select to authenticated
  using (public.is_admin());

comment on policy chat_message_likes_select on public.chat_message_likes is
  'Admin-only. Ordinary members never read this table directly — they use '
  'list_chat_messages (Task B), which returns like_count = 0 / liked_by_me = '
  'false for a hidden message. Prevents a hidden message''s like metadata '
  'leaking via PostgREST.';

-- No INSERT / UPDATE / DELETE policy: set_chat_message_like (Task B) is the
-- only writer. A client cannot forge a (message_id, challenge_id, user_id) row
-- because there is no INSERT path that accepts arbitrary values — the same
-- structural guarantee chat_message_attachments relies on.

-- ============================================================================
-- PART 2 — write RPCs + safe read model   (Task B of the plan)
--
-- Spec §10–§11. Appended to THIS not-yet-released migration (Task A + Task B
-- ship as one migration; production is still on 20260907120000).
--
--   _create_chat_message(challenge, body, message_id, attachments, reply_to)
--       PRIVATE. The single canonical writer of a participant message — every
--       rule post_chat_message enforced since 20260906120200 PLUS the
--       reply-target check, so an ordinary message and a reply share one code
--       path and one rate-limit path.
--
--   post_chat_message(challenge, body?, message_id?, attachments?, reply_to?)
--       ONE public signature. The 4-arg form is dropped and recreated with an
--       additive 5th DEFAULT NULL param. An old client that posts
--       {p_challenge_id, p_body}[, p_message_id, p_attachments] still resolves
--       (PostgREST fills the missing named args from their defaults) → the
--       DB-first rollout has no broken window. Thin wrapper over the helper.
--
--   set_chat_message_like(message_id, liked)
--       Idempotent, retry-safe heart state (design §10.2 specified a toggle;
--       the approved product requirement is deterministic state-setting — a
--       dropped-response retry must never flip the user's intent). liked=true
--       guarantees the caller's like exists; liked=false guarantees it is
--       gone; repeating a call is a no-op. Never allocates seq / touches
--       unread; bumps the existing chat_activity signal only on an actual
--       change. Returns {liked, like_count} = committed state.
--
--   list_chat_messages  v4 — three additive columns: like_count, liked_by_me,
--       reply_preview. All gated exactly like body / attachments / training_card
--       (c.status='active' OR public.is_admin()). reply_preview is produced
--       SERVER-SIDE from the direct parent's CURRENT state, one level only — a
--       hidden parent collapses to {"deleted": true} for a non-admin, never a
--       stored snapshot, no body / note / activity / proof path / GM text.
--
-- No audit_log rows (a heart is ordinary social interaction; a reply is an
-- ordinary chat message). No notifications, mentions, avatars, jury, Game
-- Master or core-challenge changes. Nothing new is Realtime-published.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 3. _create_chat_message — the ONE canonical participant-message writer
-- ----------------------------------------------------------------------------
create or replace function public._create_chat_message(
  p_challenge_id        uuid,
  p_body                text,
  p_message_id          uuid,
  p_attachments         jsonb,
  p_reply_to_message_id uuid
)
returns public.chat_messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid                uuid    := (select auth.uid());
  v_body             text    := nullif(btrim(coalesce(p_body, '')), '');
  v_id               uuid    := coalesce(p_message_id, gen_random_uuid());
  v_atts             jsonb   := coalesce(p_attachments, '[]'::jsonb);
  v_count            integer;
  v_prefix           text;
  v_att              jsonb;
  v_path             text;
  v_mime             text;
  v_size             bigint;
  v_idx              integer := 0;
  v_row              public.chat_messages;
  v_parent_challenge uuid;
  v_parent_status    text;
begin
  if uid is null then
    raise exception 'Du måste vara inloggad för att skriva i chatten';
  end if;

  if not exists (
    select 1 from public.challenge_memberships m
    where m.challenge_id = p_challenge_id and m.user_id = uid and m.active
  ) then
    raise exception 'Du är inte aktiv deltagare i den här utmaningen';
  end if;

  -- Reply target (only when this is a reply). The composite FK
  -- chat_messages_reply_to_fk is the structural backstop; these checks give a
  -- clean domain error instead of a raw 23503, and refuse a hidden parent.
  -- v_parent_challenge comes from the row, so a forged p_challenge_id cannot
  -- make a cross-challenge parent look local.
  if p_reply_to_message_id is not null then
    select c.challenge_id, c.status
      into v_parent_challenge, v_parent_status
    from public.chat_messages c
    where c.id = p_reply_to_message_id;

    if v_parent_challenge is null then
      raise exception 'Meddelandet du svarar på finns inte';
    end if;
    if v_parent_challenge <> p_challenge_id then
      raise exception 'Meddelandet du svarar på tillhör en annan utmaning';
    end if;
    if v_parent_status <> 'active' then
      raise exception 'Meddelandet går inte längre att svara på';
    end if;
  end if;

  if jsonb_typeof(v_atts) <> 'array' then
    raise exception 'Ogiltiga bilagor';
  end if;
  v_count := jsonb_array_length(v_atts);

  if v_body is not null and char_length(v_body) > 1000 then
    raise exception 'Meddelandet får vara högst 1000 tecken';
  end if;
  if v_count > 4 then
    raise exception 'Högst fyra bilder per meddelande';
  end if;
  if v_body is null and v_count = 0 then
    raise exception 'Meddelandet kan inte vara tomt';
  end if;

  -- Rate limit: at most 10 participant messages per rolling 30 seconds. A reply
  -- IS a participant message and is counted here exactly like any other — there
  -- is no second rate-limit path and no reply bypass.
  if (
    select count(*)
    from public.chat_messages c
    where c.sender_type = 'participant'
      and c.sender_user_id = uid
      and c.created_at > now() - interval '30 seconds'
  ) >= 10 then
    raise exception 'För många meddelanden på kort tid. Vänta en liten stund.';
  end if;

  insert into public.chat_messages
    (id, challenge_id, sender_type, sender_user_id, body, reply_to_message_id)
  values
    (v_id, p_challenge_id, 'participant', uid, v_body, p_reply_to_message_id)
  returning * into v_row;

  if v_count > 0 then
    v_prefix := p_challenge_id::text || '/' || uid::text || '/' || v_id::text || '/';

    for v_att in select value from jsonb_array_elements(v_atts)
    loop
      v_idx := v_idx + 1;
      v_path := v_att ->> 'path';
      v_mime := coalesce(v_att ->> 'mime_type', '');
      v_size := coalesce(nullif(v_att ->> 'size_bytes', ''), '0')::bigint;

      if v_path is null or not starts_with(v_path, v_prefix) then
        raise exception 'Ogiltig bilagsökväg';
      end if;
      if v_mime not in ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif') then
        raise exception 'Bildformatet stöds inte';
      end if;
      if v_size <= 0 or v_size > 15728640 then
        raise exception 'Bilden är för stor';
      end if;
      -- The object must actually exist (client uploads before calling this).
      if not exists (
        select 1 from storage.objects o
        where o.bucket_id = 'chat-media' and o.name = v_path
      ) then
        raise exception 'Bilden kunde inte hittas';
      end if;

      insert into public.chat_message_attachments
        (message_id, challenge_id, position, storage_path, mime_type, size_bytes, width, height)
      values (
        v_id, p_challenge_id, v_idx, v_path, v_mime, v_size,
        nullif(v_att ->> 'width', '')::integer,
        nullif(v_att ->> 'height', '')::integer
      );
    end loop;
  end if;

  return v_row;
end;
$$;

comment on function public._create_chat_message(uuid, text, uuid, jsonb, uuid) is
  'PRIVATE canonical writer for a participant chat message (and replies). All '
  'validation, the 10/30s rate limit, sender identity (auth.uid()), attachment '
  'linking and the reply-target check live here so post_chat_message and any '
  'future reply-capable caller share one path. NOT granted to anon/authenticated '
  '— reachable only via the post_chat_message SECURITY DEFINER wrapper, which '
  'executes as the function owner.';

revoke all on function public._create_chat_message(uuid, text, uuid, jsonb, uuid)
  from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. post_chat_message — ONE public signature (additive 5th param)
-- ----------------------------------------------------------------------------
drop function if exists public.post_chat_message(uuid, text, uuid, jsonb);

create or replace function public.post_chat_message(
  p_challenge_id        uuid,
  p_body                text  default null,
  p_message_id          uuid  default null,
  p_attachments         jsonb default null,
  p_reply_to_message_id uuid  default null
)
returns public.chat_messages
language sql
security definer
set search_path = ''
as $$
  select public._create_chat_message(
    p_challenge_id, p_body, p_message_id, p_attachments, p_reply_to_message_id);
$$;

comment on function public.post_chat_message(uuid, text, uuid, jsonb, uuid) is
  'Participant writes one message (text, 1-4 images, or both — optionally a '
  'reply to another message in the SAME challenge) to a challenge room, '
  'atomically with its attachment rows. Thin wrapper over the canonical '
  '_create_chat_message. sender_user_id is always auth.uid(); sender_type '
  'always ''participant''. p_reply_to_message_id NULL => an ordinary message, '
  'byte-for-byte the previous behaviour (old {p_challenge_id, p_body} callers '
  'still resolve). 1000-char cap, 4-image cap, 10/30s rate limit; a reply '
  'target must exist, be in the same challenge and be active.';

revoke all on function public.post_chat_message(uuid, text, uuid, jsonb, uuid) from public, anon;
grant execute on function public.post_chat_message(uuid, text, uuid, jsonb, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. set_chat_message_like(message_id, liked) — idempotent heart state
-- ----------------------------------------------------------------------------
create or replace function public.set_chat_message_like(
  p_message_id uuid,
  p_liked      boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid         uuid := (select auth.uid());
  v_challenge uuid;
  v_seq       bigint;
  v_status    text;
  v_changed   boolean := false;
  v_liked     boolean;
  v_count     integer;
begin
  if uid is null then
    raise exception 'Du måste vara inloggad';
  end if;
  if p_liked is null then
    raise exception 'Ogiltig gilla-markering';
  end if;

  -- Everything (challenge, seq, status) comes from the row — never the caller.
  select c.challenge_id, c.seq, c.status
    into v_challenge, v_seq, v_status
  from public.chat_messages c
  where c.id = p_message_id;

  if v_challenge is null then
    raise exception 'Meddelandet finns inte';
  end if;

  -- ACTIVE membership in the message's own challenge (mirrors post_chat_message).
  if not exists (
    select 1 from public.challenge_memberships m
    where m.challenge_id = v_challenge and m.user_id = uid and m.active
  ) then
    raise exception 'Du är inte aktiv deltagare i den här utmaningen';
  end if;

  -- The social surface of a hidden message is frozen: no new like and no
  -- unlike (a non-admin cannot see the state anyway). Existing rows stay.
  if v_status <> 'active' then
    raise exception 'Det går inte att gilla ett dolt meddelande';
  end if;

  if p_liked then
    insert into public.chat_message_likes (message_id, challenge_id, user_id)
    values (p_message_id, v_challenge, uid)
    on conflict (message_id, user_id) do nothing;
    v_changed := found;                       -- a row was actually inserted
  else
    delete from public.chat_message_likes
    where message_id = p_message_id and user_id = uid;  -- only ever the caller's
    v_changed := found;                       -- a row was actually removed
  end if;

  -- Authoritative committed state.
  select count(*)::integer into v_count
  from public.chat_message_likes where message_id = p_message_id;
  v_liked := exists (
    select 1 from public.chat_message_likes
    where message_id = p_message_id and user_id = uid
  );

  -- Safe Realtime nudge — ONLY on an actual state change. Never allocates a
  -- seq, never inserts a chat_messages row, never touches chat_read_state /
  -- unread. Same upsert tg_chat_activity_fanout uses for a new message.
  if v_changed then
    insert into public.chat_activity (challenge_id, seq, at)
    values (v_challenge, v_seq, now())
    on conflict (challenge_id, seq) do update set at = excluded.at;
  end if;

  return jsonb_build_object('liked', v_liked, 'like_count', v_count);
end;
$$;

comment on function public.set_chat_message_like(uuid, boolean) is
  'Idempotent heart state for the calling participant on a chat message / '
  'training card / GM message. p_liked=true guarantees the caller''s like '
  'exists; p_liked=false guarantees it is gone; repeating a call is a no-op '
  '(retry-safe). Identity is auth.uid() only — a caller can neither name '
  'another user_id nor remove another user''s like. Requires active membership '
  'in the message''s challenge and status=''active''. Never allocates seq / '
  'touches unread; bumps chat_activity only on an actual change. Returns '
  '{liked, like_count} = committed state.';

revoke all on function public.set_chat_message_like(uuid, boolean) from public, anon;
grant execute on function public.set_chat_message_like(uuid, boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- 6. list_chat_messages v4 — +like_count, +liked_by_me, +reply_preview
--    (drop + recreate: the return shape widens, exactly as 0028 added
--     `attachments` and 0029 added `training_card`)
-- ----------------------------------------------------------------------------
drop function if exists public.list_chat_messages(uuid, bigint, integer);

create or replace function public.list_chat_messages(
  p_challenge_id uuid,
  p_before_seq   bigint  default null,
  p_limit        integer default 50
)
returns table (
  id                  uuid,
  seq                 bigint,
  challenge_id        uuid,
  sender_type         text,
  sender_user_id      uuid,
  sender_display_name text,
  body                text,
  status              text,
  attachments         jsonb,
  training_card       jsonb,
  created_at          timestamptz,
  like_count          integer,
  liked_by_me         boolean,
  reply_preview       jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    c.id,
    c.seq,
    c.challenge_id,
    c.sender_type,
    c.sender_user_id,
    p.display_name as sender_display_name,
    case
      when c.status = 'active' or public.is_admin() then c.body
      else null
    end as body,
    c.status,
    coalesce(
      case
        when c.status = 'active' or public.is_admin() then (
          select jsonb_agg(
                   jsonb_build_object('position', a.position, 'path', a.storage_path)
                   order by a.position
                 )
          from public.chat_message_attachments a
          where a.message_id = c.id
        )
      end,
      '[]'::jsonb
    ) as attachments,
    case
      when c.training_entry_id is not null
           and (c.status = 'active' or public.is_admin()) then (
        select jsonb_build_object(
          'entry_id',          te.id,
          'activity',          te.activity,
          'duration_minutes',  te.duration_minutes,
          'note',              te.note,
          'challenge_date',    te.challenge_date,
          'entry_status',      te.status,
          'trained_at',        te.created_at,
          'proofs', coalesce((
            select jsonb_agg(
                     jsonb_build_object('position', tp.position, 'path', tp.storage_path)
                     order by tp.position
                   )
            from public.training_proofs tp
            where tp.training_entry_id = te.id
          ), '[]'::jsonb)
        )
        from public.training_entries te
        where te.id = c.training_entry_id
      )
      else null
    end as training_card,
    c.created_at,
    -- Reaction metadata. Same visibility gate as body / attachments /
    -- training_card: 0 / false for a hidden row seen by a non-admin, so a
    -- hidden message never leaks its like count, liker identity or the
    -- viewer's own like state. Both subqueries hit the chat_message_likes PK
    -- (message_id leading) — index probes, no scan, bounded page.
    case
      when c.status = 'active' or public.is_admin() then (
        select count(*)::integer
        from public.chat_message_likes l
        where l.message_id = c.id
      )
      else 0
    end as like_count,
    case
      when c.status = 'active' or public.is_admin() then exists (
        select 1
        from public.chat_message_likes l
        where l.message_id = c.id and l.user_id = (select auth.uid())
      )
      else false
    end as liked_by_me,
    -- One-level, server-produced quote of the DIRECT parent's CURRENT state.
    -- NULL when this row is not a reply (or the parent was physically deleted,
    -- FK SET NULL). A hidden parent seen by a non-admin collapses to
    -- {"deleted": true} — no body excerpt, image hint, activity, duration,
    -- proof reference, GM text or sender detail crosses the boundary. Never a
    -- stored snapshot: moderating the parent later changes this automatically.
    case
      when c.reply_to_message_id is null then null
      else (
        select case
          when pm.status = 'hidden' and not public.is_admin()
            then jsonb_build_object('deleted', true)
          else jsonb_build_object(
            'message_id',          pm.id,
            'seq',                 pm.seq,
            'sender_type',         pm.sender_type,
            'sender_user_id',      pm.sender_user_id,
            'sender_display_name', pp.display_name,
            'kind', case
              when pm.sender_type = 'training_card' then 'training_card'
              when pm.sender_type = 'game_master'   then 'game_master'
              when pm.body is not null              then 'text'
              when exists (select 1 from public.chat_message_attachments a
                           where a.message_id = pm.id) then 'image'
              else 'text' end,
            'text', case when pm.status = 'hidden' then null
                         else left(pm.body, 140) end,
            'has_image', exists (select 1 from public.chat_message_attachments a
                                 where a.message_id = pm.id),
            'training', case when pm.training_entry_id is not null then (
                          select jsonb_build_object(
                                   'activity',         te.activity,
                                   'duration_minutes', te.duration_minutes)
                          from public.training_entries te
                          where te.id = pm.training_entry_id) end
          )
        end
        from public.chat_messages pm
        left join public.profiles pp on pp.id = pm.sender_user_id
        where pm.id = c.reply_to_message_id
      )
    end as reply_preview
  from public.chat_messages c
  left join public.profiles p on p.id = c.sender_user_id
  where c.challenge_id = p_challenge_id
    and (public.is_admin() or public.is_challenge_member(p_challenge_id))
    and (p_before_seq is null or c.seq < p_before_seq)
  order by c.seq desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

comment on function public.list_chat_messages(uuid, bigint, integer) is
  'Members'' read surface for a challenge''s chat room, newest seq first. '
  'Membership-checked. A moderated message is a real row (status=''hidden'') '
  'with body NULL, attachments ''[]'', training_card NULL, like_count 0, '
  'liked_by_me false for a non-admin. reply_preview: NULL when the row is not '
  'a reply; {"deleted": true} when the parent is hidden (non-admin); otherwise '
  'a compact one-level quote of the parent''s CURRENT state (kind, short text, '
  'has_image, training activity/duration) — resolved live, never a snapshot, '
  'never a storage path or signed URL.';

revoke all on function public.list_chat_messages(uuid, bigint, integer) from public, anon;
grant execute on function public.list_chat_messages(uuid, bigint, integer) to authenticated;
