-- ============================================================================
-- Hälsoutmaningen — Training activity cards in Shared Chat / 0029
--
-- When a real `training_entries` row is created — by the normal "Logga träning"
-- upsert, by `add_training_session` (Dubbelpass), or by
-- `approve_retroactive_registration` materialising an approved after-registration
-- — one automatic "training card" appears in that challenge's shared chat room.
--
-- Design (source of truth = the training entry):
--   * A card is a `chat_messages` row with a new `sender_type = 'training_card'`
--     and a `training_entry_id` FK. It has NO free-text body — every visible
--     field is resolved LIVE from `training_entries` / `training_proofs` by the
--     `list_chat_messages` read model, so the card always reflects the entry's
--     current authoritative state (including invalidation).
--   * Creation is an AFTER INSERT trigger on `training_entries` — atomic with the
--     entry, so a successful entry can never permanently miss its card because a
--     client follow-up failed. All three creation paths INSERT into
--     `training_entries`, so all three get a card with no per-path code.
--   * Idempotent: `training_entry_id` is UNIQUE and the trigger uses
--     `on conflict do nothing`. A retried submit is an UPDATE (upsert on the
--     existing row) → the AFTER INSERT trigger does not re-fire → no duplicate.
--   * NOT spoofable: a participant cannot INSERT `chat_messages` (no INSERT
--     policy) and `post_chat_message` always writes `sender_type='participant'`.
--     The trigger is the only writer of a `training_card` row.
--   * NO BACKFILL: the trigger only fires on rows inserted after this migration.
--     This migration does NOT loop historical `training_entries`.
--   * Retroactive SUBMIT creates only a `retroactive_training_requests` row (no
--     `training_entries` INSERT) → no card. Only APPROVAL, which materialises
--     the entry, produces the card. A rejected request → no entry → no card.
--   * Realtime: unchanged. The card is a `chat_messages` INSERT, so the existing
--     `chat_messages_activity_fanout` trigger bumps `chat_activity` and clients
--     refetch through `list_chat_messages`. Nothing new is published.
--   * Moderation: a training card is an ordinary `chat_messages` row for
--     `hide_chat_message` (which only refuses `game_master` rows). Hiding it
--     withholds the card payload from members exactly like a hidden message's
--     body / attachments.
--   * NO CORE MUTATION: the trigger only INSERTs a `chat_messages` row. It never
--     touches day state, streak, debt, KASSAN, Straffbanken, ranking or weight.
--     Direction of dependency stays: training core -> social representation.
--
-- Depends on 0018–0021 (chat), 0027–0028 (chat images), 0001/0003 (training).
-- Forward-only, additive: one new column + constraints on `chat_messages`, one
-- trigger, and a `list_chat_messages` return-shape widening (a new
-- `training_card jsonb` column — same drop+recreate dance as 0028's
-- `attachments`).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. chat_messages — the 'training_card' sender type + the training_entry link
-- ----------------------------------------------------------------------------
alter table public.chat_messages
  drop constraint if exists chat_messages_sender_type_valid;
alter table public.chat_messages
  add constraint chat_messages_sender_type_valid
  check (sender_type in ('participant', 'game_master', 'training_card'));

alter table public.chat_messages
  add column if not exists training_entry_id uuid
    references public.training_entries (id) on delete cascade;

-- At most one auto card per training entry. Nullable → the many normal messages
-- with NULL never conflict; only real links dedupe (Postgres NULLs are distinct).
alter table public.chat_messages
  drop constraint if exists chat_messages_training_entry_uniq;
alter table public.chat_messages
  add constraint chat_messages_training_entry_uniq unique (training_entry_id);

-- Coherence: a 'training_card' row carries the trainer's user id and a
-- training_entry link and NO free text; the other two types carry neither link.
alter table public.chat_messages
  drop constraint if exists chat_messages_sender_coherent;
alter table public.chat_messages
  add constraint chat_messages_sender_coherent
  check (
    (sender_type = 'participant'
       and sender_user_id is not null and training_entry_id is null)
    or (sender_type = 'game_master'
       and sender_user_id is null     and training_entry_id is null)
    or (sender_type = 'training_card'
       and sender_user_id is not null and training_entry_id is not null
       and body is null)
  );

comment on column public.chat_messages.training_entry_id is
  'Set only for a sender_type=''training_card'' row — the training entry the '
  'card represents. UNIQUE (one card per entry; the constraint''s index also '
  'serves the card lookup). ON DELETE CASCADE: if the entry row is physically '
  'removed the card goes with it; an INVALIDATED entry is NOT deleted, so its '
  'card stays and renders "Passet har underkänts" from the live entry status.';

-- ----------------------------------------------------------------------------
-- 2. tg_training_entry_chat_card — the only writer of a training_card row
-- ----------------------------------------------------------------------------
create or replace function public.tg_training_entry_chat_card()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Only an active entry announces itself. An entry inserted already
  -- 'invalidated' (an admin correction path, if one ever exists) gets no card.
  if new.status <> 'active' then
    return null;
  end if;

  insert into public.chat_messages
    (challenge_id, sender_type, sender_user_id, body, training_entry_id)
  values
    (new.challenge_id, 'training_card', new.user_id, null, new.id)
  on conflict (training_entry_id) do nothing;

  return null;
end;
$$;

comment on function public.tg_training_entry_chat_card() is
  'AFTER INSERT on training_entries: create exactly one training_card chat '
  'message for the new entry (idempotent via the training_entry_id UNIQUE '
  'constraint). The only code path that writes a training_card row.';

revoke all on function public.tg_training_entry_chat_card()
  from public, anon, authenticated;

drop trigger if exists training_entries_chat_card on public.training_entries;
create trigger training_entries_chat_card
  after insert on public.training_entries
  for each row execute function public.tg_training_entry_chat_card();

-- ----------------------------------------------------------------------------
-- 3. list_chat_messages — resolve the card LIVE from the training entry
--    (drop + recreate: the return shape gains a `training_card jsonb` column,
--     mirroring how 0028 added `attachments`)
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
    -- The card payload, resolved live from the training entry. Same visibility
    -- gate as `body` / `attachments`: withheld (NULL) for a hidden card seen by
    -- a non-admin. The caller is already a challenge member (WHERE below), and
    -- the proof-object read policy independently allows members to read a
    -- challenge's training_proofs objects — so returning the paths here mints
    -- no new access.
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
  'status=''hidden'') with body NULL, attachments ''[]'' and training_card NULL '
  'for a non-admin. A sender_type=''training_card'' row resolves its payload '
  '(activity, duration, note, date, entry_status, proof paths) LIVE from the '
  'training entry — the entry is the source of truth, incl. invalidation.';

revoke all on function public.list_chat_messages(uuid, bigint, integer) from public, anon;
grant execute on function public.list_chat_messages(uuid, bigint, integer) to authenticated;
