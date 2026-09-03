# Hälsoutmaningen — Phase 9: reusable platform + Straffbanken

Design reference for the Phase 9 **database + domain foundation**. Migrations
`20260902090000`–`20260902090700` and `src/domain/penalties.ts` +
`src/domain/dayState.ts` + `src/domain/liability.ts` are the source of truth;
this explains the model and the decisions.

The Phase 9 UI (challenge management screens, the Straffbank surface, the audit
viewer, corrections UI, export) is documented in §13 — same branch.

---

## 1. Challenge lifecycle

Statuses are unchanged: `draft → active → completed → archived`. The transitions
allowed for a JWT session (a no-JWT backend may break glass) are:

```
draft     → active | archived
active    → completed | archived
completed → active (reopen) | archived
archived  → active (reopen) | completed
```

`draft → completed` is rejected (a draft was never run). Reopening
(`completed/archived → active`) exists so genuine admin corrections are always
possible — nothing is permanently frozen.

New columns on `challenges`: `description` (nullable), `activated_at`,
`completed_at` (set by `challenges_guard`, not user-writable). Everything else
about a challenge is still **derived, never stored** — day count, matrix
columns, elapsed/remaining days, max liability, participant counts.

Lifecycle RPCs (all admin-checked, `SECURITY DEFINER`):

| RPC                                                          | Effect                                                        |
| ------------------------------------------------------------ | ------------------------------------------------------------- |
| `create_challenge(...)`                                      | insert a draft, `created_by = auth.uid()`                     |
| `duplicate_challenge(source, name, start, end, copy_roster)` | "Skapa ny från denna" — see §5                                |
| `complete_challenge(challenge)`                              | `active → completed`; **expires** all unused earned penalties |
| `archive_challenge(challenge)`                               | `→ archived`; expires unused earned penalties                 |
| `reopen_challenge(challenge)`                                | `completed/archived → active`, audited                        |

Reaching the challenge's `end_date` already stops new participant training and
new penalty assignments (date checks in the guards / `assign_penalty`). Explicit
`complete_challenge` is still meaningful: it is the moment unused Straffbank
ammunition **expires** and results become "final". It is deliberately
conservative — it does not delete anything.

---

## 2. Rule-mutation policy — hard immutability

**Decision: hard immutability, "duplicate to change". No effective-dated rule
versions.**

While a challenge is a **not-yet-started draft**, every rule field is freely
editable (`challenges_guard` allows it; `challenges_audit` records before/after).
Once the challenge is `active` **or** its `start_date` has passed (in its own
timezone), these are permanently locked for any JWT session:

- `start_date`, `timezone`, `required_minutes`, `proof_required`,
  `missed_day_cost`
- `end_date` may still be **extended**, never shortened (and not at all once
  `completed`/`archived`)
- penalty definitions (`challenge_penalty_definitions`) lock on the same
  condition, via `challenge_penalty_definitions_guard`

`name` / `description` / `status` stay editable.

Editing a **draft's** dates re-validates every existing membership window and is
rejected if any would fall outside the new range (with a Swedish message naming
the count).

### Why not versioned rules

The spec invites "versioned / effective-dated challenge rules … rather than
hacks". We rejected them because:

- The product **discourages** mid-challenge rule changes ("prefer immutable
  historical interpretation over retroactively changing old days").
- Effective-dated rules force every reader — `challenge_day_states`, the
  requirement engine, streak runs, liability, the matrix, `challenge_results` —
  to do a per-date rule lookup, multiplying complexity across the entire
  surface for a case that should not happen.
- Hard immutability + `duplicate_challenge` gives the same outcome ("change the
  rules → new challenge") with none of that cost, and 90 % of it already
  existed in `challenges_guard`.

A running challenge whose rules are wrong is duplicated into a fresh draft; the
broken one is completed/archived. History is never rewritten.

### One narrow exception: correcting a misconfigured active start_date

`duplicate_challenge` doesn't help when the mistake is the **start_date itself**
on a challenge people are already logging real training against — duplicating
loses the running history. Migration `20260903100000` adds exactly one
flag-gated bypass to the lock above, forward-only:

- `preview_challenge_start_date_correction` / `correct_challenge_start_date`
  (admin-only, `SECURITY DEFINER`) — the only way to move `start_date`, and
  only when no `active` `training_entries`, `active` `penalty_assignments`, or
  `earned_penalties` fall in the period being dropped. Nothing is ever
  deleted: `challenge_day_states`/streaks/liability are derived live from
  `challenges.start_date`, so the dropped dates simply stop being generated.
- `challenges_guard` reads a transaction-local `app.allow_start_date_correction`
  flag (set only by that RPC, mirroring the `app.audit_reason` idiom used by
  `invalidate_training_session`) to let `start_date` move forward through the
  lock; every other locked field stays locked during the same UPDATE.
- Audited as `challenge_start_date_corrected` (old/new start, actor, optional
  reason) via `audit_row_change`, distinct from the generic
  `challenge_rules_changed`.

This is a correction of a data-entry mistake, not a rule-mutation policy
change — the hard-immutability decision above still holds for every other
field, and for moving a date _backward_ or on a non-`active` challenge.

### One-time bootstrap for the already-running 2026 challenge

Migration `20260902090700` introduces the default Straffbanken definitions into
the **existing, already-`active`** first challenge and then reconciles every
member's historical streak runs.

This does **not** weaken immutability:

- It runs as a **no-JWT migration session** — the same documented break-glass
  the guards already recognise (`(select auth.uid()) is null`). A JWT admin
  still cannot touch an active challenge's penalty definitions.
- A day's training requirement comes from `penalty_ASSIGNMENTS`, never from
  definitions. Adding definitions changes **no** historical or current day
  requirement — it only enables _earning_ (applied retroactively) and _future_
  assignments.
- It is idempotent (skips if the challenge already has any definition) and
  creates **no** assignments. `assign_penalty` still refuses any target date
  that is not strictly after the challenge-local today.

Retroactive earning: `_reconcile_earned_penalties(challenge, member)` grants
every milestone a member already reached in a historical streak run, with
`earned_on_date` = the day it was actually reached. If the production challenge
id differs from the fixed one in the migration, edit it there or run the
equivalent `INSERT` + per-member `_reconcile_earned_penalties(...)` in the SQL
editor (a no-JWT session, same bypass).

---

## 3. Multi-session training model

`training_entries` **is** the session table now (name kept to avoid churning
every FK, policy, guard and generated type).

- New `session_seq smallint not null default 1` — 1-based ordinal within
  `(challenge_id, user_id, challenge_date)`. Gaps are allowed.
- `UNIQUE (challenge_id, user_id, challenge_date)` → `UNIQUE (…, session_seq)`.
- Every existing row backfilled to `session_seq = 1` — **no behaviour change for
  historical data**; a day with one entry evaluates exactly as before.
- `training_proofs` stays 1:1 with a session — each session carries its own
  proof.
- The client's existing "log today" upsert targets `session_seq = 1` (the day's
  primary session). `add_training_session(challenge, minutes, activity, note)`
  appends an extra session for today, assigning the next `session_seq`
  atomically (retry on the unique collision). All the per-session eligibility
  rules in `training_entries_guard` are unchanged — they were always evaluated
  per row.

We did **not** fake a second session with a flag on one row. A `Dubbelpass` day
is two real `training_entries` rows with two real proofs.

---

## 4. The one daily-requirement engine

`src/domain/penalties.ts::computeDailyRequirement` and the SQL
`challenge_daily_requirement(base, penalty_type, penalty_value)` are the same
function. Every status surface derives the requirement from it.

```
                     requiredTotalMinutes   requiredSessions   minMinutesPerSession
normal (base B)      B                      1                  0
minimum_minutes V    max(B, V)              1                  0
double_session  N    B · N                  N                  B
```

A **session contributes** to the day when it is:

- `status = 'active'` (not admin-invalidated),
- `duration_minutes >= minMinutesPerSession`, and
- when the challenge requires proof, has its **own** proof row.

A day is **completed** when
`contributingSessions >= requiredSessions AND Σ(contributing minutes) >= requiredTotalMinutes`.

Consequences, all covered by tests:

- Normal day: one 30-min proven session — or 20 + 15 proven — completes it.
- `45-minutaren`: 20 + 25 valid minutes complete it (minutes add up).
- `60-minutaren`: 35 minutes does **not**; the day is `missed`.
- `Dubbelpass` (base 30): one 70-min session does **not** (only 1 qualifying
  session); two proven sessions each ≥ 30 do.
- An invalidated session never contributes to anything.

`challenge_day_states(challenge_id, user_id?)` returns, per `(participant, day)`:
`state`, `session_count`, `valid_session_count`, `total_valid_minutes`,
`required_minutes` (effective), `required_sessions`, `min_minutes_per_session`,
`penalty_type`, `penalty_display_name`, `penalty_from_user_id`. It is
multi-session and penalty aware and is the **only** authoritative state source.
`src/domain/dayState.ts` mirrors it for optimistic rendering.

### Money is not touched by penalties

A penalised day that is `missed` costs the **normal** `missed_day_cost` — the
same as any other missed eligible day. Penalties change the _training
requirement_, never the SEK. There is no second monetary charge.

### Streaks

A penalty day extends the streak only if its **enhanced** requirement is met;
otherwise it breaks the streak exactly like any missed participating day.
`future` / `pending` / `not_participating` semantics are unchanged.

---

## 5. Straffbanken

Three tables (`20260902090200`):

| Table                           | Purpose                                 | Written by                                          |
| ------------------------------- | --------------------------------------- | --------------------------------------------------- |
| `challenge_penalty_definitions` | per-challenge milestone catalog         | admins directly (RLS + lock guard + audit trigger)  |
| `earned_penalties`              | a participant's inventory               | `reconcile_earned_penalties` only                   |
| `penalty_assignments`           | a penalty applied to a target on a date | `assign_penalty` / `cancel_penalty_assignment` only |

`earned_penalties` and `penalty_assignments` have **no INSERT/UPDATE policies** —
the SECURITY DEFINER RPCs are the only writers, and they own atomicity,
idempotency and audit.

### 5.1 Penalty definitions

Configurable, not hardcoded:

```
challenge_id · unlock_streak · penalty_type · value · display_name · active · sort_order
```

`penalty_type ∈ {minimum_minutes, double_session}`. `value` is minutes for
`minimum_minutes`, session count (≥ 2) for `double_session`. A future challenge
can configure "30 days → 60 minutes, 50 days → double session" with zero code.

Hälsoutmaningen defaults (`seed_default_penalty_definitions(challenge)` or the
optional `20260902090600` seed for the fixed first-challenge id):

```
20-day streak → "45-minutaren"  minimum_minutes 45
40-day streak → "60-minutaren"  minimum_minutes 60
60-day streak → "Dubbelpass"    double_session   2
```

### 5.2 Earning — streak runs, server-authoritative, idempotent

A **streak run** is a maximal sequence of consecutive completed eligible days.
Its identity is the date of its **first** completed day. Reaching a definition's
`unlock_streak` _within_ a run earns that definition **once for that run**
(`(challenge, user, definition, streak_run_start)` is a UNIQUE key). A later,
separate run may earn the same milestone again.

`reconcile_earned_penalties(challenge, user?)`:

1. rebuild the participant's streak runs from `challenge_day_states`
   (`challenge_streak_runs`),
2. compute the valid earned set (`challenge_valid_earned_penalties`:
   for every run, every definition with `unlock_streak <= run_length`, with
   `earned_on_date = run_days[unlock_streak]`),
3. `INSERT … ON CONFLICT DO NOTHING` — a reload / RPC retry / proof replacement
   never double-grants,
4. mark any still-**available** row whose `(definition, run_start)` is no longer
   valid as `revoked` (a streak correction removed its basis),
5. **cascade** for a `spent` row whose basis vanished (a historical
   invalidation shrank the streak):
   - its assignment's `target_date` is still in the **future** (challenge-local)
     → auto-cancel the assignment, revoke the earned row, audit both as
     automatic (`after_data.auto = true`),
   - its `target_date` has already **elapsed** → leave everything (history is
     not rewritten),
6. audit `penalty_earned` / `penalty_revoked` / auto `penalty_assignment_cancelled`
   per row.

It runs **automatically** from statement-level triggers on `training_entries`
and `training_proofs` (transition tables → each affected participant reconciled
once), and is also a callable RPC for admin tools. It is a no-op unless the
challenge is `active` (completion freezes the earned state).

`earned_penalties.status ∈ {available, spent, expired, revoked}`.

### 5.3 Assignment — atomic

`assign_penalty(earned_penalty_id, to_user_id)` — one transaction:

1. `SELECT … FOR UPDATE` the inventory row: must be the caller's and
   `available`; challenge `active`; today ≤ `end_date`.
2. `to_user_id ≠ auth.uid()` (no self-target). Target must have an **active**
   membership.
3. **Target date** = the target's first eligible participation day **strictly
   after** the challenge-local today.
   - **Collision (no stacking): auto-advance.** If that day already has an
     active penalty for the target, advance to the next eligible unpenalized
     day. If the target has no such day left → fail cleanly ("Det finns ingen
     ledig dag kvar att straffa personen på").
4. Insert the assignment (`pa_one_active_per_target_day` partial unique index is
   the concurrency backstop; a lost race retries and re-advances).
5. Mark the inventory row `spent` (`spent_assignment_id` set). `pa_one_active_per_earned`
   is a **partial** unique index (`where status = 'active'`) — at most one
   _active_ assignment per earned penalty; a cancelled one having returned the
   ammo, it can be re-assigned once.
6. Audit `penalty_assigned`.

`preview_penalty_target(earned_penalty_id, to_user_id)` is the read-only version
for the confirm UI (returns the landing date or the reason it can't).

**Why auto-advance, not refuse (decision):** predictable UX. The sender's
ammunition always lands _somewhere_ if the target has any unpenalized future day
— no frustrating retry loop, and it doesn't leak which days the target is
already penalised on. The walk is bounded by the challenge length; the
"one active penalty per target per day" invariant always holds; the result
tells the sender the exact landed date.

### 5.4 Cancellation — admin correction, returns the ammo

`cancel_penalty_assignment(assignment_id, reason)` — admin only, reason
mandatory. It is an **administrative correction**, not a confiscation:

- assignment → `cancelled` (`cancelled_by`, `cancelled_reason`, `cancelled_at`),
- earned penalty → back to `available` (or `expired` if the challenge is no
  longer `active`), `spent_assignment_id` cleared — the sender gets their
  ammunition back and may re-assign it,
- one audit row, `penalty_assignment_cancelled`, with the reason as `note` and
  `after_data.ammunition_returned_as`.

The target's day reverts to the normal requirement immediately (the requirement
engine only reads `status = 'active'` assignments). A dedicated
revoke/confiscate admin action can be added later if it is ever needed.

### 5.5 Expiry

Unused (`available`) earned penalties become `expired` when the challenge is
completed/archived. They are **never** carried into another challenge —
`earned_penalties` is scoped by `challenge_id` and `reconcile` only runs for the
active challenge.

---

## 6. Admin corrections

`invalidate_training_session(entry_id, reason, reason_code?)` /
`revalidate_training_session(entry_id, reason)` — admin only, **reason
mandatory**. The original row, its proof metadata, the correcting admin
(`invalidated_by`), the time (`invalidated_at`) and the reason
(`invalidated_reason` + optional `invalidated_reason_code` ∈
`felregistrerad | otillrackligt_bildbevis | dubblett | fel_datum |
administrativ_rattning | annat`) are all preserved.

An invalidated session stops contributing to completion, streaks, penalty
earning and every "valid training" statistic — automatically, because
`challenge_day_states` filters `status = 'active'` and the reconcile trigger
fires on the status change (including the §5.2 cascade that auto-cancels a
future assignment whose earned basis this correction removed).

**Exactly one audit event** per correction. The RPC sets the reason
transaction-locally via `set_config('app.audit_reason', …, true)`; the
`training_entries_audit` trigger (`audit_row_change`) emits the single
`invalidate` / `revalidate` row with before/after snapshots **and** that reason
as its `note`. The RPCs write no audit row of their own — there is no duplicate.

Destructive `DELETE` is still possible for an admin but is not the workflow —
invalidation is.

---

## 7. Challenge duplication

`duplicate_challenge(source, name, start, end, copy_roster)`:

**Copies** the rule set (`timezone`, `required_minutes`, `proof_required`,
`missed_day_cost`, `description`) and all `challenge_penalty_definitions`. New
challenge is a `draft`, `created_by = auth.uid()`.

**Optionally** copies the roster — same people, a **fresh** window
(`participation_start_date = new start`, open end, active).

**Never** copies training history, proofs, earned penalties, assignments,
liabilities or audit records. One audit row (`challenge_created`, note
"duplicated from …").

This makes "Hälsoutmaningen 2027" a two-field form.

---

## 8. Historical / multi-challenge

`challenge_day_states` and `challenge_results` take a `challenge_id`, so any
challenge the caller is a member of is viewable. `fetchMyPrimaryChallenge`
already picks the active challenge (or the most recently started) as the app's
focus; a challenge switcher in the UI phase renders `fetchMyMemberships`
directly. Historical challenges are read-only in practice because their status
is `completed`/`archived` and the participant guards reject writes; an admin can
still reopen for a correction.

---

## 9. Export read model

`challenge_results(challenge_id)` returns, per participant, entirely from
authoritative state (no rule re-implementation, no proof URLs):

`participation window · membership_active · eligible/completed/missed/pending/
future days · completion_rate · current_streak · longest_streak ·
total_valid_minutes · liability_sek (= missed_days × missed_day_cost) ·
penalties_earned · penalties_assigned · penalties_received`

The UI phase turns this into the CSV and the admin dashboard.

---

## 10. Audit events

`audit_log.entity_type` widened with `challenge_penalty_definition`,
`earned_penalty`, `penalty_assignment`. Actions now emitted:

`challenge_created · challenge_activated · challenge_completed ·
challenge_archived · challenge_reopened · challenge_rules_changed ·
penalties_bootstrapped · membership_created · membership_window_changed ·
membership_deactivated · membership_reactivated · invalidate · revalidate ·
penalty_earned · penalty_revoked · penalty_assigned ·
penalty_assignment_cancelled · penalties_expired` (plus generic
`insert/update/delete` for penalty definitions).

Still append-only (`audit_log_prevent_change`), admin-read-only, written only by
`SECURITY DEFINER` code. `before_data` / `after_data` carry row snapshots; the
correction reason rides in the `note` column (attached to the single trigger
row via `set_config('app.audit_reason', …, true)` — the RPCs never write their
own audit row). Automatic corrections carry `after_data.auto = true` and a
`null` actor. No tokens or secrets are ever written.

---

## 11. Security / RLS

| Table                           | SELECT         | write                                    |
| ------------------------------- | -------------- | ---------------------------------------- |
| `challenge_penalty_definitions` | member ∪ admin | admin (RLS) + lock guard + audit trigger |
| `earned_penalties`              | own ∪ admin    | RPC only (no policy)                     |
| `penalty_assignments`           | member ∪ admin | RPC only (no policy)                     |

Every multi-step state change is a transactional `SECURITY DEFINER` RPC
(`search_path = ''`, schema-qualified, `EXECUTE` revoked from `public`/`anon`,
granted to `authenticated`), each doing its own `is_admin()` / ownership check —
a participant calling Supabase directly cannot award, consume, assign or cancel
a penalty, change a rule, invalidate an entry or touch audit data. The
service-role key never reaches the browser.

Internal-only helpers (`_reconcile_earned_penalties`,
`_next_penalty_target_date`, `challenge_streak_runs`,
`challenge_valid_earned_penalties`, `trg_reconcile_from_changed`) have
`EXECUTE` **revoked from `public`/`anon` and granted to nobody** — only the
DEFINER RPCs and triggers (owned by `postgres`) call them. Every date-sensitive
operation — `challenge_day_states` pending/missed, `assign_penalty` /
`preview_penalty_target` / `_next_penalty_target_date`, the challenge
rule-lock / end-date checks, the §5.2 future-vs-elapsed cascade split, streak
runs, `challenge_results` — resolves "today" via
`(now() at time zone <challenge>.timezone)::date` (`challenge_current_date`),
never the session `current_date` or a bare `now()::date`.

---

## 12. Production migration procedure

The migrations are **not applied to production in this phase.** They are
forward-only and safe for the current data (they only `ADD` / `CREATE` / widen
a check / backfill `session_seq = 1`). The last one, `20260902090700`, is a
one-time bootstrap that seeds the current challenge's penalty definitions and
retroactively reconciles historical streak runs (see §2); it is idempotent and
targets the fixed first-challenge id.

After review + approval, on a Supabase preview branch or CI first:

```bash
# 1. run the pgTAP suite against a real Postgres 17 + the migrations
supabase test db          # (or pg_prove over supabase/tests/*.sql)

# 2. apply to production
supabase db push --project-ref offvlyflactysibrssco

# 3. regenerate the generated types from the live schema
npm run db:types          # supabase gen types typescript --linked > src/types/database.ts

# 4. (optional) seed the first challenge's default penalties if it is still a draft
#    — the 20260902090600 migration does this automatically for the fixed id;
#    otherwise: select public.seed_default_penalty_definitions('<challenge id>');
```

`src/types/database.ts` was hand-updated in this phase to match the migrations;
step 3 replaces it with the canonical generated version.

---

## 13. Phase 9 UI (built on `phase-9-platform`)

Native to the existing dark Nordic system — same tokens, `Card`/`Button`/
`Badge`/`Sheet`/`StatusCell`, same bottom-nav (untouched). New surfaces:

**Participant**

- **Straffbanken** (`/straffbanken`, menu slot — reached from the desktop rail
  and teaser cards on Hem/Profil). Inventory grouped by kind (`×N`), next-unlock
  milestone, received penalties ("Du har blivit straffad"), sent list. The
  assignment flow is a `Sheet`: pick penalty → pick target → **live
  `preview_penalty_target` shows the exact landing date** → confirm →
  `assign_penalty`. Cancellation is admin-only.
- **Multi-session logging** (`MultiSessionLog`, auto-routed from `/logga` when
  the day carries a penalty). "Pass N av M" progress, per-session validity
  (`✓`/`!`), each session its own `SessionForm` with its own proof. Session 1 =
  `submitTraining` (upsert `session_seq=1`); session 2+ = `add_training_session`.
  Copy states plainly that one long session ≠ two.
- **Enhanced requirement everywhere**: `challenge_day_states` now returns the
  effective `requiredMinutes`/`requiredSessions`/penalty per day, threaded into
  `ParticipantView.todayRequirement` / `requirementByDate`. Hem shows the real
  bar + "Erik har gett dig …"; `EntryDetailSheet` shows the day total vs. the
  effective requirement; `RecentGrid` / `MatrixGrid` cells get a small `☠` dot
  (colour is never the only signal — the aria-label says "(straff)").
- **Challenge switcher**: `MyChallengesCard` on Profil lists every membership,
  bucketed current / upcoming / past. Read-oriented; the app's primary-challenge
  focus is unchanged.

**Admin** (mobile-first card lists, no desktop-only tables)

- **Utmaningar** (`/admin/utmaningar`): list by status; **create**
  (`/admin/utmaningar/ny`) → `create_challenge` (+ optional default penalties);
  **detail** (`/admin/utmaningar/:id`): derived facts, `ChallengeRuleFields`
  (locked with a clear warning once active/started, end-date still extendable),
  `PenaltyDefinitionList` (editable only while draft), lifecycle
  (activate/complete/archive/reopen — each a `ConfirmSheet`), **duplicate**
  (`DuplicateChallengeSheet`, optional roster copy), delete (draft only),
  results + **CSV export** (`challenge_results` → `buildChallengeResultsCsv`,
  no proof URLs/tokens).
- **Granskningslogg** (`/admin/granskningslogg`): filter by category / challenge
  / person / date; each row humanised to Swedish (`describeAuditEvent`) with
  before → after diffs; automatic corrections shown as "Automatiskt".
- **Admin corrections**: `EntryDetailSheet` gains a per-session
  "Ogiltigförklara / Återställ" control (admins only) with a mandatory reason +
  reason code → `invalidate_training_session` / `revalidate_training_session`.

**Files** — see the completion report for the full list. New feature dirs:
`src/features/straffbanken/*`, admin additions under `src/features/admin/*`,
new pages under `src/pages/admin/*` + `src/pages/StraffbankenPage.tsx`, shared
`src/components/ui/{PenaltyBadge,ConfirmSheet}.tsx`.

**Not merged. No migration pushed.**
