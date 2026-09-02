-- ============================================================================
-- Hälsoutmaningen — Phase 9 / 0011  default Straffbanken config for the first
-- challenge (DATA, optional).
--
-- Mirrors 0004_seed_first_challenge: idempotent, non-destructive, only touches
-- the fixed first-challenge id and only while it is still a draft with no
-- penalty definitions. If the production challenge was created with a different
-- id, configure its penalties from the admin UI instead (or call
-- seed_default_penalty_definitions(<id>)).
--
--   20-day streak -> "45-minutaren"  (minimum_minutes 45)
--   40-day streak -> "60-minutaren"  (minimum_minutes 60)
--   60-day streak -> "Dubbelpass"    (double_session 2)
-- ============================================================================

insert into public.challenge_penalty_definitions
  (challenge_id, unlock_streak, penalty_type, value, display_name, sort_order)
select v.challenge_id, v.unlock_streak, v.penalty_type, v.value, v.display_name, v.sort_order
from (values
  ('11111111-1111-4111-8111-111111111111'::uuid, 20, 'minimum_minutes', 45, '45-minutaren', 1),
  ('11111111-1111-4111-8111-111111111111'::uuid, 40, 'minimum_minutes', 60, '60-minutaren', 2),
  ('11111111-1111-4111-8111-111111111111'::uuid, 60, 'double_session',   2, 'Dubbelpass',   3)
) as v(challenge_id, unlock_streak, penalty_type, value, display_name, sort_order)
where exists (
  select 1 from public.challenges c
  where c.id = v.challenge_id and c.status = 'draft'
)
and not exists (
  select 1 from public.challenge_penalty_definitions d
  where d.challenge_id = v.challenge_id
);
