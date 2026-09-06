-- ============================================================================
-- Hälsoutmaningen — Weight Tracking / Viktkampen / schema + RLS
--
-- Spec: docs/superpowers/specs/2026-09-05-weight-tracking-design.md §1, §3
-- Plan: docs/superpowers/plans/2026-09-05-weight-tracking-implementation.md (Task 2)
--
-- Depends on 0001–0021. Forward-only, ADDITIVE. Three new tables plus RLS,
-- indexes and the audit-vocabulary widening. Nothing in the existing schema is
-- altered; there is NO foreign key from any core / chat / Game Master table to
-- a weight table, and NO trigger on a core table references weight tracking
-- (spec §8). All writes go through the SECURITY DEFINER RPCs in the next
-- migration — this migration creates NO write policy for any app role, exactly
-- like 20260905140000_chat_schema.sql / 20260904130000_game_master_foundation.sql
-- shipped schema a task before their RPCs.
--
--   weight_profiles              one row per (challenge, participant): the
--                                24h-locked start weight, the hide-my-weight
--                                flag (works even before a start weight exists),
--                                and the admin-only official final weigh-in.
--                                start_weight_first_saved_at / _locked_at are
--                                set ONCE by set_start_weight's first call and
--                                are NEVER written again by any RPC (§1.1).
--   weight_entries               optional daily regular logging. entry_date is
--                                always challenge_current_date() at write time
--                                — backdating is structurally impossible (§2.3).
--   weight_competition_results   one row per challenge: the official winner,
--                                with a narrow separate disclosure gate for a
--                                hidden winner (§1.3 / §2.7).
--
-- Weight tracking must not change or affect completed/missed day state,
-- training requirement, streak, debt/liability, KASSAN, training ranking,
-- Straffbanken, retroactive registration, or training registration (§0, §8).
-- ============================================================================

-- Widen the append-only audit entity vocabulary (precedent: 0007, 0014, 0015,
-- 0018). Full current list + 'weight_profile'.
alter table public.audit_log
  drop constraint if exists audit_log_entity_type_valid;
alter table public.audit_log
  add constraint audit_log_entity_type_valid
  check (entity_type in (
    'profile', 'challenge', 'challenge_membership', 'training_entry',
    'training_proof', 'challenge_penalty_definition', 'earned_penalty',
    'penalty_assignment', 'retroactive_training_request',
    'game_master_settings', 'game_master_event', 'chat_message',
    'weight_profile'
  ));

-- ----------------------------------------------------------------------------
-- weight_profiles
-- ----------------------------------------------------------------------------
create table public.weight_profiles (
  challenge_id                uuid not null references public.challenges (id) on delete cascade,
  user_id                     uuid not null references public.profiles (id) on delete cascade,

  start_weight_kg             numeric
                                constraint weight_profiles_start_weight_positive
                                check (start_weight_kg is null or start_weight_kg > 0),
  -- Set ONCE at the participant's first successful start-weight save. NEVER
  -- updated again by any RPC, including admin correction.
  start_weight_first_saved_at timestamptz,
  -- Set ONCE, = start_weight_first_saved_at + interval '24 hours', at the same
  -- moment. NEVER recomputed — not on participant edits inside the window,
  -- not on a later admin correction of the value.
  start_weight_locked_at      timestamptz,

  is_weight_hidden            boolean not null default false,

  -- Official final weigh-in (§6). Admin-only, always audited on every write.
  official_final_weight_kg    numeric
                                constraint weight_profiles_official_final_positive
                                check (official_final_weight_kg is null or official_final_weight_kg > 0),
  official_final_recorded_at  timestamptz,
  official_final_recorded_by  uuid references public.profiles (id),

  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),

  primary key (challenge_id, user_id),

  -- start_weight_kg / first_saved_at / locked_at are all-null or all-set.
  constraint weight_profiles_start_weight_coherent
    check ((start_weight_kg is null) = (start_weight_first_saved_at is null)
       and (start_weight_first_saved_at is null) = (start_weight_locked_at is null)),
  -- official_final_weight_kg / recorded_at / recorded_by are all-null or all-set.
  constraint weight_profiles_official_final_coherent
    check ((official_final_weight_kg is null) = (official_final_recorded_at is null)
       and (official_final_recorded_at is null) = (official_final_recorded_by is null))
);

comment on table public.weight_profiles is
  'One row per (challenge, participant). Holds the 24h-locked start weight, the '
  'hide-my-weight flag (may exist with every other column null, created purely '
  'to hold is_weight_hidden before any weight is entered), and the admin-only '
  'official final weigh-in. start_weight_first_saved_at / _locked_at are the '
  'historical facts of the participant''s own first save — set once, never moved.';

comment on column public.weight_profiles.start_weight_locked_at is
  'first_saved_at + 24h, set at the same instant as first_saved_at. After this '
  'moment the participant cannot self-correct — only correct_start_weight '
  '(admin) can, and it changes the VALUE only, never this timestamp.';

create trigger weight_profiles_set_updated_at
  before update on public.weight_profiles
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- weight_entries
-- ----------------------------------------------------------------------------
create table public.weight_entries (
  id            uuid primary key default gen_random_uuid(),
  challenge_id  uuid not null references public.challenges (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  -- Always challenge_current_date(challenge_id) at write time (log_weight_entry
  -- takes no date parameter). One official regular entry per participant/day;
  -- editable in place while it is still today, immutable once the day rolls
  -- over (unreachable by the RPC after that — not a runtime check on old rows).
  entry_date    date not null,
  weight_kg     numeric not null check (weight_kg > 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint weight_entries_unique_day unique (challenge_id, user_id, entry_date)
);

comment on table public.weight_entries is
  'Optional daily regular weight logging. No proof image, no training '
  'dependency. entry_date is always the challenge-local current date at write '
  'time — backdating is structurally impossible (log_weight_entry has no date '
  'parameter). Visibility is derived live by joining weight_profiles.is_weight_hidden.';

create trigger weight_entries_set_updated_at
  before update on public.weight_entries
  for each row execute function public.set_updated_at();

create index weight_entries_challenge_user_idx
  on public.weight_entries (challenge_id, user_id, entry_date desc);

-- ----------------------------------------------------------------------------
-- weight_competition_results
-- ----------------------------------------------------------------------------
create table public.weight_competition_results (
  challenge_id              uuid primary key references public.challenges (id) on delete cascade,
  winner_user_id            uuid references public.profiles (id),
  winner_percentage_change  numeric,   -- negative = weight lost (ranking formula, §7)
  determined_at             timestamptz not null default now(),
  determined_by             uuid references public.profiles (id),
  -- Narrow, explicit publication of exactly {winner_user_id,
  -- winner_percentage_change} even when the winner has is_weight_hidden=true.
  -- Never reveals start/final kg or history, never affects any other
  -- participant (§1.3 / §2.7). The read model weight_final_result is the
  -- field-gating enforcement point — see §3.
  disclosed_at              timestamptz,
  disclosed_by              uuid references public.profiles (id),

  constraint weight_competition_results_disclosure_coherent
    check ((disclosed_at is null) = (disclosed_by is null))
);

comment on table public.weight_competition_results is
  'Singleton per challenge: the official Viktkampen outcome. finalize_weight_'
  'competition never consults is_weight_hidden — a hidden participant is fully '
  'eligible to win. disclose_weight_winner is the ONLY path that makes a hidden '
  'winner''s name + percentage visible to co-members, and it touches nothing '
  'else.';

-- ============================================================================
-- RLS — read-only for the app. Every write goes through §2's SECURITY DEFINER
-- RPCs (next migration). Hide-my-weight is enforced HERE and only here: the
-- three-way policy shape (owner / admin / not-hidden-and-member) is the single
-- point every reader passes through (spec §4).
-- ============================================================================
alter table public.weight_profiles            enable row level security;
alter table public.weight_entries             enable row level security;
alter table public.weight_competition_results enable row level security;

revoke all on public.weight_profiles, public.weight_entries, public.weight_competition_results
  from anon, authenticated;
grant select on public.weight_profiles            to authenticated;
grant select on public.weight_entries             to authenticated;
grant select on public.weight_competition_results to authenticated;

-- Owner always; admin always; a co-member only when NOT hidden. Retroactive by
-- construction — visibility is computed live from the current is_weight_hidden
-- on every read, never snapshotted.
create policy weight_profiles_select on public.weight_profiles
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.is_admin()
    or (not is_weight_hidden and public.is_challenge_member(challenge_id))
  );

-- Same three-way shape; the hide flag lives on weight_profiles, so a co-member
-- read is gated by "no hidden weight_profiles row exists for this (challenge,
-- user)". Owner / admin clauses first, always true regardless of hiding.
create policy weight_entries_select on public.weight_entries
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.is_admin()
    or (
      public.is_challenge_member(challenge_id)
      and not exists (
        select 1 from public.weight_profiles wp
        where wp.challenge_id = weight_entries.challenge_id
          and wp.user_id = weight_entries.user_id
          and wp.is_weight_hidden
      )
    )
  );

-- Any challenge member (not just admin) may read this row — hiding the row
-- itself would also hide "has a winner been determined yet". WHICH fields a
-- hidden winner exposes is gated by weight_final_result (§3), not here.
create policy weight_competition_results_select on public.weight_competition_results
  for select to authenticated
  using (
    public.is_admin()
    or public.is_challenge_member(challenge_id)
  );

-- No INSERT / UPDATE / DELETE policy on any of the three tables: set_start_weight,
-- correct_start_weight, log_weight_entry, set_weight_hidden,
-- set_official_final_weight, finalize_weight_competition, disclose_weight_winner
-- (next migration) are the only writers — a structural guarantee, not a policy
-- check. A client cannot change another participant's weight, backdate an
-- entry, edit a locked start weight, or forge the lock timestamps.
