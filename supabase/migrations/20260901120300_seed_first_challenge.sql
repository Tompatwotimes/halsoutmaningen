-- ============================================================================
-- Hälsoutmaningen — 0004 first challenge (DATA, not schema)
--
-- OPTIONAL. Inserts the first challenge's configuration as data, from
-- docs/PRODUCT_SPEC.md §3. Idempotent and non-destructive: it only inserts if
-- a row with this fixed id does not already exist, and never updates or
-- deletes anything.
--
-- Status is 'draft' on purpose — an administrator flips it to 'active' from the
-- admin UI once membership and any handling of already-elapsed days is sorted
-- out. The rule fields lock at that point.
--
-- If you would rather create the first challenge entirely through the admin UI
-- later, this migration can be dropped with no impact on the schema.
-- ============================================================================

insert into public.challenges (
  id, name, start_date, end_date, timezone,
  required_minutes, proof_required, missed_day_cost, status
)
select
  '11111111-1111-4111-8111-111111111111'::uuid,
  'Hälsoutmaningen 2026',
  date '2026-08-01',
  date '2026-11-28',
  'Europe/Stockholm',
  30,
  true,
  50,
  'draft'
where not exists (
  select 1 from public.challenges
  where id = '11111111-1111-4111-8111-111111111111'::uuid
);
