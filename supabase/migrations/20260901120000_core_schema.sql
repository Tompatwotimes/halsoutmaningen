-- ============================================================================
-- Hälsoutmaningen — 0001 core schema
--
-- Creates the base tables, constraints and indexes. No RLS policies, functions
-- or storage here — those follow in 0002 / 0003. Nothing in this file drops or
-- rewrites existing objects; it only CREATEs.
--
-- Domain rules mirrored here come from CLAUDE.md, docs/PRODUCT_SPEC.md,
-- docs/ARCHITECTURE.md and the confirmed V1 decisions in
-- docs/IMPLEMENTATION_PLAN.md §1.
-- ============================================================================

-- gen_random_uuid() is built in on the Postgres version Supabase runs, but be
-- explicit so the migration is self-contained.
create extension if not exists pgcrypto;

-- Shared trigger: keep updated_at honest on any table that has it.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.set_updated_at is
  'BEFORE UPDATE trigger helper: sets updated_at = now().';

-- ----------------------------------------------------------------------------
-- profiles — application identity, 1:1 with auth.users
-- ----------------------------------------------------------------------------
create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  display_name  text not null
                  constraint profiles_display_name_len
                  check (char_length(btrim(display_name)) between 1 and 80),
  avatar_path   text
                  constraint profiles_avatar_path_len
                  check (avatar_path is null or char_length(avatar_path) <= 400),
  role          text not null default 'participant'
                  constraint profiles_role_valid
                  check (role in ('participant', 'admin')),
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.profiles is
  'Application profile attached to an auth.users identity. role/active are '
  'admin-controlled only (enforced by trigger in 0002).';

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- challenges — reusable challenge configuration
-- ----------------------------------------------------------------------------
create table public.challenges (
  id                uuid primary key default gen_random_uuid(),
  name              text not null
                      constraint challenges_name_len
                      check (char_length(btrim(name)) between 1 and 120),
  start_date        date not null,
  end_date          date not null,
  timezone          text not null default 'Europe/Stockholm',
  required_minutes  integer not null
                      constraint challenges_required_minutes_positive
                      check (required_minutes > 0 and required_minutes <= 1440),
  proof_required    boolean not null default true,
  -- Whole SEK. Fractional costs would migrate to minor units later.
  missed_day_cost   integer not null
                      constraint challenges_missed_day_cost_nonneg
                      check (missed_day_cost >= 0),
  status            text not null default 'draft'
                      constraint challenges_status_valid
                      check (status in ('draft', 'active', 'completed', 'archived')),
  created_by        uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint challenges_end_after_start check (end_date >= start_date),
  -- Guard against absurd ranges (>5 years) that would blow up generate_series.
  constraint challenges_range_sane check (end_date - start_date <= 1830)
);

comment on table public.challenges is
  'Reusable challenge. Number of days, matrix columns and max liability are '
  'DERIVED from start_date/end_date — never stored. Rule fields lock once the '
  'challenge is no longer a draft or has started (trigger in 0002).';

-- Timezone validity is checked by a trigger in 0002 (needs pg_timezone_names).

create trigger challenges_set_updated_at
  before update on public.challenges
  for each row execute function public.set_updated_at();

create index challenges_status_idx on public.challenges (status);
create index challenges_created_by_idx on public.challenges (created_by);

-- ----------------------------------------------------------------------------
-- challenge_memberships — date-aware participant <-> challenge link
-- ----------------------------------------------------------------------------
create table public.challenge_memberships (
  id                        uuid primary key default gen_random_uuid(),
  challenge_id              uuid not null references public.challenges (id) on delete cascade,
  user_id                   uuid not null references public.profiles (id) on delete cascade,
  participation_start_date  date not null,
  participation_end_date    date,          -- inclusive; null => through challenge end
  active                    boolean not null default true,
  created_by                uuid references public.profiles (id) on delete set null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),

  -- Exactly one membership row per (challenge, user) in V1. Rejoin = widen the
  -- window. Membership history lives in audit_log.
  constraint challenge_memberships_unique_member unique (challenge_id, user_id),
  constraint challenge_memberships_window_order
    check (participation_end_date is null
           or participation_end_date >= participation_start_date)
);

comment on table public.challenge_memberships is
  'Participation window is authoritative for evaluation. participation_end_date '
  'is INCLUSIVE. active gates current visibility/logging only and must never '
  'rewrite historical day-state.';

-- Window must intersect the challenge range — enforced by trigger in 0002
-- (cross-table check).

create trigger challenge_memberships_set_updated_at
  before update on public.challenge_memberships
  for each row execute function public.set_updated_at();

create index challenge_memberships_user_idx
  on public.challenge_memberships (user_id);
create index challenge_memberships_challenge_active_idx
  on public.challenge_memberships (challenge_id, active);

-- ----------------------------------------------------------------------------
-- training_entries — one canonical entry per participant / challenge / day
-- ----------------------------------------------------------------------------
create table public.training_entries (
  id                 uuid primary key default gen_random_uuid(),
  challenge_id       uuid not null references public.challenges (id) on delete cascade,
  user_id            uuid not null references public.profiles (id) on delete cascade,
  challenge_date     date not null,
  duration_minutes   integer not null
                       constraint training_entries_duration_positive
                       check (duration_minutes > 0 and duration_minutes <= 1440),
  activity           text
                       constraint training_entries_activity_len
                       check (activity is null or char_length(activity) <= 120),
  note               text
                       constraint training_entries_note_len
                       check (note is null or char_length(note) <= 2000),
  -- 'active'      = counts toward completion
  -- 'invalidated' = admin correction; does NOT qualify (kept for the audit trail)
  status             text not null default 'active'
                       constraint training_entries_status_valid
                       check (status in ('active', 'invalidated')),
  invalidated_reason text
                       constraint training_entries_invalidated_reason_len
                       check (invalidated_reason is null
                              or char_length(invalidated_reason) <= 1000),
  invalidated_by     uuid references public.profiles (id) on delete set null,
  invalidated_at     timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint training_entries_unique_day
    unique (challenge_id, user_id, challenge_date),
  constraint training_entries_invalidation_coherent
    check ((status = 'invalidated') = (invalidated_at is not null))
);

comment on table public.training_entries is
  'Canonical daily training result. Participants may only create/edit/delete '
  'their own row on the current challenge-local day (trigger in 0002). Admin '
  'corrections set status=invalidated and are audited.';

create trigger training_entries_set_updated_at
  before update on public.training_entries
  for each row execute function public.set_updated_at();

create index training_entries_challenge_date_idx
  on public.training_entries (challenge_id, challenge_date);
create index training_entries_user_challenge_idx
  on public.training_entries (user_id, challenge_id);

-- ----------------------------------------------------------------------------
-- training_proofs — metadata for a proof image in Storage
-- ----------------------------------------------------------------------------
create table public.training_proofs (
  id                 uuid primary key default gen_random_uuid(),
  training_entry_id  uuid not null references public.training_entries (id) on delete cascade,
  -- Denormalised from the entry for cheap RLS / storage-path checks. Kept
  -- consistent by a trigger in 0002.
  challenge_id       uuid not null references public.challenges (id) on delete cascade,
  user_id            uuid not null references public.profiles (id) on delete cascade,
  storage_path       text not null unique
                       constraint training_proofs_storage_path_len
                       check (char_length(storage_path) between 1 and 400),
  mime_type          text not null
                       constraint training_proofs_mime_valid
                       check (mime_type in ('image/jpeg', 'image/png', 'image/webp',
                                            'image/heic', 'image/heif')),
  size_bytes         bigint not null
                       constraint training_proofs_size_valid
                       check (size_bytes > 0 and size_bytes <= 15728640), -- 15 MiB
  width              integer check (width is null or width > 0),
  height             integer check (height is null or height > 0),
  created_at         timestamptz not null default now(),

  -- One proof per entry in V1 (replace = delete + re-insert, same day only).
  constraint training_proofs_one_per_entry unique (training_entry_id)
);

comment on table public.training_proofs is
  'Reference/metadata for a private Storage object. The image itself lives in '
  'the private "proofs" bucket. challenge_id/user_id are denormalised copies of '
  'the parent entry for RLS.';

create index training_proofs_user_idx on public.training_proofs (user_id);
create index training_proofs_challenge_idx on public.training_proofs (challenge_id);

-- ----------------------------------------------------------------------------
-- audit_log — append-only record of challenge-impacting admin actions
-- ----------------------------------------------------------------------------
-- No foreign keys on purpose: this is an append-only historical record and
-- must survive deletion of any entity it references. The AFTER DELETE audit
-- triggers would also fail an FK check against the just-deleted row.
create table public.audit_log (
  id              uuid primary key default gen_random_uuid(),
  actor_user_id   uuid,
  challenge_id    uuid,
  target_user_id  uuid,
  entity_type     text not null
                    constraint audit_log_entity_type_valid
                    check (entity_type in ('profile', 'challenge',
                                           'challenge_membership', 'training_entry',
                                           'training_proof')),
  entity_id       uuid,
  action          text not null
                    constraint audit_log_action_len
                    check (char_length(action) between 1 and 60),
  before_data     jsonb,
  after_data      jsonb,
  note            text
                    constraint audit_log_note_len
                    check (note is null or char_length(note) <= 2000),
  created_at      timestamptz not null default now()
);

comment on table public.audit_log is
  'Append-only. Written only by SECURITY DEFINER helpers/triggers (0002). '
  'Readable by admins only. No UPDATE/DELETE (enforced by trigger in 0002).';

create index audit_log_challenge_created_idx
  on public.audit_log (challenge_id, created_at desc);
create index audit_log_entity_idx on public.audit_log (entity_type, entity_id);
create index audit_log_actor_idx on public.audit_log (actor_user_id);
