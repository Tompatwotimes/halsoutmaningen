-- ============================================================================
-- Hälsoutmaningen — 0026  a second, optional training-proof image
--
-- Spec: docs/superpowers/specs/2026-09-06-chat-proof-media-polish-design.md §B2
-- Plan: docs/superpowers/plans/2026-09-06-chat-proof-media-polish-implementation.md (Task 4)
--
-- Depends on 0001–0025. Forward-only, ADDITIVE. `training_proofs` moves from
-- "exactly one row per session" to "one or two rows per session" — image 1 is
-- the (required, when proof_required) proof, image 2 is optional.
--
-- Every session (a `training_entries` row keyed by session_seq) still has its
-- OWN proof(s); nothing about multi-session logging changes. Storage layout,
-- the private `proofs` bucket, and every `storage.objects` policy are
-- unchanged — they key on `{challenge_id}/{user_id}/…` and on a backing
-- `training_proofs` row, never on a count. `training_proofs_guard` (0002) and
-- the `training_proofs` table RLS (0002) are unchanged and position-agnostic.
--
-- Nothing here touches training completion / missed-day state, streaks,
-- debt/KASSAN, Straffbanken, retroactive registration, weight or Game Master.
-- ============================================================================

-- `position` 1 = the primary proof, 2 = the optional second image. The DEFAULT
-- backfills every existing row to 1, so every historical single-proof entry
-- stays valid and unchanged; a plain insert with no `position` (the
-- retroactive-approval path in 0011, and any caller that only needs one image)
-- still lands at 1.
alter table public.training_proofs
  add column position smallint not null default 1
    constraint training_proofs_position_valid check (position in (1, 2));

comment on column public.training_proofs.position is
  '1 = primary proof (required when the challenge requires proof), 2 = optional '
  'second image. At most two rows per training_entry_id.';

-- Replace "one row per entry" with "one row per (entry, slot)".
alter table public.training_proofs
  drop constraint training_proofs_one_per_entry;

alter table public.training_proofs
  add constraint training_proofs_one_per_slot
    unique (training_entry_id, position);

-- `check (position in (1,2))` + `unique (training_entry_id, position)` ⇒ a
-- third proof for a session is structurally impossible, no runtime check
-- needed. The frontend also rejects a 3rd file before any upload.
