-- ============================================================================
-- Hälsoutmaningen — Shared Chat / 0018  chat_messages + chat_read_state schema
--
-- Spec: docs/superpowers/specs/2026-09-05-shared-chat-design.md
-- Plan: docs/superpowers/plans/2026-09-05-shared-chat-implementation.md (Task 2)
--
-- Depends on 0001–0017. Forward-only, non-destructive, ADDITIVE. This migration
-- adds ONLY two new tables plus RLS, indexes, the audit-vocabulary widening and
-- a guarded Realtime publication grant. Nothing in the existing schema is
-- altered; there is no foreign key from any core table to a chat table.
--
--   chat_messages     one row per message (participant OR game_master), append
--                     only from the app's point of view — never edited or
--                     deleted by a participant; an admin only ever flips
--                     status='hidden' via hide_chat_message (0019, next
--                     migration). The Game Master integration migration (Plan 3)
--                     later ALTERs this table to add game_master_event_id.
--   chat_read_state   one row per (challenge, user): last_read_seq is the sole
--                     authority for unread counts. Written only by
--                     mark_chat_read (0019).
--
-- `seq` is a `generated always as identity` column and is the ONLY
-- ordering / pagination / read-state cursor key. `created_at` is display
-- metadata only. A Postgres identity column allocates strictly increasing,
-- unique values, but allocation order is NOT guaranteed to equal transaction
-- commit order under concurrency — `seq` is used because it is the single
-- deterministic total order every reader can agree on, and the client always
-- refetches anything with seq greater than what it has reconciled, so the rare
-- allocation-vs-commit reorder at the boundary self-heals and is never
-- load-bearing for a count or security guarantee.
--
-- All writes go through the SECURITY DEFINER RPCs in the next migration
-- (post_chat_message / mark_chat_read / hide_chat_message). This migration
-- creates NO write policy for any app role, exactly like
-- 20260904130000_game_master_foundation.sql shipped its schema a full task
-- before its RPCs.
-- ============================================================================

-- Widen the append-only audit entity vocabulary (precedent: 0007, 0014, 0015).
alter table public.audit_log
  drop constraint if exists audit_log_entity_type_valid;
alter table public.audit_log
  add constraint audit_log_entity_type_valid
  check (entity_type in (
    'profile', 'challenge', 'challenge_membership', 'training_entry',
    'training_proof', 'challenge_penalty_definition', 'earned_penalty',
    'penalty_assignment', 'retroactive_training_request',
    'game_master_settings', 'game_master_event',
    'chat_message'
  ));

-- ----------------------------------------------------------------------------
-- chat_messages
-- ----------------------------------------------------------------------------
create table public.chat_messages (
  id                uuid primary key default gen_random_uuid(),
  seq               bigint generated always as identity,
  challenge_id      uuid not null references public.challenges (id) on delete cascade,
  sender_type       text not null
                      constraint chat_messages_sender_type_valid
                      check (sender_type in ('participant', 'game_master')),
  -- NOT NULL for a participant message (always auth.uid()); NULL for a
  -- game_master message. Enforced by chat_messages_sender_coherent below.
  sender_user_id    uuid references public.profiles (id),
  body              text not null
                      constraint chat_messages_body_len
                      check (char_length(body) between 1 and 1000),
  status            text not null default 'active'
                      constraint chat_messages_status_valid
                      check (status in ('active', 'hidden')),
  hidden_at         timestamptz,
  hidden_by         uuid references public.profiles (id),
  hidden_reason     text
                      constraint chat_messages_hidden_reason_len
                      check (hidden_reason is null or char_length(hidden_reason) <= 1000),
  -- DISPLAY ONLY — date separators, "sent at HH:MM". Never an ordering key.
  created_at        timestamptz not null default now(),

  constraint chat_messages_sender_coherent
    check (
      (sender_type = 'participant' and sender_user_id is not null)
      or (sender_type = 'game_master' and sender_user_id is null)
    ),
  -- Same shape as game_master_events_check1
  -- (20260904130000_game_master_foundation.sql): a hidden row carries the full
  -- moderation trail; an active row carries none of it.
  constraint chat_messages_hidden_coherent
    check (
      (status <> 'hidden' and hidden_at is null and hidden_by is null and hidden_reason is null)
      or (status = 'hidden' and hidden_at is not null and hidden_by is not null
          and length(btrim(hidden_reason)) > 0)
    )
);

comment on table public.chat_messages is
  'One shared chat room per challenge. seq (identity) is the sole ordering / '
  'pagination / read-state key; created_at is display metadata only. Written '
  'only by post_chat_message / hide_chat_message (0019) and by Game Master''s '
  'own internal insert path (Plan 3). No participant edit or delete — an admin '
  'only ever sets status=hidden; the row and its body are always retained.';

comment on column public.chat_messages.seq is
  'Monotonic identity cursor. Allocation order is not a commit-order guarantee '
  '(spec §2.2) — it is the single deterministic total order every reader agrees '
  'on. Clients sort and paginate by this, never by created_at or arrival order.';

create index chat_messages_challenge_seq_idx
  on public.chat_messages (challenge_id, seq desc);
create index chat_messages_sender_recent_idx
  on public.chat_messages (sender_user_id, created_at desc)
  where sender_type = 'participant';

-- ----------------------------------------------------------------------------
-- chat_read_state
-- ----------------------------------------------------------------------------
create table public.chat_read_state (
  challenge_id          uuid not null references public.challenges (id) on delete cascade,
  user_id               uuid not null references public.profiles (id) on delete cascade,
  last_read_seq         bigint not null default 0,
  -- Denormalised convenience for "jump to first unread"; kept in sync with
  -- last_read_seq by mark_chat_read. last_read_seq is authoritative for every
  -- count / comparison.
  last_read_message_id  uuid references public.chat_messages (id) on delete set null,
  updated_at            timestamptz not null default now(),
  primary key (challenge_id, user_id)
);

comment on table public.chat_read_state is
  'Per-(challenge,user) read cursor. Unread = count of chat_messages with '
  'seq > last_read_seq for the challenge. Written only by mark_chat_read, which '
  'can never move last_read_seq backwards.';

-- ============================================================================
-- RLS — read-only for the app. All writes are SECURITY DEFINER RPCs (0019).
-- ============================================================================
alter table public.chat_messages    enable row level security;
alter table public.chat_read_state  enable row level security;

-- Supabase's default privileges hand new public tables to anon/authenticated;
-- this subsystem is read-only from the app, so pull everything back first, then
-- grant SELECT only (the RPCs run as owner and bypass RLS).
revoke all on public.chat_messages, public.chat_read_state
  from anon, authenticated;

grant select on public.chat_messages   to authenticated;
grant select on public.chat_read_state to authenticated;

-- Any admin, or any member (active or not) of the challenge, may read every
-- message in that challenge's room — including hidden ones, which still occupy
-- a seq and still count as unread; the client substitutes the placeholder at
-- display time (spec §3.4).
create policy chat_messages_select on public.chat_messages
  for select to authenticated
  using (public.is_admin() or public.is_challenge_member(challenge_id));

-- A viewer sees only their own read cursor.
create policy chat_read_state_select on public.chat_read_state
  for select to authenticated
  using (user_id = (select auth.uid()));

-- No INSERT / UPDATE / DELETE policy on either table: post_chat_message,
-- mark_chat_read, hide_chat_message (0019) and Game Master's internal
-- chat-delivery insert (Plan 3) are the only writers. A client cannot submit
-- another sender_user_id or sender_type='game_master' because there is no
-- INSERT path that accepts either — a structural guarantee, not a policy check.

-- ============================================================================
-- Realtime — enable INSERT streaming on chat_messages only.
--
-- Guarded: on the hosted project the supabase_realtime publication always
-- exists, so this activates chat Realtime on rollout. In a bare local
-- `supabase db reset` stack the publication may be absent; a NOTICE is raised
-- and the migration chain proceeds (pgTAP does not exercise Realtime delivery).
-- Same defensive pattern as the pg_cron wiring in
-- 20260904130100_game_master_engine.sql.
-- ============================================================================
do $$
begin
  alter publication supabase_realtime add table public.chat_messages;
  raise notice 'shared chat: chat_messages added to the supabase_realtime publication';
exception when others then
  raise notice 'shared chat: could not add chat_messages to supabase_realtime (%), Realtime not enabled in this environment', sqlerrm;
end
$$;
