-- ============================================================================
-- Hälsoutmaningen — Shared Chat / 0021  moderated-content read isolation
--
-- Spec: docs/superpowers/specs/2026-09-05-shared-chat-design.md §3.3 / §3.4 / §4
--       (this migration is the "corrected security model" the spec now
--       documents — see the "Security correction (2026-09-05)" block there)
-- Review: PR #3 finding I-1.
--
-- Depends on 0018 (20260905140000) + 0019 (20260905140100). Forward-only,
-- ADDITIVE except that it REPLACES the chat_messages SELECT policy and the
-- chat_messages Realtime publication membership — both tightenings, never a
-- widening.
--
-- Problem being fixed
-- -------------------
-- 0018 granted ordinary members a plain row-level SELECT on public.chat_messages
-- (`is_admin() or is_challenge_member(...)`), and 0019's hide_chat_message only
-- flips `status` + fills the moderation trail — the original `body` stays in the
-- row. So a moderated ("hidden") message's real text and its `hidden_reason`
-- were retrievable by any challenge member via direct PostgREST, a crafted
-- request, or a Realtime UPDATE payload — the placeholder was a client-render
-- swap only. CLAUDE.md §10/§17: authorization must live in the database.
--
-- Corrected model
-- --------------
--   * chat_messages base-table SELECT is now ADMIN-ONLY. Ordinary members have
--     NO direct read path to the table at all (so no column of a hidden row —
--     body, hidden_reason, hidden_by, hidden_at — can leak through PostgREST or
--     Realtime).
--   * Members read through public.list_chat_messages(...) / public.unread_chat_count(...)
--     — SECURITY DEFINER, membership-checked, which project `body` to NULL for a
--     hidden row (unless the caller is an admin) and never expose hidden_reason
--     to a non-admin. The row, its seq, its sender and its 'hidden' status are
--     still visible — a hidden message still occupies a seq and still counts as
--     unread; it just has no readable text.
--   * The original row and its original body remain stored, untouched, for
--     admins and audit/history.
--   * Realtime moves off chat_messages onto a new no-secrets signal table
--     public.chat_activity (challenge_id, seq, at) maintained by an AFTER
--     trigger. Clients keep TanStack Query as the canonical cache and refetch
--     via the RPCs on a signal; the socket never carries message text.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. chat_messages base-table SELECT: admin-only
-- ----------------------------------------------------------------------------
drop policy if exists chat_messages_select on public.chat_messages;

-- The grant stays (admins are the `authenticated` role in PostgREST); the
-- policy is what now restricts it. A non-admin member matches no policy → 0
-- rows, through PostgREST and through Realtime alike.
create policy chat_messages_select on public.chat_messages
  for select to authenticated
  using (public.is_admin());

comment on policy chat_messages_select on public.chat_messages is
  'Admin-only. Ordinary members never read this table directly — they use '
  'list_chat_messages / unread_chat_count, which withhold the body and '
  'hidden_reason of a moderated message. Prevents moderated content leaking '
  'via PostgREST or a Realtime payload (PR #3 finding I-1).';

-- ----------------------------------------------------------------------------
-- 2. chat_activity — the Realtime signal table (no message content)
-- ----------------------------------------------------------------------------
create table public.chat_activity (
  challenge_id uuid   not null references public.challenges (id) on delete cascade,
  seq          bigint not null,
  at           timestamptz not null default now(),
  primary key (challenge_id, seq)
);

comment on table public.chat_activity is
  'Realtime fan-out signal for shared chat. One row per chat_messages row, '
  'upserted by an AFTER trigger on INSERT and on a status change. Carries NO '
  'message text, sender or moderation data — only (challenge_id, seq, at) — so '
  'a Realtime subscriber learns "something changed in room X" and refetches '
  'via list_chat_messages, and no moderated content can ever ride the socket.';

alter table public.chat_activity enable row level security;
revoke all on public.chat_activity from anon, authenticated;
grant select on public.chat_activity to authenticated;

create policy chat_activity_select on public.chat_activity
  for select to authenticated
  using (public.is_admin() or public.is_challenge_member(challenge_id));

create or replace function public.tg_chat_activity_fanout()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.chat_activity (challenge_id, seq, at)
  values (new.challenge_id, new.seq, now())
  on conflict (challenge_id, seq) do update set at = excluded.at;
  return null;
end;
$$;

create trigger chat_messages_activity_fanout
  after insert or update of status on public.chat_messages
  for each row execute function public.tg_chat_activity_fanout();

-- ----------------------------------------------------------------------------
-- 3. Realtime publication — off chat_messages, onto chat_activity
-- ----------------------------------------------------------------------------
do $$
begin
  alter publication supabase_realtime drop table public.chat_messages;
  raise notice 'shared chat: chat_messages removed from supabase_realtime (moderated content must not ride the socket)';
exception when others then
  raise notice 'shared chat: could not drop chat_messages from supabase_realtime (%), continuing', sqlerrm;
end
$$;

do $$
begin
  alter publication supabase_realtime add table public.chat_activity;
  raise notice 'shared chat: chat_activity added to supabase_realtime (no-secrets signal table)';
exception when others then
  raise notice 'shared chat: could not add chat_activity to supabase_realtime (%), Realtime not enabled in this environment', sqlerrm;
end
$$;

-- ----------------------------------------------------------------------------
-- 4. list_chat_messages — the members' read surface
-- ----------------------------------------------------------------------------
-- Newest-first page. `p_before_seq` NULL = newest page; otherwise the page
-- immediately older than that seq (strict `<`), matching 0019's cursor rule.
-- A non-member (and anon, which cannot execute this at all) gets zero rows.
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
    -- Original text only for an active row, or for an admin caller (a moderator
    -- scrolling the room still sees context). A hidden row shows NULL body to a
    -- member — the client renders the fixed placeholder; the real text never
    -- leaves the database. hidden_reason / hidden_by / hidden_at are NOT
    -- projected at all — an admin reads those from chat_messages directly.
    case
      when c.status = 'active' or public.is_admin() then c.body
      else null
    end as body,
    c.status,
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
  'Membership-checked. A moderated message is returned as a real row (id, seq, '
  'sender, status=''hidden'') but with body NULL for a non-admin caller, and '
  'no moderation trail (hidden_reason/by/at) is ever projected — the original '
  'text stays in chat_messages for admins and audit only. `p_before_seq` is '
  'the strict upper bound for upward pagination.';

revoke all on function public.list_chat_messages(uuid, bigint, integer) from public, anon;
grant execute on function public.list_chat_messages(uuid, bigint, integer) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. unread_chat_count — exact unread, no content
-- ----------------------------------------------------------------------------
create or replace function public.unread_chat_count(p_challenge_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when not (public.is_admin() or public.is_challenge_member(p_challenge_id)) then 0
    else coalesce((
      select count(*)::integer
      from public.chat_messages c
      where c.challenge_id = p_challenge_id
        and c.seq > coalesce((
          select r.last_read_seq
          from public.chat_read_state r
          where r.challenge_id = p_challenge_id
            and r.user_id = (select auth.uid())
        ), 0)
    ), 0)
  end;
$$;

comment on function public.unread_chat_count(uuid) is
  'Exact unread count for the caller in a challenge room: chat_messages with '
  'seq > the caller''s last_read_seq (0 if no read-state row). A moderated '
  'message still occupies a seq and still counts. Non-member → 0.';

revoke all on function public.unread_chat_count(uuid) from public, anon;
grant execute on function public.unread_chat_count(uuid) to authenticated;
