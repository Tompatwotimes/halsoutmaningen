-- ============================================================================
-- Hälsoutmaningen — PWA + Web Push Notifications V1 / dispatch invocation fix
--
-- INCIDENT (2026-09-13): real-device evidence showed automatic push
-- notifications arriving 30–90+ minutes late. `_notification_scheduler_tick()`
-- (0034, hourly pg_cron) was enqueueing `notification_outbox` rows exactly on
-- time — the ENQUEUE side was never the problem. The DISPATCH side (actually
-- claiming and sending a queued row) depended entirely on
-- `.github/workflows/notification-dispatch.yml`, a GitHub Actions
-- `schedule: cron: '*/5 * * * *'` job. GitHub Actions' scheduled triggers are
-- documented best-effort only; the observed real run history for this repo
-- showed gaps of 1.5–3 HOURS between runs, not 5 minutes — confirmed by
-- matching `notification_outbox.claimed_at` timestamps to the workflow's own
-- run history almost to the second.
--
-- Fix: invoke the same `notification-dispatcher` Edge Function from
-- `pg_cron` + `pg_net` instead — a call from inside the database itself,
-- running on Supabase's own infrastructure, not subject to GitHub Actions'
-- scheduling variance. `.github/workflows/notification-dispatch.yml` is left
-- in place as a redundant secondary caller (the function's own
-- `FOR UPDATE SKIP LOCKED` claim makes overlapping/duplicate invocations
-- safe by design, per that workflow's own comments) — belt and suspenders,
-- not a single point of failure either way.
--
-- The CRON_SECRET bearer token the function checks is stored in Supabase
-- Vault (`vault.decrypted_secrets`), NEVER in this file or any migration —
-- exactly like every other secret in this repo (CLAUDE.md §19). It is
-- declared in supabase/config.toml as `[[vault.secrets]]` (name only — no
-- value in git) and provisioned by `supabase db push` reading the actual
-- value from a `NOTIFICATION_DISPATCH_CRON_SECRET` environment variable at
-- push time, matched to the Edge Function's own `CRON_SECRET` secret. Until
-- that secret exists, the tick function below is a silent no-op (raises a
-- notice, does nothing) — it must never hard-fail the pg_cron job or this
-- migration.
--
-- Forward-only, ADDITIVE. Depends on 20260911090300 (_notification_scheduler_tick).
-- ============================================================================

-- ---- pg_net -----------------------------------------------------------------
-- Guarded exactly like every other optional extension in this repo
-- (pg_cron in 20260904130100/20260911090300) — the migration chain must
-- never break in a project/plan where pg_net isn't available.
do $$
begin
  create extension if not exists pg_net;
  raise notice 'notification dispatch: pg_net enabled';
exception when others then
  raise notice 'notification dispatch: pg_net unavailable (%), tick function will no-op', sqlerrm;
end
$$;

-- ---- dispatch tick ------------------------------------------------------------

create or replace function public._notification_dispatch_tick()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text;
begin
  -- No-op, quietly, until both pg_net and the Vault secret exist — this
  -- function must never be the reason a migration or a cron run fails.
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    return;
  end if;

  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'notification_dispatch_cron_secret'
  limit 1;

  if v_secret is null then
    raise notice 'notification dispatch: vault secret "notification_dispatch_cron_secret" not provisioned yet — skipping tick';
    return;
  end if;

  -- The project URL is not secret — it is already hardcoded identically in
  -- .github/workflows/notification-dispatch.yml and this repo's own docs.
  perform net.http_post(
    url := 'https://offvlyflactysibrssco.supabase.co/functions/v1/notification-dispatcher',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_secret,
      'Content-Type', 'application/json'
    ),
    body := '{"action":"dispatch"}'::jsonb,
    timeout_milliseconds := 20000
  );
end;
$$;

comment on function public._notification_dispatch_tick() is
  'Per-minute pg_cron dispatcher trigger: calls the notification-dispatcher '
  'Edge Function''s "dispatch" action via pg_net, so queued notification_outbox '
  'rows are sent on a real ~1-minute cadence instead of depending on GitHub '
  'Actions'' best-effort scheduling. A silent no-op until pg_net and the Vault '
  'secret it reads are both provisioned. Internal — no app-role EXECUTE.';

revoke all on function public._notification_dispatch_tick()
  from public, anon, authenticated;

-- ---- pg_cron wiring -----------------------------------------------------------
-- Every minute is pg_cron's tightest ordinary granularity. The Edge Function
-- claims a bounded batch per call (FOR UPDATE SKIP LOCKED), so an overlapping
-- run (this tick + a concurrent GitHub Actions run) is safe by design.
do $$
begin
  perform cron.schedule(
    'halsoutmaningen-notification-dispatch',
    '* * * * *',
    'select public._notification_dispatch_tick();'
  );
  raise notice 'notification dispatch: per-minute pg_cron tick registered';
exception when others then
  raise notice 'notification dispatch: pg_cron unavailable (%), tick not registered — _notification_dispatch_tick() still exists and can be driven externally', sqlerrm;
end
$$;
