-- ============================================================================
-- Hälsoutmaningen — 0002 helper functions, guard triggers, RLS, audit
--
-- Depends on 0001. Creates:
--   * SECURITY DEFINER predicate helpers (avoid RLS recursion)
--   * new-user -> profile trigger
--   * cross-table / rule-lock / ownership guard triggers
--   * the canonical challenge_day_states() function (mirrors src/domain/dayState.ts)
--   * append-only audit_log wiring
--   * RLS enable + policies for every table
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Predicate helpers. SECURITY DEFINER so they can read profiles/memberships
-- without tripping the RLS policies that call them. STABLE, empty search_path.
-- ----------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid())
      and role = 'admin'
      and active
  );
$$;

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.profiles where id = (select auth.uid());
$$;

create or replace function public.is_challenge_member(p_challenge_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.challenge_memberships
    where challenge_id = p_challenge_id
      and user_id = (select auth.uid())
  );
$$;

comment on function public.is_challenge_member is
  'True if the current user has ANY membership row for the challenge (active or '
  'not). Existence of the row = may see that challenge''s data. Fully removing '
  'someone is not a V1 operation — admins end participation instead.';

create or replace function public.shares_challenge_with(p_other_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.challenge_memberships me
    join public.challenge_memberships them
      on them.challenge_id = me.challenge_id
    where me.user_id = (select auth.uid())
      and them.user_id = p_other_user
  );
$$;

create or replace function public.is_valid_timezone(p_tz text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from pg_catalog.pg_timezone_names where name = p_tz);
$$;

create or replace function public.challenge_current_date(p_challenge_id uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (now() at time zone c.timezone)::date
  from public.challenges c
  where c.id = p_challenge_id;
$$;

comment on function public.challenge_current_date is
  'Authoritative "today" for a challenge, in its configured timezone. Server '
  'side only — the browser value is display-only (docs/ARCHITECTURE.md §12).';

-- Supabase's default privileges grant EXECUTE on new functions to anon too;
-- this is a fully-authenticated app, so pull that back.
revoke all on function public.is_admin() from public, anon;
revoke all on function public.current_user_role() from public, anon;
revoke all on function public.is_challenge_member(uuid) from public, anon;
revoke all on function public.shares_challenge_with(uuid) from public, anon;
revoke all on function public.is_valid_timezone(text) from public, anon;
revoke all on function public.challenge_current_date(uuid) from public, anon;

grant execute on function public.is_admin() to authenticated;
grant execute on function public.current_user_role() to authenticated;
grant execute on function public.is_challenge_member(uuid) to authenticated;
grant execute on function public.shares_challenge_with(uuid) to authenticated;
grant execute on function public.is_valid_timezone(text) to authenticated;
grant execute on function public.challenge_current_date(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- auth.users -> profiles
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''),
      nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
      split_part(coalesce(new.email, 'deltagare'), '@', 1)
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------------------
-- profiles: block non-admins from changing role / active
-- ----------------------------------------------------------------------------
create or replace function public.profiles_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- A NULL auth.uid() means a privileged backend (service_role / SQL editor):
  -- that path is trusted and is how the first admin is bootstrapped.
  if (new.role is distinct from old.role
      or new.active is distinct from old.active)
     and (select auth.uid()) is not null
     and not public.is_admin() then
    raise exception 'Only an administrator may change role or active status';
  end if;
  return new;
end;
$$;

create trigger profiles_guard_privileged_columns
  before update on public.profiles
  for each row execute function public.profiles_guard();

-- ----------------------------------------------------------------------------
-- challenges: valid timezone + rule-field lock after draft / after start
-- ----------------------------------------------------------------------------
create or replace function public.challenges_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked boolean;
begin
  if not public.is_valid_timezone(new.timezone) then
    raise exception 'Invalid IANA timezone: %', new.timezone;
  end if;

  if tg_op = 'UPDATE' then
    locked := (
      (old.status <> 'draft')
      or ((now() at time zone old.timezone)::date >= old.start_date)
    )
    -- Privileged backends (no JWT) can always break glass; document any such fix.
    and (select auth.uid()) is not null;

    if locked then
      if new.start_date       is distinct from old.start_date
      or new.timezone         is distinct from old.timezone
      or new.required_minutes is distinct from old.required_minutes
      or new.proof_required   is distinct from old.proof_required
      or new.missed_day_cost  is distinct from old.missed_day_cost then
        raise exception
          'Challenge rule fields are locked once the challenge is active or has started';
      end if;

      if new.end_date is distinct from old.end_date then
        if old.status in ('completed', 'archived') then
          raise exception 'Cannot change end_date of a % challenge', old.status;
        end if;
        if new.end_date < old.end_date then
          raise exception 'A running challenge''s end_date may only be extended';
        end if;
      end if;
    end if;
  end if;

  return new;
end;
$$;

create trigger challenges_guard_rules
  before insert or update on public.challenges
  for each row execute function public.challenges_guard();

-- ----------------------------------------------------------------------------
-- challenge_memberships: participation window must intersect the challenge
-- ----------------------------------------------------------------------------
create or replace function public.challenge_memberships_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_start date;
  c_end   date;
begin
  select start_date, end_date into c_start, c_end
  from public.challenges where id = new.challenge_id;

  if c_start is null then
    raise exception 'Challenge % does not exist', new.challenge_id;
  end if;

  if new.participation_start_date > c_end
     or coalesce(new.participation_end_date, c_end) < c_start then
    raise exception
      'Participation window %..% does not intersect challenge range %..%',
      new.participation_start_date,
      coalesce(new.participation_end_date::text, 'open'),
      c_start, c_end;
  end if;

  return new;
end;
$$;

create trigger challenge_memberships_guard_window
  before insert or update on public.challenge_memberships
  for each row execute function public.challenge_memberships_guard();

-- ----------------------------------------------------------------------------
-- training_entries: ownership, eligibility, "current local day only" for
-- participants; immutable identity columns for everyone.
-- ----------------------------------------------------------------------------
create or replace function public.training_entries_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid            uuid    := (select auth.uid());
  -- No JWT => privileged backend (service_role / SQL editor / migration).
  is_admin_actor boolean := (uid is null) or public.is_admin();
  c_status       text;
  today          date;
  m_active       boolean;
  eff_start      date;
  eff_end        date;
begin
  if tg_op = 'DELETE' then
    if not is_admin_actor then
      if old.user_id <> uid then
        raise exception 'You may only delete your own training entry';
      end if;
      if old.challenge_date <> public.challenge_current_date(old.challenge_id) then
        raise exception 'A training entry can only be deleted on its own challenge day';
      end if;
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' then
    if new.challenge_id   is distinct from old.challenge_id
    or new.user_id        is distinct from old.user_id
    or new.challenge_date is distinct from old.challenge_date then
      raise exception 'challenge_id, user_id and challenge_date are immutable';
    end if;
    if not is_admin_actor then
      if old.user_id <> uid then
        raise exception 'You may only edit your own training entry';
      end if;
      if new.status is distinct from old.status
      or new.invalidated_reason is distinct from old.invalidated_reason
      or new.invalidated_by is distinct from old.invalidated_by
      or new.invalidated_at is distinct from old.invalidated_at then
        raise exception 'Only an administrator may invalidate an entry';
      end if;
      if old.challenge_date <> public.challenge_current_date(old.challenge_id) then
        raise exception 'A training entry can only be edited on its own challenge day';
      end if;
    end if;
    return new;
  end if;

  -- INSERT
  select status into c_status from public.challenges where id = new.challenge_id;
  today := public.challenge_current_date(new.challenge_id);

  select m.active,
         greatest(c.start_date, m.participation_start_date),
         least(c.end_date, coalesce(m.participation_end_date, c.end_date))
    into m_active, eff_start, eff_end
  from public.challenge_memberships m
  join public.challenges c on c.id = m.challenge_id
  where m.challenge_id = new.challenge_id and m.user_id = new.user_id;

  if eff_start is null then
    raise exception 'No challenge membership for this participant';
  end if;

  if new.challenge_date < eff_start or new.challenge_date > eff_end then
    raise exception 'Challenge date % is outside the participation window %..%',
      new.challenge_date, eff_start, eff_end;
  end if;

  if not is_admin_actor then
    if new.user_id <> uid then
      raise exception 'You may only log your own training';
    end if;
    if c_status <> 'active' then
      raise exception 'Challenge is not active';
    end if;
    if not coalesce(m_active, false) then
      raise exception 'Your challenge membership is not active';
    end if;
    if new.challenge_date <> today then
      raise exception 'Participants may only log training for the current challenge day (%)', today;
    end if;
    if new.status <> 'active' then
      raise exception 'Participants may not create invalidated entries';
    end if;
  end if;

  return new;
end;
$$;

create trigger training_entries_guard_rules
  before insert or update or delete on public.training_entries
  for each row execute function public.training_entries_guard();

-- ----------------------------------------------------------------------------
-- training_proofs: force challenge_id/user_id to match the parent entry;
-- participants may only attach/remove proof on their own current-day entry.
-- ----------------------------------------------------------------------------
create or replace function public.training_proofs_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid            uuid    := (select auth.uid());
  is_admin_actor boolean := (uid is null) or public.is_admin();
  e_user         uuid;
  e_challenge    uuid;
  e_date         date;
  e_status       text;
begin
  if tg_op = 'DELETE' then
    select user_id, challenge_id, challenge_date
      into e_user, e_challenge, e_date
    from public.training_entries where id = old.training_entry_id;

    if not is_admin_actor then
      if old.user_id <> uid then
        raise exception 'You may only delete your own proof';
      end if;
      if e_date is distinct from public.challenge_current_date(e_challenge) then
        raise exception 'Proof can only be removed on its own challenge day';
      end if;
    end if;
    return old;
  end if;

  select user_id, challenge_id, challenge_date, status
    into e_user, e_challenge, e_date, e_status
  from public.training_entries where id = new.training_entry_id;

  if e_user is null then
    raise exception 'Training entry % does not exist', new.training_entry_id;
  end if;

  -- Denormalised columns always follow the parent entry.
  new.challenge_id := e_challenge;
  new.user_id := e_user;

  if not is_admin_actor then
    if e_user <> uid then
      raise exception 'You may only attach proof to your own training entry';
    end if;
    if e_status <> 'active' then
      raise exception 'Cannot attach proof to an invalidated entry';
    end if;
    if e_date <> public.challenge_current_date(e_challenge) then
      raise exception 'Proof can only be attached on its own challenge day';
    end if;
  end if;

  return new;
end;
$$;

create trigger training_proofs_guard_rules
  before insert or update or delete on public.training_proofs
  for each row execute function public.training_proofs_guard();

-- ----------------------------------------------------------------------------
-- Canonical day-state — the SQL mirror of src/domain/dayState.ts.
-- SECURITY INVOKER: underlying RLS already limits rows to challenges the
-- caller belongs to, so a non-member simply gets an empty result.
-- ----------------------------------------------------------------------------
create or replace function public.challenge_day_states(p_challenge_id uuid)
returns table (
  user_id          uuid,
  challenge_date   date,
  state            text,
  entry_id         uuid,
  duration_minutes integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  with c as (
    select id, start_date, end_date, timezone, required_minutes, proof_required
    from public.challenges
    where id = p_challenge_id
  ),
  cur as (
    select (now() at time zone (select timezone from c))::date as today
  ),
  days as (
    select (c.start_date + g)::date as challenge_date
    from c, generate_series(0, c.end_date - c.start_date) as g
  ),
  mem as (
    select
      m.user_id,
      greatest(c.start_date, m.participation_start_date) as eff_start,
      least(c.end_date, coalesce(m.participation_end_date, c.end_date)) as eff_end
    from public.challenge_memberships m
    cross join c
    where m.challenge_id = p_challenge_id
  )
  select
    mem.user_id,
    days.challenge_date,
    case
      when days.challenge_date < mem.eff_start
        or days.challenge_date > mem.eff_end then 'not_participating'
      when e.id is not null
        and e.status = 'active'
        and e.duration_minutes >= c.required_minutes
        and (
          not c.proof_required
          or exists (
            select 1 from public.training_proofs p
            where p.training_entry_id = e.id
          )
        ) then 'completed'
      when days.challenge_date > cur.today then 'future'
      when days.challenge_date = cur.today then 'pending'
      else 'missed'
    end as state,
    e.id as entry_id,
    e.duration_minutes
  from mem
  cross join days
  cross join c
  cross join cur
  left join public.training_entries e
    on e.challenge_id = p_challenge_id
   and e.user_id = mem.user_id
   and e.challenge_date = days.challenge_date;
$$;

comment on function public.challenge_day_states is
  'One row per (participant, challenge day) with the canonical state: '
  'not_participating | completed | future | pending | missed. Mirrors '
  'src/domain/dayState.ts. Fas 5 builds stats/liability views on top of this.';

revoke all on function public.challenge_day_states(uuid) from public, anon;
grant execute on function public.challenge_day_states(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- audit_log: append-only + admin-action recorder
-- ----------------------------------------------------------------------------
create or replace function public.audit_log_prevent_change()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_log is append-only';
end;
$$;

create trigger audit_log_no_update
  before update or delete on public.audit_log
  for each row execute function public.audit_log_prevent_change();

create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entity  text := tg_argv[0];
  v_always  boolean := tg_argv[1]::boolean;  -- true: always log; false: only admin actors
  v_action  text := lower(tg_op);
  v_before  jsonb;
  v_after   jsonb;
  v_row     jsonb;
begin
  -- "false" triggers only log admin / privileged-backend (no-JWT) actions;
  -- a participant's own routine logging is not audit noise.
  if not v_always
     and not public.is_admin()
     and (select auth.uid()) is not null then
    return coalesce(new, old);
  end if;

  if tg_op <> 'INSERT' then v_before := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then v_after := to_jsonb(new); end if;
  v_row := coalesce(v_after, v_before);

  if v_entity = 'training_entry' and tg_op = 'UPDATE' then
    if new.status = 'invalidated' and old.status <> 'invalidated' then
      v_action := 'invalidate';
    elsif new.status = 'active' and old.status = 'invalidated' then
      v_action := 'revalidate';
    end if;
  end if;

  insert into public.audit_log (
    actor_user_id, challenge_id, target_user_id,
    entity_type, entity_id, action, before_data, after_data
  )
  values (
    (select auth.uid()),
    coalesce(
      nullif(v_row ->> 'challenge_id', '')::uuid,
      case when v_entity = 'challenge' then nullif(v_row ->> 'id', '')::uuid end
    ),
    nullif(v_row ->> 'user_id', '')::uuid,
    v_entity,
    nullif(v_row ->> 'id', '')::uuid,
    v_action,
    v_before,
    v_after
  );

  return coalesce(new, old);
end;
$$;

create trigger challenges_audit
  after insert or update or delete on public.challenges
  for each row execute function public.audit_row_change('challenge', 'true');

create trigger challenge_memberships_audit
  after insert or update or delete on public.challenge_memberships
  for each row execute function public.audit_row_change('challenge_membership', 'true');

create trigger training_entries_audit
  after insert or update or delete on public.training_entries
  for each row execute function public.audit_row_change('training_entry', 'false');

create trigger training_proofs_audit
  after insert or update or delete on public.training_proofs
  for each row execute function public.audit_row_change('training_proof', 'false');

-- ============================================================================
-- Row Level Security
-- ============================================================================
alter table public.profiles              enable row level security;
alter table public.challenges            enable row level security;
alter table public.challenge_memberships enable row level security;
alter table public.training_entries      enable row level security;
alter table public.training_proofs       enable row level security;
alter table public.audit_log             enable row level security;

-- Private app: no anonymous access to any table.
revoke all on public.profiles,
              public.challenges,
              public.challenge_memberships,
              public.training_entries,
              public.training_proofs,
              public.audit_log
  from anon;

grant select, insert, update, delete on public.profiles              to authenticated;
grant select, insert, update, delete on public.challenges            to authenticated;
grant select, insert, update, delete on public.challenge_memberships to authenticated;
grant select, insert, update, delete on public.training_entries      to authenticated;
grant select, insert, update, delete on public.training_proofs       to authenticated;
grant select                          on public.audit_log            to authenticated;

-- profiles -------------------------------------------------------------------
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or public.is_admin()
    or public.shares_challenge_with(id)
  );

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy profiles_update_admin on public.profiles
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- No INSERT policy: rows come only from handle_new_user().
-- No DELETE policy: removal cascades from auth.users.

-- challenges ----------------------------------------------------------------
create policy challenges_select on public.challenges
  for select to authenticated
  using (public.is_challenge_member(id) or public.is_admin());

create policy challenges_insert on public.challenges
  for insert to authenticated
  with check (public.is_admin() and created_by = (select auth.uid()));

create policy challenges_update on public.challenges
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy challenges_delete on public.challenges
  for delete to authenticated
  using (public.is_admin() and status = 'draft');

-- challenge_memberships ---------------------------------------------------
create policy challenge_memberships_select on public.challenge_memberships
  for select to authenticated
  using (public.is_challenge_member(challenge_id) or public.is_admin());

create policy challenge_memberships_insert on public.challenge_memberships
  for insert to authenticated
  with check (public.is_admin());

create policy challenge_memberships_update on public.challenge_memberships
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy challenge_memberships_delete on public.challenge_memberships
  for delete to authenticated
  using (public.is_admin());

-- training_entries --------------------------------------------------------
create policy training_entries_select on public.training_entries
  for select to authenticated
  using (public.is_challenge_member(challenge_id) or public.is_admin());

create policy training_entries_insert on public.training_entries
  for insert to authenticated
  with check (
    (user_id = (select auth.uid()) and public.is_challenge_member(challenge_id))
    or public.is_admin()
  );

create policy training_entries_update on public.training_entries
  for update to authenticated
  using (user_id = (select auth.uid()) or public.is_admin())
  with check (user_id = (select auth.uid()) or public.is_admin());

create policy training_entries_delete on public.training_entries
  for delete to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

-- training_proofs -------------------------------------------------------
create policy training_proofs_select on public.training_proofs
  for select to authenticated
  using (public.is_challenge_member(challenge_id) or public.is_admin());

create policy training_proofs_insert on public.training_proofs
  for insert to authenticated
  with check (
    (user_id = (select auth.uid()) and public.is_challenge_member(challenge_id))
    or public.is_admin()
  );

-- No UPDATE policy: replace = delete + insert (same day).

create policy training_proofs_delete on public.training_proofs
  for delete to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

-- audit_log -------------------------------------------------------------
create policy audit_log_select on public.audit_log
  for select to authenticated
  using (public.is_admin());
-- No write policies: only audit_row_change() (SECURITY DEFINER) inserts.
