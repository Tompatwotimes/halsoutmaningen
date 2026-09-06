-- ============================================================================
-- Hälsoutmaningen — Chat images / 0028  post_chat_message + list_chat_messages
--
-- Spec: docs/superpowers/specs/2026-09-06-chat-proof-media-polish-design.md §B3
-- Plan: docs/superpowers/plans/2026-09-06-chat-proof-media-polish-implementation.md (Task 8)
--
-- Depends on 20260906120100_chat_attachments_schema.sql. Forward-only.
--
--   post_chat_message(challenge, body?, message_id?, attachments?)
--     REPLACES the 2-arg version. One transaction: insert the message AND its
--     0..4 attachment rows. Backward compatible — a call with only
--     {p_challenge_id, p_body} still resolves (new params default to NULL).
--     Rules: text OR >=1 image (never both empty); <= 4 images; every
--     attachment path must sit under {challenge}/{caller uid}/{message id}/ and
--     name a real storage object => a client cannot link someone else's upload
--     or a cross-challenge object. Rate limit unchanged (10 / rolling 30s).
--
--   list_chat_messages(challenge, before_seq?, limit?)
--     Gains an `attachments jsonb` column: [{position, path}] ordered by
--     position for an active message (or any message to an admin), '[]' for a
--     hidden message seen by a non-admin — the same gate as `body`.
--
-- mark_chat_read / hide_chat_message are unchanged. Hiding a message needs no
-- attachment code: status='hidden' already empties the read model's
-- attachments and makes _chat_attachment_readable() false at the storage layer.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- post_chat_message  (drop the 2-arg version, recreate with the media params)
-- ----------------------------------------------------------------------------
drop function if exists public.post_chat_message(uuid, text);

create or replace function public.post_chat_message(
  p_challenge_id uuid,
  p_body         text  default null,
  p_message_id   uuid  default null,
  p_attachments  jsonb default null
)
returns public.chat_messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid      uuid := (select auth.uid());
  v_body   text := nullif(btrim(coalesce(p_body, '')), '');
  v_id     uuid := coalesce(p_message_id, gen_random_uuid());
  v_atts   jsonb := coalesce(p_attachments, '[]'::jsonb);
  v_count  integer;
  v_prefix text;
  v_att    jsonb;
  v_path   text;
  v_mime   text;
  v_size   bigint;
  v_idx    integer := 0;
  v_row    public.chat_messages;
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

  -- Rate limit: at most 10 participant messages per rolling 30 seconds.
  if (
    select count(*)
    from public.chat_messages c
    where c.sender_type = 'participant'
      and c.sender_user_id = uid
      and c.created_at > now() - interval '30 seconds'
  ) >= 10 then
    raise exception 'För många meddelanden på kort tid. Vänta en liten stund.';
  end if;

  insert into public.chat_messages (id, challenge_id, sender_type, sender_user_id, body)
  values (v_id, p_challenge_id, 'participant', uid, v_body)
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
      -- The object must actually exist (client uploads before calling this) —
      -- no attachment row for a phantom path (mirrors submit_retroactive_*).
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

comment on function public.post_chat_message(uuid, text, uuid, jsonb) is
  'Participant writes one message (text, 1-4 images, or both) to a challenge '
  'room, atomically with its attachment rows. sender_user_id is always '
  'auth.uid() and sender_type always ''participant''. Every attachment path '
  'must sit under {challenge}/{caller}/{message}/ and name a real chat-media '
  'object. 1000-char cap, 4-image cap, 10/30s rate limit.';

revoke all on function public.post_chat_message(uuid, text, uuid, jsonb) from public, anon;
grant execute on function public.post_chat_message(uuid, text, uuid, jsonb) to authenticated;

-- ----------------------------------------------------------------------------
-- list_chat_messages  (drop + recreate — the return shape gains a column)
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
  created_at          timestamptz
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
    -- Same gate as body: real attachment list for an active row or an admin;
    -- '[]' for a hidden row seen by a member — no image path leaves the DB.
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
    c.created_at
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
  'Membership-checked. A moderated message is a real row (id, seq, sender, '
  'status=''hidden'') with body NULL and attachments ''[]'' for a non-admin — '
  'the original text and image paths stay in the DB for admins and audit only.';

revoke all on function public.list_chat_messages(uuid, bigint, integer) from public, anon;
grant execute on function public.list_chat_messages(uuid, bigint, integer) to authenticated;
