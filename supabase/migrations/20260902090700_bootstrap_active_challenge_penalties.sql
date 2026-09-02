-- ============================================================================
-- Hälsoutmaningen — Phase 9 / 0012  bootstrap the CURRENT challenge's Straffbank
--
-- ONE-TIME. Introduces the default Straffbanken definitions into the existing
-- first challenge **even if it is already `active`**, then reconciles every
-- member's historical streak runs so anyone who already reached a milestone
-- earlier in the running challenge receives that earned penalty now.
--
-- Why this is safe and does NOT weaken "active challenge rules are immutable":
--   * It runs as a no-JWT migration session, the same documented break-glass
--     the guards already recognise (`(select auth.uid()) is null`).
--   * A day's training requirement comes from `penalty_ASSIGNMENTS`, never from
--     definitions. Adding definitions changes **no** historical or current day
--     requirement. It only enables *earning* (applied retroactively below) and
--     *future* assignments — `assign_penalty()` still refuses any target date
--     that is not strictly after the challenge-local today.
--   * It is idempotent: it does nothing if the challenge already has any
--     penalty definition.
--
-- If the production first challenge has a different id than the fixed one
-- below, edit `v_cid` before applying, or run the equivalent
-- `insert into challenge_penalty_definitions …` + a
-- `select public._reconcile_earned_penalties(<cid>, m.user_id) from
--  challenge_memberships m where challenge_id = <cid>` in the SQL editor (a
-- no-JWT session bypasses the definitions lock the same way).
-- ============================================================================

do $$
declare
  v_cid    uuid := '11111111-1111-4111-8111-111111111111';
  v_status text;
  v_count  int;
  m        record;
begin
  select status into v_status from public.challenges where id = v_cid;

  if v_status is null then
    raise notice 'bootstrap: challenge % not found — skipping', v_cid;
    return;
  end if;
  if v_status not in ('draft', 'active') then
    raise notice 'bootstrap: challenge is % — skipping', v_status;
    return;
  end if;
  if exists (select 1 from public.challenge_penalty_definitions
             where challenge_id = v_cid) then
    raise notice 'bootstrap: challenge already has penalty definitions — skipping';
    return;
  end if;

  insert into public.challenge_penalty_definitions
    (challenge_id, unlock_streak, penalty_type, value, display_name, sort_order)
  values
    (v_cid, 20, 'minimum_minutes', 45, '45-minutaren', 1),
    (v_cid, 40, 'minimum_minutes', 60, '60-minutaren', 2),
    (v_cid, 60, 'double_session',   2, 'Dubbelpass',   3);

  insert into public.audit_log
    (challenge_id, entity_type, entity_id, action, note)
  values
    (v_cid, 'challenge', v_cid, 'penalties_bootstrapped',
     'Standardstraff infört i den pågående utmaningen (engångsåtgärd via migration)');

  -- Retroactive earning. `_reconcile_earned_penalties` is a no-op unless the
  -- challenge is `active`; for an active challenge it grants every milestone a
  -- member already reached in a historical streak run (earned_on_date = the day
  -- it was reached). It never creates an assignment and never touches a day's
  -- requirement.
  v_count := 0;
  for m in
    select user_id from public.challenge_memberships where challenge_id = v_cid
  loop
    perform public._reconcile_earned_penalties(v_cid, m.user_id);
    v_count := v_count + 1;
  end loop;

  raise notice 'bootstrap: seeded 3 definitions, reconciled % member(s)', v_count;
end $$;
