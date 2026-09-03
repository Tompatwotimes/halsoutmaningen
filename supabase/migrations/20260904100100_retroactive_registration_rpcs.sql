-- ============================================================================
-- Hälsoutmaningen — Phase 11 / 0015  retroactive registration — RPCs
--
-- Depends on 0014. Forward-only.
--
--   _retroactive_request_eligibility_check(challenge, user, date)  shared gate
--   _retroactive_block_message(jsonb)                              Swedish text
--
--   submit_retroactive_registration(challenge, date, reason, sessions jsonb)
--       participant action. Validates the day is a real PAST eligible
--       participation day, verifies every proof object exists and belongs to
--       the caller, creates the request + session rows, audits. Changes no
--       challenge state.
--   cancel_retroactive_registration(request)         withdraw own pending request
--   preview_retroactive_approval(request)            advisory admin impact preview
--   approve_retroactive_registration(request, note?) admin, transactional:
--       re-validates CURRENT state, materialises real training_entries +
--       training_proofs with the ORIGINAL historical challenge_date, appends
--       session_seq safely, audits. The existing reconcile triggers + derived
--       views then recompute day-state / streak / debt / KASSAN / Straffbanken.
--   reject_retroactive_registration(request, reason) admin, mandatory reason
--
-- All SECURITY DEFINER, search_path='', schema-qualified, EXECUTE revoked from
-- public/anon and granted to authenticated only where a client calls directly.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Shared eligibility gate — preview and both write paths call this so they can
-- never disagree (mirrors _challenge_start_date_correction_check).
-- ----------------------------------------------------------------------------
create or replace function public._retroactive_request_eligibility_check(
  p_challenge_id   uuid,
  p_user_id        uuid,
  p_challenge_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ch      public.challenges;
  v_today   date;
  m_active  boolean;
  eff_start date;
  eff_end   date;
  v_ds      record;
  v_pending int;
begin
  select * into v_ch from public.challenges where id = p_challenge_id;
  if v_ch.id is null then
    return jsonb_build_object('ok', false, 'blocking_code', 'not_found');
  end if;
  if v_ch.status <> 'active' then
    return jsonb_build_object('ok', false, 'blocking_code', 'challenge_not_active');
  end if;

  v_today := (now() at time zone v_ch.timezone)::date;

  if p_challenge_date >= v_today then
    return jsonb_build_object('ok', false, 'blocking_code', 'not_past',
      'challenge_today', v_today);
  end if;
  if p_challenge_date < v_ch.start_date then
    return jsonb_build_object('ok', false, 'blocking_code', 'before_start',
      'challenge_start_date', v_ch.start_date);
  end if;
  if p_challenge_date > v_ch.end_date then
    return jsonb_build_object('ok', false, 'blocking_code', 'after_end',
      'challenge_end_date', v_ch.end_date);
  end if;

  select m.active,
         greatest(v_ch.start_date, m.participation_start_date),
         least(v_ch.end_date, coalesce(m.participation_end_date, v_ch.end_date))
    into m_active, eff_start, eff_end
  from public.challenge_memberships m
  where m.challenge_id = p_challenge_id and m.user_id = p_user_id;

  if not found then
    return jsonb_build_object('ok', false, 'blocking_code', 'no_membership');
  end if;
  if p_challenge_date < eff_start or p_challenge_date > eff_end then
    return jsonb_build_object('ok', false, 'blocking_code', 'outside_membership',
      'participation_start', eff_start, 'participation_end', eff_end);
  end if;

  select * into v_ds
  from public.challenge_day_states(p_challenge_id, p_user_id) ds
  where ds.challenge_date = p_challenge_date;

  if v_ds.state = 'completed' then
    return jsonb_build_object('ok', false, 'blocking_code', 'already_completed');
  end if;

  select count(*) into v_pending
  from public.retroactive_training_requests
  where challenge_id = p_challenge_id and user_id = p_user_id
    and challenge_date = p_challenge_date and status = 'pending';
  if v_pending > 0 then
    return jsonb_build_object('ok', false, 'blocking_code', 'pending_exists');
  end if;

  return jsonb_build_object(
    'ok', true,
    'challenge_date', p_challenge_date,
    'day_state', v_ds.state,
    'proof_required', v_ch.proof_required,
    'required_minutes', v_ds.required_minutes,
    'required_sessions', v_ds.required_sessions,
    'min_minutes_per_session', v_ds.min_minutes_per_session,
    'penalty_type', v_ds.penalty_type,
    'penalty_display_name', v_ds.penalty_display_name,
    'missed_day_cost', v_ch.missed_day_cost,
    'existing_valid_sessions', v_ds.valid_session_count,
    'existing_valid_minutes', v_ds.total_valid_minutes
  );
end;
$$;

revoke all on function public._retroactive_request_eligibility_check(uuid, uuid, date)
  from public, anon;

create or replace function public._retroactive_block_message(p_chk jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_chk ->> 'blocking_code'
    when 'not_found'            then 'Utmaningen finns inte'
    when 'challenge_not_active' then 'Utmaningen är inte aktiv'
    when 'not_past'             then 'Efterregistrering gäller bara tidigare dagar — dagens pass loggar du som vanligt'
    when 'before_start'         then 'Datumet ligger före utmaningens start'
    when 'after_end'            then 'Datumet ligger efter utmaningens slut'
    when 'outside_membership'   then 'Datumet ligger utanför din deltagandeperiod'
    when 'no_membership'        then 'Du är inte med i den här utmaningen'
    when 'already_completed'    then 'Dagen är redan registrerad som genomförd'
    when 'pending_exists'       then 'Du har redan en efterregistrering som väntar på granskning för den dagen'
    else 'Efterregistreringen kan inte göras för den dagen'
  end;
$$;

revoke all on function public._retroactive_block_message(jsonb) from public, anon;

-- ----------------------------------------------------------------------------
-- submit_retroactive_registration — participant creates the request
-- ----------------------------------------------------------------------------
create or replace function public.submit_retroactive_registration(
  p_challenge_id   uuid,
  p_challenge_date date,
  p_reason         text,
  p_sessions       jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid          uuid := (select auth.uid());
  v_ch         public.challenges;
  chk          jsonb;
  v_request_id uuid;
  v_session    jsonb;
  v_count      int := 0;
  v_path       text;
  v_prefix     text;
  v_seen_paths text[] := '{}';
begin
  if uid is null then
    raise exception 'Du måste vara inloggad för att efterregistrera';
  end if;

  select * into v_ch from public.challenges where id = p_challenge_id;
  if v_ch.id is null then
    raise exception 'Utmaningen finns inte';
  end if;

  chk := public._retroactive_request_eligibility_check(p_challenge_id, uid, p_challenge_date);
  if not (chk ->> 'ok')::boolean then
    raise exception '%', public._retroactive_block_message(chk);
  end if;

  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Ange varför passet registreras i efterhand';
  end if;

  if p_sessions is null
     or jsonb_typeof(p_sessions) <> 'array'
     or jsonb_array_length(p_sessions) = 0 then
    raise exception 'Lägg till minst ett pass';
  end if;
  if jsonb_array_length(p_sessions) > 20 then
    raise exception 'För många pass i en och samma efterregistrering';
  end if;

  insert into public.retroactive_training_requests
    (challenge_id, user_id, challenge_date, participant_reason, status)
  values (p_challenge_id, uid, p_challenge_date, btrim(p_reason), 'pending')
  returning id into v_request_id;

  v_prefix := p_challenge_id::text || '/' || uid::text || '/'
            || p_challenge_date::text || '/';

  for v_session in select value from jsonb_array_elements(p_sessions)
  loop
    v_count := v_count + 1;

    if jsonb_typeof(v_session) <> 'object'
       or (v_session ->> 'duration_minutes') is null then
      raise exception 'Ett av passen saknar längd';
    end if;

    v_path := nullif(btrim(coalesce(v_session ->> 'proof_storage_path', '')), '');

    if v_ch.proof_required and v_path is null then
      raise exception 'Varje pass behöver ett bildbevis';
    end if;

    if v_path is not null then
      if left(v_path, char_length(v_prefix)) <> v_prefix then
        raise exception 'Ogiltig sökväg för bildbeviset';
      end if;
      if v_path = any (v_seen_paths) then
        raise exception 'Samma bildbevis kan inte användas för två pass';
      end if;
      v_seen_paths := v_seen_paths || v_path;
      if not exists (
        select 1 from storage.objects o
        where o.bucket_id = 'proofs' and o.name = v_path
      ) then
        raise exception 'Bildbeviset kunde inte hittas — ladda upp det igen';
      end if;
      if (v_session ->> 'proof_mime_type') is null
         or (v_session ->> 'proof_size_bytes') is null then
        raise exception 'Bildbevisets metadata saknas';
      end if;
    end if;

    insert into public.retroactive_training_request_sessions
      (request_id, duration_minutes, activity, note, sort_order,
       proof_storage_path, proof_mime_type, proof_size_bytes,
       proof_width, proof_height)
    values (
      v_request_id,
      (v_session ->> 'duration_minutes')::int,
      nullif(btrim(coalesce(v_session ->> 'activity', '')), ''),
      nullif(btrim(coalesce(v_session ->> 'note', '')), ''),
      coalesce(nullif(v_session ->> 'sort_order', '')::smallint, v_count::smallint),
      v_path,
      case when v_path is null then null else v_session ->> 'proof_mime_type' end,
      case when v_path is null then null else (v_session ->> 'proof_size_bytes')::bigint end,
      nullif(v_session ->> 'proof_width', '')::int,
      nullif(v_session ->> 'proof_height', '')::int
    );
  end loop;

  insert into public.audit_log
    (actor_user_id, challenge_id, target_user_id, entity_type, entity_id,
     action, after_data, note)
  values (
    uid, p_challenge_id, uid, 'retroactive_training_request', v_request_id,
    'retroactive_registration_submitted',
    jsonb_build_object('challenge_date', p_challenge_date, 'session_count', v_count),
    btrim(p_reason)
  );

  return jsonb_build_object('request_id', v_request_id, 'session_count', v_count);
end;
$$;

revoke all on function public.submit_retroactive_registration(uuid, date, text, jsonb)
  from public, anon;
grant execute on function public.submit_retroactive_registration(uuid, date, text, jsonb)
  to authenticated;

-- ----------------------------------------------------------------------------
-- cancel_retroactive_registration — participant withdraws own pending request
-- ----------------------------------------------------------------------------
create or replace function public.cancel_retroactive_registration(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid   uuid := (select auth.uid());
  v_row public.retroactive_training_requests;
begin
  update public.retroactive_training_requests
    set status = 'cancelled'
  where id = p_request_id and user_id = uid and status = 'pending'
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Det finns ingen väntande efterregistrering att ångra';
  end if;

  insert into public.audit_log
    (actor_user_id, challenge_id, target_user_id, entity_type, entity_id, action, after_data)
  values (uid, v_row.challenge_id, uid, 'retroactive_training_request', v_row.id,
    'retroactive_registration_cancelled',
    jsonb_build_object('challenge_date', v_row.challenge_date));

  return jsonb_build_object('request_id', v_row.id, 'status', 'cancelled');
end;
$$;

revoke all on function public.cancel_retroactive_registration(uuid) from public, anon;
grant execute on function public.cancel_retroactive_registration(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- preview_retroactive_approval — advisory "what would approving do" for the
-- admin review card (and the requester's own status view). Never mutates.
-- ----------------------------------------------------------------------------
create or replace function public.preview_retroactive_approval(p_request_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid   uuid := (select auth.uid());
  v_req public.retroactive_training_requests;
  v_ch  public.challenges;
  v_ds  record;
  v_prop_sessions int;
  v_prop_minutes  int;
  v_total_sessions int;
  v_total_minutes  int;
  v_would_complete boolean;
  v_resulting_state text;
  v_debt_delta int;
begin
  select * into v_req from public.retroactive_training_requests where id = p_request_id;
  if v_req.id is null then
    raise exception 'Efterregistreringen finns inte';
  end if;
  if not (v_req.user_id = uid or public.is_admin()) then
    raise exception 'Du får inte se den här efterregistreringen';
  end if;

  select * into v_ch from public.challenges where id = v_req.challenge_id;

  select * into v_ds
  from public.challenge_day_states(v_req.challenge_id, v_req.user_id) ds
  where ds.challenge_date = v_req.challenge_date;

  select
    (count(*) filter (where s.ok))::int,
    (coalesce(sum(s.duration_minutes) filter (where s.ok), 0))::int
  into v_prop_sessions, v_prop_minutes
  from (
    select rs.duration_minutes,
      (rs.duration_minutes >= coalesce(v_ds.min_minutes_per_session, 0)
       and (not v_ch.proof_required or rs.proof_storage_path is not null)) as ok
    from public.retroactive_training_request_sessions rs
    where rs.request_id = p_request_id
  ) s;

  v_total_sessions := coalesce(v_ds.valid_session_count, 0) + v_prop_sessions;
  v_total_minutes  := coalesce(v_ds.total_valid_minutes, 0) + v_prop_minutes;
  v_would_complete := v_ds.state = 'completed'
    or (v_total_sessions >= coalesce(v_ds.required_sessions, 1)
        and v_total_minutes >= coalesce(v_ds.required_minutes, v_ch.required_minutes));

  v_resulting_state := case
    when v_ds.state = 'completed' then 'completed'
    when v_would_complete then 'completed'
    else v_ds.state
  end;

  v_debt_delta := case
    when v_ds.state = 'missed' and v_would_complete then -v_ch.missed_day_cost
    else 0
  end;

  return jsonb_build_object(
    'request_id', v_req.id,
    'status', v_req.status,
    'user_id', v_req.user_id,
    'challenge_date', v_req.challenge_date,
    'submitted_at', v_req.submitted_at,
    'participant_reason', v_req.participant_reason,
    'review_note', v_req.review_note,
    'reviewed_at', v_req.reviewed_at,
    'reviewed_by', v_req.reviewed_by,
    'proof_required', v_ch.proof_required,
    'current_state', v_ds.state,
    'required_minutes', v_ds.required_minutes,
    'required_sessions', v_ds.required_sessions,
    'min_minutes_per_session', v_ds.min_minutes_per_session,
    'penalty_type', v_ds.penalty_type,
    'penalty_display_name', v_ds.penalty_display_name,
    'existing_valid_sessions', coalesce(v_ds.valid_session_count, 0),
    'existing_valid_minutes', coalesce(v_ds.total_valid_minutes, 0),
    'proposed_valid_sessions', v_prop_sessions,
    'proposed_valid_minutes', v_prop_minutes,
    'would_complete', v_would_complete,
    'resulting_state', v_resulting_state,
    'debt_delta_sek', v_debt_delta,
    'missed_day_cost', v_ch.missed_day_cost
  );
end;
$$;

revoke all on function public.preview_retroactive_approval(uuid) from public, anon;
grant execute on function public.preview_retroactive_approval(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- approve_retroactive_registration — the security-sensitive transaction
-- ----------------------------------------------------------------------------
create or replace function public.approve_retroactive_registration(
  p_request_id uuid,
  p_admin_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid         uuid := (select auth.uid());
  v_req       public.retroactive_training_requests;
  v_ch        public.challenges;
  chk         jsonb;
  v_blk       text;
  v_s         record;
  v_seq       smallint;
  v_entry     public.training_entries;
  v_entry_ids uuid[] := '{}';
  v_tries     int;
begin
  if not ((uid is null) or public.is_admin()) then
    raise exception 'Endast administratörer får godkänna en efterregistrering';
  end if;

  select * into v_req from public.retroactive_training_requests
  where id = p_request_id
  for update;

  if v_req.id is null then
    raise exception 'Efterregistreringen finns inte';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'Efterregistreringen är redan hanterad';
  end if;
  if uid is not null and v_req.user_id = uid then
    raise exception 'Du kan inte godkänna din egen efterregistrering';
  end if;

  select * into v_ch from public.challenges where id = v_req.challenge_id for update;

  -- Re-validate against CURRENT state. 'already_completed' / 'pending_exists'
  -- are not disqualifying at approval time — approving simply adds valid
  -- history (the day may already be, or stay, completed).
  chk := public._retroactive_request_eligibility_check(
           v_req.challenge_id, v_req.user_id, v_req.challenge_date);
  if not (chk ->> 'ok')::boolean
     and (chk ->> 'blocking_code') not in ('already_completed', 'pending_exists') then
    v_blk := public._retroactive_block_message(chk);
    raise exception 'Efterregistreringen kan inte godkännas nu: %', v_blk;
  end if;

  if v_ch.proof_required and exists (
    select 1 from public.retroactive_training_request_sessions
    where request_id = p_request_id and proof_storage_path is null
  ) then
    raise exception 'Alla pass måste ha bildbevis';
  end if;

  for v_s in
    select * from public.retroactive_training_request_sessions
    where request_id = p_request_id
    order by sort_order
  loop
    v_tries := 0;
    loop
      select coalesce(max(session_seq), 0) + 1 into v_seq
      from public.training_entries
      where challenge_id = v_req.challenge_id
        and user_id = v_req.user_id
        and challenge_date = v_req.challenge_date;

      begin
        insert into public.training_entries
          (challenge_id, user_id, challenge_date, session_seq,
           duration_minutes, activity, note)
        values (v_req.challenge_id, v_req.user_id, v_req.challenge_date, v_seq,
           v_s.duration_minutes, v_s.activity, v_s.note)
        returning * into v_entry;
        exit;
      exception when unique_violation then
        v_tries := v_tries + 1;
        if v_tries > 20 then
          raise exception 'Kunde inte skapa passet, försök igen';
        end if;
      end;
    end loop;

    v_entry_ids := v_entry_ids || v_entry.id;

    if v_s.proof_storage_path is not null then
      insert into public.training_proofs
        (training_entry_id, challenge_id, user_id, storage_path,
         mime_type, size_bytes, width, height)
      values (v_entry.id, v_req.challenge_id, v_req.user_id, v_s.proof_storage_path,
         v_s.proof_mime_type, v_s.proof_size_bytes, v_s.proof_width, v_s.proof_height);
    end if;
  end loop;

  update public.retroactive_training_requests
    set status = 'approved',
        reviewed_at = now(),
        -- uid is only null for a no-JWT break-glass backend call; the coherence
        -- constraint still needs a non-null reviewer.
        reviewed_by = coalesce(uid, v_req.user_id),
        review_note = nullif(btrim(p_admin_note), '')
  where id = p_request_id;

  insert into public.audit_log
    (actor_user_id, challenge_id, target_user_id, entity_type, entity_id,
     action, after_data, note)
  values (uid, v_req.challenge_id, v_req.user_id, 'retroactive_training_request', v_req.id,
    'retroactive_registration_approved',
    jsonb_build_object('challenge_date', v_req.challenge_date,
                       'training_entry_ids', to_jsonb(v_entry_ids)),
    nullif(btrim(p_admin_note), ''));

  -- trg_reconcile_from_changed already fired on the training_entries INSERTs →
  -- streak / earned-penalty reconciliation ran (idempotently).
  -- challenge_day_states / challenge_results / liability / KASSAN are derived.

  return jsonb_build_object(
    'request_id', v_req.id,
    'status', 'approved',
    'training_entry_ids', to_jsonb(v_entry_ids)
  );
end;
$$;

revoke all on function public.approve_retroactive_registration(uuid, text) from public, anon;
grant execute on function public.approve_retroactive_registration(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- reject_retroactive_registration — admin, mandatory reason, no training created
-- ----------------------------------------------------------------------------
create or replace function public.reject_retroactive_registration(
  p_request_id uuid,
  p_reason     text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid   uuid := (select auth.uid());
  v_req public.retroactive_training_requests;
begin
  if not ((uid is null) or public.is_admin()) then
    raise exception 'Endast administratörer får avslå en efterregistrering';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Ange en anledning till avslaget';
  end if;

  select * into v_req from public.retroactive_training_requests
  where id = p_request_id
  for update;

  if v_req.id is null then
    raise exception 'Efterregistreringen finns inte';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'Efterregistreringen är redan hanterad';
  end if;
  if uid is not null and v_req.user_id = uid then
    raise exception 'Du kan inte avslå din egen efterregistrering';
  end if;

  update public.retroactive_training_requests
    set status = 'rejected',
        reviewed_at = now(),
        reviewed_by = coalesce(uid, v_req.user_id),
        review_note = btrim(p_reason)
  where id = p_request_id;

  insert into public.audit_log
    (actor_user_id, challenge_id, target_user_id, entity_type, entity_id,
     action, after_data, note)
  values (uid, v_req.challenge_id, v_req.user_id, 'retroactive_training_request', v_req.id,
    'retroactive_registration_rejected',
    jsonb_build_object('challenge_date', v_req.challenge_date),
    btrim(p_reason));

  return jsonb_build_object('request_id', v_req.id, 'status', 'rejected');
end;
$$;

revoke all on function public.reject_retroactive_registration(uuid, text) from public, anon;
grant execute on function public.reject_retroactive_registration(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- Read model: the admin queue with a pending count, and one participant's own
-- history. Both are plain SELECTs the client could do directly; wrapped as
-- SECURITY INVOKER functions so RLS still applies and the shape is stable.
-- ----------------------------------------------------------------------------
create or replace function public.retroactive_requests_for_challenge(
  p_challenge_id uuid
)
returns table (
  id                 uuid,
  user_id            uuid,
  challenge_date     date,
  participant_reason text,
  status             text,
  submitted_at       timestamptz,
  reviewed_at        timestamptz,
  reviewed_by        uuid,
  review_note        text,
  session_count      integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select r.id, r.user_id, r.challenge_date, r.participant_reason, r.status,
         r.submitted_at, r.reviewed_at, r.reviewed_by, r.review_note,
         (select count(*)::int from public.retroactive_training_request_sessions s
          where s.request_id = r.id)
  from public.retroactive_training_requests r
  where r.challenge_id = p_challenge_id
  order by (r.status = 'pending') desc, r.submitted_at asc;
$$;

revoke all on function public.retroactive_requests_for_challenge(uuid) from public, anon;
grant execute on function public.retroactive_requests_for_challenge(uuid) to authenticated;
