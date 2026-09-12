-- ============================================================================
-- Hälsoutmaningen — PWA + Web Push Notifications V1 / 0035  dispatcher claim RPC
--
-- Spec: docs/superpowers/specs/2026-09-11-pwa-push-v1-design.md §5
-- Plan: docs/superpowers/plans/2026-09-11-pwa-push-v1.md (Task 6)
--
-- Depends on 0031. Forward-only, ADDITIVE.
--
-- `FOR UPDATE SKIP LOCKED` has no PostgREST query-builder equivalent, so the
-- one thing the notification-dispatcher Edge Function cannot do with plain
-- service-role table calls is the atomic batch claim — everything else
-- (recording a delivery outcome, retiring a subscription, finalising an
-- outbox row's sent_at/failed_at/not_before) is a plain service-role
-- update/insert, which bypasses RLS exactly as intended (0031's comment on
-- notification_outbox: "read and claimed only by the notification-dispatcher
-- Edge Function via the service role, which bypasses RLS entirely").
--
-- Not revoked from service_role (the only caller): a scheduled GitHub Actions
-- job invokes the Edge Function with the service-role key, which reaches this
-- function through PostgREST as the `service_role` Postgres role — Supabase's
-- project-wide default grants already give that role EXECUTE, matching every
-- other function in this codebase (none explicitly grants to service_role;
-- pg_cron's internal dispatchers are simply never revoked from it either).
-- ============================================================================
create or replace function public._claim_notification_outbox_batch(
  p_limit      integer default 50,
  p_claimed_by text default null
)
returns setof public.notification_outbox
language sql
security definer
set search_path = ''
as $$
  with claimed as (
    update public.notification_outbox
    set claimed_at = now(),
        claimed_by = coalesce(p_claimed_by, claimed_by),
        attempt_count = attempt_count + 1
    where id in (
      -- Re-checked here, not only at enqueue time: if an admin flips a
      -- challenge's kill switch off AFTER a row was already queued, that row
      -- must never be claimed/sent while the switch stays off — an emergency
      -- brake that only stopped *new* enqueues would not actually stop an
      -- in-flight storm. Left unclaimed (not failed) so it sends normally
      -- once the challenge is re-enabled.
      select o.id from public.notification_outbox o
      join public.challenges c on c.id = o.challenge_id
      where o.sent_at is null
        and o.failed_at is null
        and o.not_before <= now()
        and c.push_enabled
      order by o.created_at
      limit greatest(1, least(p_limit, 200))
      for update skip locked
    )
    returning *
  )
  select * from claimed;
$$;

comment on function public._claim_notification_outbox_batch(integer, text) is
  'Atomically claims up to p_limit ready outbox rows (FOR UPDATE SKIP LOCKED, '
  'no PostgREST equivalent). Bumps attempt_count and claimed_at/claimed_by; '
  'the caller (notification-dispatcher Edge Function, service role) still '
  'decides sent_at/failed_at/not_before via plain service-role updates once '
  'delivery to every subscription for the row has been attempted.';

revoke all on function public._claim_notification_outbox_batch(integer, text)
  from public, anon, authenticated;
