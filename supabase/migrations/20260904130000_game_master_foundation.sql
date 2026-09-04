-- ============================================================================
-- Hälsoutmaningen — GM1 / 0015  Game Master persistence foundation
--
-- Depends on 0001–0014. Forward-only, non-destructive, ADDITIVE.
--
-- Game Master is an ISOLATED, OPTIONAL subsystem. It occasionally emits a
-- private ambush or a public roast, derived from authoritative challenge data,
-- and it can fail for days on end without any core symptom: training logging,
-- day states, streaks, liability/KASSAN, ranking, Straffbanken and
-- efterregistrering never read a Game Master row.
--
-- This migration adds ONLY new, self-contained tables plus one template
-- validation helper + trigger. It deliberately:
--   * adds NO foreign key FROM a core table TO a Game Master table
--   * adds NO trigger on a core table
--   * ships NO write RPC and NO INSERT/UPDATE/DELETE policy — the SECURITY
--     DEFINER RPCs in 0016 (GM1 engine) are the only writers; like
--     assign_penalty they run as owner and bypass RLS
--
-- Tables:
--   game_master_settings       per-challenge emergency brake + intensity
--   game_master_templates      hand-written roast catalogue (seeded in 0017)
--   game_master_events         a frozen, emitted surprise
--   game_master_event_views    per-user first-seen / dismissed bookkeeping
--   game_master_memories       structured facts with future story value
--   game_master_runs           one row per pulse decision (event or silence)
--
-- Helper:
--   public._game_master_validate_template(text) -> boolean
--     true iff the text uses only the approved GM1 placeholder vocabulary
--     (spec §18). A BEFORE INSERT/UPDATE trigger on game_master_templates
--     rejects a template whose title/body contains an unknown {placeholder}.
--
-- create_challenge() is intentionally NOT touched: it does not seed any other
-- per-challenge defaults either (Straffbanken uses a separate opt-in
-- seed_default_penalty_definitions call). Existing challenges are backfilled
-- once below; a challenge with no settings row is treated by 0016 as
-- "Game Master disabled / defaults".
-- ============================================================================

-- Widen the append-only audit entity vocabulary (precedent: 0007, 0014).
alter table public.audit_log
  drop constraint if exists audit_log_entity_type_valid;
alter table public.audit_log
  add constraint audit_log_entity_type_valid
  check (entity_type in (
    'profile', 'challenge', 'challenge_membership', 'training_entry',
    'training_proof', 'challenge_penalty_definition', 'earned_penalty',
    'penalty_assignment', 'retroactive_training_request',
    'game_master_settings', 'game_master_event'
  ));

-- ----------------------------------------------------------------------------
-- game_master_settings — per-challenge emergency brake
-- ----------------------------------------------------------------------------
create table public.game_master_settings (
  challenge_id uuid primary key references public.challenges(id) on delete cascade,
  enabled boolean not null default true,
  private_roasts_enabled boolean not null default true,
  public_roasts_enabled boolean not null default true,
  archive_enabled boolean not null default true,
  intensity text not null default 'normal'
    check (intensity in ('low','normal','high')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.game_master_settings is
  'Per-challenge Game Master emergency brake. A missing row = disabled / '
  'defaults. Written only by update_game_master_settings() (0016), which also '
  'writes the audit row. No direct INSERT/UPDATE/DELETE.';

create trigger game_master_settings_set_updated_at
  before update on public.game_master_settings
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- game_master_templates — the hand-written roast catalogue
-- ----------------------------------------------------------------------------
create table public.game_master_templates (
  id uuid primary key default gen_random_uuid(),
  template_key text not null unique,
  family text not null,
  visibility text not null check (visibility in ('private','public')),
  severity smallint not null check (severity between 1 and 5),
  title_template text not null,
  body_template text not null,
  weight numeric not null default 1 check (weight > 0),
  cooldown_hours integer not null default 72 check (cooldown_hours >= 0),
  once_per_subject boolean not null default false,
  archive boolean not null default true,
  final_weight numeric not null default 1 check (final_weight > 0),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.game_master_templates is
  'Hand-written GM1 roast templates (no AI). title_template / body_template may '
  'only use the approved placeholder vocabulary (spec §18); the '
  'game_master_templates_validate trigger enforces this on insert/update. '
  'Seeded in 0017. Frozen into game_master_events at emission time.';

create trigger game_master_templates_set_updated_at
  before update on public.game_master_templates
  for each row execute function public.set_updated_at();

create index gm_templates_family_enabled_idx
  on public.game_master_templates (family, enabled);

-- ----------------------------------------------------------------------------
-- game_master_events — a frozen, emitted surprise
-- ----------------------------------------------------------------------------
create table public.game_master_events (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.challenges(id) on delete cascade,
  family text not null,
  visibility text not null check (visibility in ('private','public')),
  subject_user_id uuid references public.profiles(id),
  template_id uuid references public.game_master_templates(id),
  severity smallint not null check (severity between 1 and 5),
  title_text text not null,
  body_text text not null,
  payload jsonb not null default '{}'::jsonb,
  archive boolean not null default true,
  status text not null default 'active'
    check (status in ('active','expired','cancelled')),
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles(id),
  cancelled_reason text,
  created_at timestamptz not null default now(),
  check (visibility <> 'private' or subject_user_id is not null),
  check (
    (status <> 'cancelled' and cancelled_at is null and cancelled_by is null and cancelled_reason is null)
    or
    (status = 'cancelled' and cancelled_at is not null and cancelled_by is not null and length(btrim(cancelled_reason)) > 0)
  )
);

comment on table public.game_master_events is
  'A single emitted Game Master surprise. title_text / body_text / payload are '
  'FROZEN at emission — later source-data changes never rewrite an old roast. '
  'Private events are visible only to their subject + admins; cancelled events '
  'are invisible to non-admins. Never read by any core calculation.';

create index gm_events_challenge_created_idx
  on public.game_master_events (challenge_id, created_at desc);
create index gm_events_challenge_status_starts_idx
  on public.game_master_events (challenge_id, status, starts_at);
create index gm_events_subject_created_idx
  on public.game_master_events (subject_user_id, created_at desc);
create index gm_events_template_created_idx
  on public.game_master_events (template_id, created_at desc);

-- ----------------------------------------------------------------------------
-- game_master_event_views — per-user first-seen / dismissed bookkeeping
-- ----------------------------------------------------------------------------
create table public.game_master_event_views (
  event_id uuid not null references public.game_master_events(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  first_seen_at timestamptz not null default now(),
  dismissed_at timestamptz,
  primary key (event_id,user_id)
);

comment on table public.game_master_event_views is
  'One row per (event, viewer): stops a browser refresh from replaying the same '
  'ambush forever. Written only by mark_game_master_event_seen() (0016). A '
  'viewer may read only their own rows.';

-- ----------------------------------------------------------------------------
-- game_master_memories — structured facts with future story value
-- ----------------------------------------------------------------------------
create table public.game_master_memories (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.challenges(id) on delete cascade,
  subject_user_id uuid references public.profiles(id),
  memory_type text not null,
  fingerprint text not null,
  memory_date date not null,
  importance smallint not null check (importance between 1 and 5),
  payload jsonb not null default '{}'::jsonb,
  earliest_callback_at timestamptz,
  expires_at timestamptz,
  callback_count integer not null default 0 check (callback_count >= 0),
  created_at timestamptz not null default now(),
  unique (challenge_id,fingerprint)
);

comment on table public.game_master_memories is
  'Structured facts (not prose) the Game Master may call back to later: a long '
  'streak that broke, an unusually large debt, a comeback. Idempotent per '
  '(challenge_id, fingerprint). Written only by the 0016 engine. Never read by '
  'any core calculation.';

create index gm_memories_challenge_subject_type_idx
  on public.game_master_memories (challenge_id, subject_user_id, memory_type);

-- ----------------------------------------------------------------------------
-- game_master_runs — one row per pulse decision
-- ----------------------------------------------------------------------------
create table public.game_master_runs (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.challenges(id) on delete cascade,
  source text not null check (source in ('event','scheduled')),
  outcome text not null check (outcome in ('event','silence','disabled','cooldown','error')),
  candidate_count integer not null default 0 check (candidate_count >= 0),
  eligible_count integer not null default 0 check (eligible_count >= 0),
  selected_event_id uuid references public.game_master_events(id),
  diagnostics jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

comment on table public.game_master_runs is
  'Observability: every Game Master pulse (event pulse or scheduled) records one '
  'row here — including a deliberate "silence" outcome. Admin-readable only.';

create index gm_runs_challenge_started_idx
  on public.game_master_runs (challenge_id, started_at desc);

-- ============================================================================
-- Template placeholder validation (spec §18)
-- ============================================================================
create or replace function public._game_master_validate_template(p_text text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  -- true iff every {token} in the text is part of the approved GM1 vocabulary.
  select not exists (
    select 1
    from regexp_matches(coalesce(p_text, ''), '\{[^{}]+\}', 'g') as m(groups)
    where m.groups[1] not in (
      '{name}', '{streak}', '{previous_streak}', '{missed_days}', '{debt_sek}',
      '{kassan_sek}', '{rank}', '{participant_count}', '{days_until_final}',
      '{final_date}', '{eligible_days}', '{completed_days}'
    )
  );
$$;

comment on function public._game_master_validate_template(text) is
  'GM1 template guard: true iff the text uses only the approved placeholder '
  'vocabulary from the Game Master v1 design spec §18. Internal — no app-role '
  'EXECUTE grant.';

revoke all on function public._game_master_validate_template(text) from public, anon;

create or replace function public._game_master_templates_validate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not public._game_master_validate_template(new.title_template) then
    raise exception
      'game_master_templates.title_template contains an unapproved placeholder: %',
      new.title_template
      using errcode = 'check_violation';
  end if;
  if not public._game_master_validate_template(new.body_template) then
    raise exception
      'game_master_templates.body_template contains an unapproved placeholder: %',
      new.body_template
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public._game_master_templates_validate() from public, anon;

create trigger game_master_templates_validate
  before insert or update on public.game_master_templates
  for each row execute function public._game_master_templates_validate();

-- ============================================================================
-- RLS — read-only for the app. All writes are SECURITY DEFINER RPCs (0016).
-- ============================================================================
alter table public.game_master_settings     enable row level security;
alter table public.game_master_templates    enable row level security;
alter table public.game_master_events       enable row level security;
alter table public.game_master_event_views  enable row level security;
alter table public.game_master_memories     enable row level security;
alter table public.game_master_runs         enable row level security;

-- Supabase's default privileges hand new public tables to anon/authenticated;
-- this subsystem is read-only from the app, so pull everything back first.
revoke all on public.game_master_settings,
              public.game_master_templates,
              public.game_master_events,
              public.game_master_event_views,
              public.game_master_memories,
              public.game_master_runs
  from anon, authenticated;

grant select on public.game_master_settings     to authenticated;
grant select on public.game_master_templates    to authenticated;
grant select on public.game_master_events       to authenticated;
grant select on public.game_master_event_views  to authenticated;
grant select on public.game_master_memories     to authenticated;
grant select on public.game_master_runs         to authenticated;

-- settings / templates / memories / runs — admin SELECT only ------------------
create policy game_master_settings_select on public.game_master_settings
  for select to authenticated
  using (public.is_admin());

create policy game_master_templates_select on public.game_master_templates
  for select to authenticated
  using (public.is_admin());

create policy game_master_memories_select on public.game_master_memories
  for select to authenticated
  using (public.is_admin());

create policy game_master_runs_select on public.game_master_runs
  for select to authenticated
  using (public.is_admin());

-- events — admin, OR a public non-cancelled event of a challenge you belong to,
-- OR your own private non-cancelled event. Cancelled events hide from non-admins.
create policy game_master_events_select on public.game_master_events
  for select to authenticated
  using (
    public.is_admin()
    or (
      visibility = 'public'
      and status <> 'cancelled'
      and public.is_challenge_member(challenge_id)
    )
    or (
      visibility = 'private'
      and status <> 'cancelled'
      and subject_user_id = (select auth.uid())
    )
  );

-- event views — a viewer sees only their own bookkeeping ---------------------
create policy game_master_event_views_select on public.game_master_event_views
  for select to authenticated
  using (user_id = (select auth.uid()));

-- No INSERT / UPDATE / DELETE policies anywhere: the 0016 SECURITY DEFINER RPCs
-- are the only writers (owner rights, bypass RLS — like assign_penalty).

-- ============================================================================
-- Backfill: one settings row per existing challenge. New challenges get none
-- until an admin opts in via update_game_master_settings() — 0016 treats a
-- missing row as "disabled / defaults".
-- ============================================================================
insert into public.game_master_settings (challenge_id)
select id from public.challenges
on conflict do nothing;
