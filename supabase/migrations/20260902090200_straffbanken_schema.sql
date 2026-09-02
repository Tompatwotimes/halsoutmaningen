-- ============================================================================
-- Hälsoutmaningen — Phase 9 / 0007  Straffbanken schema
--
-- Depends on 0001–0002 and 0006 (challenge lifecycle). Forward-only.
--
-- Three tables:
--   challenge_penalty_definitions  per-challenge configurable milestone catalog
--   earned_penalties               a participant's Straffbank inventory
--   penalty_assignments            a penalty applied to a target on a date
--
-- Writes to earned_penalties / penalty_assignments happen ONLY through the
-- SECURITY DEFINER RPCs in later migrations (reconcile / assign / cancel), which
-- own atomicity, idempotency and their own audit_log rows. Those tables get no
-- INSERT/UPDATE policies. challenge_penalty_definitions is edited directly by
-- admins (like challenges), gated by RLS + a lock guard + the generic audit
-- trigger.
-- ============================================================================

-- Widen the append-only audit entity vocabulary.
alter table public.audit_log
  drop constraint if exists audit_log_entity_type_valid;
alter table public.audit_log
  add constraint audit_log_entity_type_valid
  check (entity_type in (
    'profile', 'challenge', 'challenge_membership', 'training_entry',
    'training_proof', 'challenge_penalty_definition', 'earned_penalty',
    'penalty_assignment'
  ));

-- ----------------------------------------------------------------------------
-- challenge_penalty_definitions
-- ----------------------------------------------------------------------------
create table public.challenge_penalty_definitions (
  id            uuid primary key default gen_random_uuid(),
  challenge_id  uuid not null references public.challenges (id) on delete cascade,
  unlock_streak integer not null
                  constraint cpd_unlock_streak_valid
                  check (unlock_streak > 0 and unlock_streak <= 3660),
  penalty_type  text not null
                  constraint cpd_penalty_type_valid
                  check (penalty_type in ('minimum_minutes', 'double_session')),
  value         integer not null
                  constraint cpd_value_valid
                  check (
                    (penalty_type = 'minimum_minutes' and value between 1 and 1440)
                    or (penalty_type = 'double_session' and value between 2 and 10)
                  ),
  display_name  text not null
                  constraint cpd_display_name_len
                  check (char_length(btrim(display_name)) between 1 and 60),
  active        boolean not null default true,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint cpd_one_per_streak unique (challenge_id, unlock_streak)
);

comment on table public.challenge_penalty_definitions is
  'Configurable Straffbanken milestones for one challenge. Reaching '
  'unlock_streak consecutive completed days within a streak run earns this '
  'penalty. minimum_minutes.value = minutes; double_session.value = session '
  'count. Locked once the challenge leaves draft / starts.';

create trigger cpd_set_updated_at
  before update on public.challenge_penalty_definitions
  for each row execute function public.set_updated_at();

create index cpd_challenge_idx
  on public.challenge_penalty_definitions (challenge_id, sort_order);

-- Lock guard: freely editable only while the challenge is a not-yet-started draft.
create or replace function public.challenge_penalty_definitions_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  is_backend boolean := (select auth.uid()) is null;
  c_row      public.challenges;
  cid        uuid;
begin
  if tg_op = 'DELETE' then
    cid := old.challenge_id;
  else
    cid := new.challenge_id;
  end if;

  select * into c_row from public.challenges where id = cid;
  if c_row.id is null then
    raise exception 'Challenge % does not exist', cid;
  end if;

  if not is_backend then
    if not public.is_admin() then
      raise exception 'Endast administratörer får ändra straffdefinitioner';
    end if;
    if c_row.status <> 'draft'
       or (now() at time zone c_row.timezone)::date >= c_row.start_date then
      raise exception
        'Straffdefinitioner är låsta när utmaningen är aktiv eller har startat. '
        'Skapa en ny utmaning från denna för att ändra reglerna.';
    end if;
  end if;

  return coalesce(new, old);
end;
$$;

create trigger cpd_guard
  before insert or update or delete on public.challenge_penalty_definitions
  for each row execute function public.challenge_penalty_definitions_guard();

create trigger cpd_audit
  after insert or update or delete on public.challenge_penalty_definitions
  for each row execute function public.audit_row_change('challenge_penalty_definition', 'true');

-- ----------------------------------------------------------------------------
-- earned_penalties  (the Straffbank inventory)
-- ----------------------------------------------------------------------------
create table public.earned_penalties (
  id                    uuid primary key default gen_random_uuid(),
  challenge_id          uuid not null references public.challenges (id) on delete cascade,
  user_id               uuid not null references public.profiles (id) on delete cascade,
  penalty_definition_id uuid not null
                          references public.challenge_penalty_definitions (id) on delete cascade,
  -- Streak-run identity: the first completed day of the run that earned this.
  streak_run_start      date not null,
  -- Immutable snapshot of the definition at earn time.
  penalty_type          text not null
                          constraint ep_penalty_type_valid
                          check (penalty_type in ('minimum_minutes', 'double_session')),
  value                 integer not null constraint ep_value_positive check (value > 0),
  display_name          text not null,
  earned_on_date        date not null,
  status                text not null default 'available'
                          constraint ep_status_valid
                          check (status in ('available', 'spent', 'expired', 'revoked')),
  -- Soft pointer to penalty_assignments.id (no FK: avoids a table cycle and the
  -- assignment row is never deleted). Set when the penalty is spent.
  spent_assignment_id   uuid,
  created_at            timestamptz not null default now(),

  -- IDEMPOTENCY: reaching milestone M within the run starting on date D earns
  -- exactly one row. A retry / reload / proof replacement re-runs the reconciler
  -- which INSERTs ON CONFLICT DO NOTHING. A genuinely new streak run has a
  -- different streak_run_start and may earn the same milestone again.
  constraint ep_run_identity
    unique (challenge_id, user_id, penalty_definition_id, streak_run_start)
);

comment on table public.earned_penalties is
  'A participant''s earned, not-yet-spent penalty ammunition. Granted only by '
  'reconcile_earned_penalties() (server-authoritative). Unused rows expire when '
  'the challenge is completed; a streak correction that removes the basis marks '
  'an unused row revoked.';

create index ep_owner_idx on public.earned_penalties (user_id, challenge_id, status);
create index ep_challenge_idx on public.earned_penalties (challenge_id, status);

-- ----------------------------------------------------------------------------
-- penalty_assignments
-- ----------------------------------------------------------------------------
create table public.penalty_assignments (
  id                uuid primary key default gen_random_uuid(),
  challenge_id      uuid not null references public.challenges (id) on delete cascade,
  earned_penalty_id uuid not null references public.earned_penalties (id) on delete cascade,
  from_user_id      uuid not null references public.profiles (id) on delete cascade,
  to_user_id        uuid not null references public.profiles (id) on delete cascade,
  target_date       date not null,
  penalty_type      text not null
                      constraint pa_penalty_type_valid
                      check (penalty_type in ('minimum_minutes', 'double_session')),
  value             integer not null constraint pa_value_positive check (value > 0),
  display_name      text not null,
  status            text not null default 'active'
                      constraint pa_status_valid check (status in ('active', 'cancelled')),
  cancelled_by      uuid references public.profiles (id) on delete set null,
  cancelled_reason  text
                      constraint pa_cancelled_reason_len
                      check (cancelled_reason is null or char_length(cancelled_reason) <= 1000),
  cancelled_at      timestamptz,
  created_at        timestamptz not null default now(),

  constraint pa_no_self_target check (from_user_id <> to_user_id),
  constraint pa_cancel_coherent check ((status = 'cancelled') = (cancelled_at is not null)),
  -- one assignment ever per earned penalty (no re-use, even after cancel)
  constraint pa_one_per_earned unique (earned_penalty_id)
);

comment on table public.penalty_assignments is
  'A penalty applied by from_user_id against to_user_id on target_date. Created '
  'only by assign_penalty() (atomic). Never stacks: at most one active row per '
  '(challenge, to_user_id, target_date). Cancellable by an admin with a reason.';

-- NO STACKING: at most one active penalty per target per day.
create unique index pa_one_active_per_target_day
  on public.penalty_assignments (challenge_id, to_user_id, target_date)
  where status = 'active';

create index pa_target_idx on public.penalty_assignments (to_user_id, challenge_id);
create index pa_sender_idx on public.penalty_assignments (from_user_id, challenge_id);
create index pa_challenge_date_idx on public.penalty_assignments (challenge_id, target_date);

-- ============================================================================
-- RLS
-- ============================================================================
alter table public.challenge_penalty_definitions enable row level security;
alter table public.earned_penalties              enable row level security;
alter table public.penalty_assignments           enable row level security;

revoke all on public.challenge_penalty_definitions,
              public.earned_penalties,
              public.penalty_assignments
  from anon;

grant select, insert, update, delete
  on public.challenge_penalty_definitions to authenticated;
grant select on public.earned_penalties    to authenticated;
grant select on public.penalty_assignments to authenticated;

-- challenge_penalty_definitions -------------------------------------------------
create policy cpd_select on public.challenge_penalty_definitions
  for select to authenticated
  using (public.is_challenge_member(challenge_id) or public.is_admin());

create policy cpd_insert on public.challenge_penalty_definitions
  for insert to authenticated
  with check (public.is_admin());

create policy cpd_update on public.challenge_penalty_definitions
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy cpd_delete on public.challenge_penalty_definitions
  for delete to authenticated
  using (public.is_admin());

-- earned_penalties: your Straffbank is yours; admins see all. Writes: RPC only.
create policy ep_select on public.earned_penalties
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

-- penalty_assignments: shared-challenge visibility (the target must see who hit
-- them; the group dashboard shows an indicator). Writes: RPC only.
create policy pa_select on public.penalty_assignments
  for select to authenticated
  using (public.is_challenge_member(challenge_id) or public.is_admin());

-- ----------------------------------------------------------------------------
-- seed_default_penalty_definitions — the Hälsoutmaningen defaults, as data.
-- 20d -> 45-minutaren, 40d -> 60-minutaren, 60d -> Dubbelpass.
-- Only touches a draft challenge that has none yet.
-- ----------------------------------------------------------------------------
create or replace function public.seed_default_penalty_definitions(p_challenge_id uuid)
returns setof public.challenge_penalty_definitions
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_row public.challenges;
begin
  if not ((select auth.uid()) is null or public.is_admin()) then
    raise exception 'Endast administratörer får konfigurera straff';
  end if;

  select * into c_row from public.challenges where id = p_challenge_id;
  if c_row.id is null then
    raise exception 'Utmaningen finns inte';
  end if;
  if c_row.status <> 'draft' then
    raise exception 'Straff kan bara konfigureras för en utmaning i utkast';
  end if;
  if exists (select 1 from public.challenge_penalty_definitions
             where challenge_id = p_challenge_id) then
    raise exception 'Utmaningen har redan straffdefinitioner';
  end if;

  return query
  insert into public.challenge_penalty_definitions
    (challenge_id, unlock_streak, penalty_type, value, display_name, sort_order)
  values
    (p_challenge_id, 20, 'minimum_minutes', 45, '45-minutaren', 1),
    (p_challenge_id, 40, 'minimum_minutes', 60, '60-minutaren', 2),
    (p_challenge_id, 60, 'double_session',   2, 'Dubbelpass',   3)
  returning *;
end;
$$;

revoke all on function public.seed_default_penalty_definitions(uuid) from public, anon;
grant execute on function public.seed_default_penalty_definitions(uuid) to authenticated;
