-- ============================================================================
-- Hälsoutmaningen — Phase 11 / 0014  retroactive training registration
--                                    ("efterregistrering") — schema + RLS
--
-- Depends on 0001–0013. Forward-only, non-destructive, ADDITIVE.
--
-- Problem: normal same-day logging is (correctly) locked to the challenge-local
-- current day (training_entries_guard). A participant who genuinely trained on
-- a past eligible day but could not register it (no connectivity) has no path.
--
-- This migration adds a REQUEST model — never an overloaded "pending" row in
-- training_entries:
--
--   retroactive_training_requests            one per (participant, day) attempt
--   retroactive_training_request_sessions    1..N proposed sessions, each with
--                                            its own proof metadata
--
-- While a request is pending it changes NOTHING: challenge_day_states, streak
-- runs, challenge_results, liability and KASSAN are all derived live from
-- training_entries / training_proofs and never look at these tables.
--
-- On approval (0015) an admin RPC writes real training_entries + training_proofs
-- with the original historical challenge_date; the existing reconcile triggers
-- and derived views then recompute everything. No bespoke completion logic.
--
-- Proof bytes: uploaded ONCE, by the participant, into the existing private
-- `proofs` bucket at the canonical path {challenge}/{uid}/{date}/{uuid}.{ext}.
-- No second bucket, no copy/move on approval. A PENDING proof is protected by
-- tightening the (previously over-broad) `proofs` SELECT policy below: a
-- challenge member may read an object only if it backs a real training_proofs
-- row (every existing proof does — social transparency is unchanged) or they
-- own it or they are an admin. A pending efterregistrering proof has only a
-- request-session row → invisible to other participants until approval links a
-- training_proofs row to the SAME object.
-- ============================================================================

-- Widen the append-only audit entity vocabulary (precedent: 0007).
alter table public.audit_log
  drop constraint if exists audit_log_entity_type_valid;
alter table public.audit_log
  add constraint audit_log_entity_type_valid
  check (entity_type in (
    'profile', 'challenge', 'challenge_membership', 'training_entry',
    'training_proof', 'challenge_penalty_definition', 'earned_penalty',
    'penalty_assignment', 'retroactive_training_request'
  ));

-- ----------------------------------------------------------------------------
-- retroactive_training_requests  — the request header
-- ----------------------------------------------------------------------------
create table public.retroactive_training_requests (
  id                 uuid primary key default gen_random_uuid(),
  challenge_id       uuid not null references public.challenges (id) on delete cascade,
  user_id            uuid not null references public.profiles (id) on delete cascade,
  challenge_date     date not null,
  participant_reason text not null
                       constraint rtr_reason_len
                       check (char_length(btrim(participant_reason)) between 1 and 1000),
  -- pending    → awaiting admin review (the only state that blocks a re-request)
  -- approved   → sessions materialised into training_entries
  -- rejected   → closed with a mandatory admin reason, no training created
  -- cancelled  → withdrawn by the participant before review
  status             text not null default 'pending'
                       constraint rtr_status_valid
                       check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  submitted_at       timestamptz not null default now(),
  reviewed_at        timestamptz,
  reviewed_by        uuid references public.profiles (id) on delete set null,
  review_note        text
                       constraint rtr_review_note_len
                       check (review_note is null or char_length(review_note) <= 1000),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  -- A reviewed request always carries the reviewer + timestamp; a rejection
  -- always carries a reason.
  constraint rtr_review_coherent
    check ((status in ('approved', 'rejected'))
           = (reviewed_at is not null and reviewed_by is not null)),
  constraint rtr_rejection_has_reason
    check (status <> 'rejected'
           or char_length(btrim(coalesce(review_note, ''))) > 0)
);

comment on table public.retroactive_training_requests is
  'A participant''s request to register training for a PAST eligible challenge '
  'day. Pending requests change nothing; an admin RPC (0015) approves (creating '
  'real training_entries with the original challenge_date) or rejects. Writes '
  'only through the SECURITY DEFINER RPCs — no INSERT/UPDATE/DELETE policy.';

create trigger rtr_set_updated_at
  before update on public.retroactive_training_requests
  for each row execute function public.set_updated_at();

-- At most ONE pending request per participant-day. An approved/rejected/
-- cancelled request does not block a fresh attempt (the submit RPC still
-- rejects a request for a day that is already completed).
create unique index rtr_one_pending_per_day
  on public.retroactive_training_requests (challenge_id, user_id, challenge_date)
  where status = 'pending';

create index rtr_queue_idx
  on public.retroactive_training_requests (challenge_id, status, submitted_at);
create index rtr_owner_idx
  on public.retroactive_training_requests (user_id, challenge_id);

-- ----------------------------------------------------------------------------
-- retroactive_training_request_sessions  — 1..N proposed sessions
-- ----------------------------------------------------------------------------
create table public.retroactive_training_request_sessions (
  id                uuid primary key default gen_random_uuid(),
  request_id        uuid not null
                      references public.retroactive_training_requests (id) on delete cascade,
  duration_minutes  integer not null
                      constraint rtrs_duration_positive
                      check (duration_minutes > 0 and duration_minutes <= 1440),
  activity          text
                      constraint rtrs_activity_len
                      check (activity is null or char_length(activity) <= 120),
  note              text
                      constraint rtrs_note_len
                      check (note is null or char_length(note) <= 2000),
  sort_order        smallint not null default 1
                      constraint rtrs_sort_order_valid
                      check (sort_order >= 1 and sort_order <= 20),
  -- Proof metadata mirrors training_proofs. The object already lives in the
  -- private `proofs` bucket at this path; approval attaches a training_proofs
  -- row pointing at it (no byte copy).
  proof_storage_path text
                       constraint rtrs_proof_path_len
                       check (proof_storage_path is null
                              or char_length(proof_storage_path) between 1 and 400),
  proof_mime_type    text
                       constraint rtrs_proof_mime_valid
                       check (proof_mime_type is null or proof_mime_type in (
                         'image/jpeg', 'image/png', 'image/webp',
                         'image/heic', 'image/heif')),
  proof_size_bytes   bigint
                       constraint rtrs_proof_size_valid
                       check (proof_size_bytes is null
                              or (proof_size_bytes > 0 and proof_size_bytes <= 15728640)),
  proof_width        integer check (proof_width is null or proof_width > 0),
  proof_height       integer check (proof_height is null or proof_height > 0),
  created_at         timestamptz not null default now(),

  -- Proof metadata is all-or-nothing.
  constraint rtrs_proof_coherent
    check ((proof_storage_path is null) = (proof_mime_type is null)
       and (proof_storage_path is null) = (proof_size_bytes is null)),
  constraint rtrs_unique_order unique (request_id, sort_order)
);

comment on table public.retroactive_training_request_sessions is
  'One proposed training session inside a retroactive request. Multiple rows '
  'support an honest Dubbelpass day. Each carries its own proof metadata when '
  'the challenge requires proof. Writes only through the request RPCs.';

create index rtrs_request_idx
  on public.retroactive_training_request_sessions (request_id, sort_order);

-- ============================================================================
-- RLS  — participants see only their own; admins see all. All writes are RPC.
-- ============================================================================
alter table public.retroactive_training_requests          enable row level security;
alter table public.retroactive_training_request_sessions  enable row level security;

revoke all on public.retroactive_training_requests,
              public.retroactive_training_request_sessions
  from anon;

grant select on public.retroactive_training_requests         to authenticated;
grant select on public.retroactive_training_request_sessions to authenticated;

create policy rtr_select on public.retroactive_training_requests
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

create policy rtrs_select on public.retroactive_training_request_sessions
  for select to authenticated
  using (
    exists (
      select 1 from public.retroactive_training_requests r
      where r.id = retroactive_training_request_sessions.request_id
        and (r.user_id = (select auth.uid()) or public.is_admin())
    )
  );

-- No INSERT / UPDATE / DELETE policies: the SECURITY DEFINER RPCs in 0015 are
-- the only writers (they run as owner and bypass RLS, like assign_penalty).

-- ============================================================================
-- Storage: tighten the `proofs` bucket read policy.
--
-- Before: any challenge member could read ANY object under a challenge folder.
-- After:  admin, OR the object's owner (foldername[2] = auth.uid()), OR the
--         object backs a training_proofs row for a challenge the reader belongs
--         to. Every existing proof is backed by a training_proofs row, so the
--         social-transparency read is unchanged; a pending efterregistrering
--         proof (request-session row only) is visible to its owner + admins
--         until approval links a training_proofs row to it.
-- ============================================================================
drop policy if exists "proofs: members and admins can read" on storage.objects;

create policy "proofs: members and admins can read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'proofs'
    and (
      public.is_admin()
      or (storage.foldername(name))[2] = (select auth.uid())::text
      or exists (
        select 1 from public.training_proofs tp
        where tp.storage_path = name
          and public.is_challenge_member(tp.challenge_id)
      )
    )
  );
