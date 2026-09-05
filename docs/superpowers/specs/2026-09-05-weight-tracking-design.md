# Hälsoutmaningen — Weight Tracking / Viktkampen Design Specification

**Date:** 2026-09-05
**Status:** Design/spec only — no implementation, no migrations, not deployed
**Product:** Hälsoutmaningen
**Scope:** Start weight, optional daily weight logging, hide-my-weight privacy, public live ranking, official final weigh-in (v1)
**Depends on:** nothing (independently buildable and testable)
**Depended on by:** `2026-09-05-game-master-context-chat-weight-design.md` (Game Master reads this domain; it does not define it)

Companion documents: `2026-09-05-shared-chat-design.md`, `2026-09-05-game-master-context-chat-weight-design.md`. This document is authoritative for `weight_profiles`, `weight_entries` and `weight_competition_results`; the Game Master spec only *reads* them.

---

## 0. Global product principles (restated, binding across all three specs)

- The core challenge is sacred. Weight tracking must not change or directly affect completed/missed day state, training debt/liability, KASSAN, current streak, main training ranking, Straffbanken, or retroactive-registration behavior.
- Weight tracking is **completely independent of training registration**. `submitTraining`/`src/features/challenge/submit-training.ts` and the `LogPage` flow are not modified to ask for or mention weight.
- No weight proof image (unlike training, which requires proof — this is a deliberate, explicit difference; do not carry the `training_proofs` pattern over).
- Weight UI lives under **Profile** (`src/pages/ProfilePage.tsx`), not as a new nav destination — the five-item bottom navigation is unchanged.
- Every write with business rules goes through a `SECURITY DEFINER` RPC, matching the established convention (see chat spec §0 for the same restated principle — not repeated in full here).

---

## 1. Data model

### 1.1 `weight_profiles` — one row per (challenge, participant)

This supersedes the two-table split (`start_weights` + implicit hide flag) considered during inspection. A single per-challenge-participant row is used because the 24-hour lock anchor and the hide flag are both single facts about *one participant in one challenge*, and because the hide toggle must work even before any start weight exists (§1.1 note below) — a design that a `start_weights`-only table cannot satisfy cleanly, since that row might not exist yet when hiding is first toggled.

```sql
create table public.weight_profiles (
  challenge_id                  uuid not null references public.challenges (id) on delete cascade,
  user_id                       uuid not null references public.profiles (id) on delete cascade,

  start_weight_kg               numeric check (start_weight_kg is null or start_weight_kg > 0),
  -- Set ONCE, at the participant's first successful start-weight save.
  -- NEVER updated again by any RPC, including admin correction.
  start_weight_first_saved_at   timestamptz,
  -- Set ONCE, = start_weight_first_saved_at + interval '24 hours', at the same
  -- moment as first_saved_at. NEVER recomputed — not on participant edits
  -- during the window, not on an admin correction afterward.
  start_weight_locked_at        timestamptz,

  is_weight_hidden              boolean not null default false,

  -- Official final weigh-in (§6). Admin-only, always audited. Distinct from
  -- start_weight_kg's participant-then-admin lifecycle: every write to these
  -- three columns is an admin action, so there is no separate "lock" concept
  -- to model here — set_official_final_weight is always audited, every call.
  official_final_weight_kg      numeric check (official_final_weight_kg is null or official_final_weight_kg > 0),
  official_final_recorded_at    timestamptz,
  official_final_recorded_by    uuid references public.profiles (id),

  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),

  primary key (challenge_id, user_id),

  -- first_saved_at and locked_at are set together or not at all.
  constraint weight_profiles_start_weight_coherent
    check ((start_weight_kg is null) = (start_weight_first_saved_at is null)
       and (start_weight_first_saved_at is null) = (start_weight_locked_at is null)),
  constraint weight_profiles_official_final_coherent
    check ((official_final_weight_kg is null) = (official_final_recorded_at is null)
       and (official_final_recorded_at is null) = (official_final_recorded_by is null))
);

create trigger weight_profiles_set_updated_at
  before update on public.weight_profiles
  for each row execute function public.set_updated_at();  -- EXISTING helper, supabase/migrations/20260901120000_core_schema.sql
```

A row can exist with every nullable column null — created purely to hold `is_weight_hidden=true` before any weight has ever been entered (§4).

### 1.2 `weight_entries` — optional daily regular logging

```sql
create table public.weight_entries (
  id            uuid primary key default gen_random_uuid(),
  challenge_id  uuid not null references public.challenges (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  entry_date    date not null,   -- always challenge_current_date(challenge_id) at write time — see §5
  weight_kg     numeric not null check (weight_kg > 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint weight_entries_unique_day unique (challenge_id, user_id, entry_date)
);

create trigger weight_entries_set_updated_at
  before update on public.weight_entries
  for each row execute function public.set_updated_at();

create index weight_entries_challenge_user_idx
  on public.weight_entries (challenge_id, user_id, entry_date desc);
```

No `is_weight_hidden` column here — visibility is always derived by joining to `weight_profiles.is_weight_hidden` for the same `(challenge_id, user_id)` (§4), so the flag cannot drift between a participant's entries.

### 1.3 `weight_competition_results` — one row per challenge, the official outcome

"Winner" is a fact about the *challenge*, not about a participant row, so it gets its own singleton-per-challenge table rather than a flag bolted onto every participant's `weight_profiles` row.

```sql
create table public.weight_competition_results (
  challenge_id              uuid primary key references public.challenges (id) on delete cascade,
  winner_user_id            uuid references public.profiles (id),
  winner_percentage_change  numeric,             -- negative = weight lost, matches the ranking formula (§7)
  determined_at             timestamptz not null default now(),
  determined_by             uuid references public.profiles (id),
  -- Narrow, explicit publication of exactly {winner_user_id, winner_percentage_change}
  -- even when the winner has is_weight_hidden=true. Never affects any other
  -- participant's data and never reveals start/final kg or history (§6.3).
  disclosed_at              timestamptz,
  disclosed_by              uuid references public.profiles (id),

  constraint weight_competition_results_disclosure_coherent
    check ((disclosed_at is null) = (disclosed_by is null))
);
```

---

## 2. RPC boundaries

All SECURITY DEFINER, `set search_path = ''`, schema-qualified, `revoke ... from public, anon`, `grant execute ... to authenticated` only for the participant-facing ones.

### 2.1 `set_start_weight(p_challenge_id uuid, p_weight_kg numeric) returns public.weight_profiles`

- Requires active membership.
- `p_weight_kg > 0`, sane upper bound (e.g. reject over 400 kg — exact ceiling is an implementation detail, not a design decision).
- Upsert on `(challenge_id, user_id)`:
  - **First save** (`start_weight_first_saved_at is null` for the existing row, or no row exists yet): set `start_weight_kg = p_weight_kg`, `start_weight_first_saved_at = now()`, `start_weight_locked_at = now() + interval '24 hours'`.
  - **Within the 24h window** (`now() < start_weight_locked_at`): update `start_weight_kg` only; `start_weight_first_saved_at`/`start_weight_locked_at` untouched.
  - **After the window** (`now() >= start_weight_locked_at`): raise — participant cannot self-correct; direct them to ask an admin.

### 2.2 `correct_start_weight(p_challenge_id uuid, p_user_id uuid, p_weight_kg numeric, p_reason text) returns void` (admin)

- `is_admin()` only, mandatory non-empty reason.
- Updates `start_weight_kg` only. **Never touches `start_weight_first_saved_at`/`start_weight_locked_at`** — those remain the historical facts of the participant's own action regardless of a later value correction.
- Writes one `audit_log` row: `entity_type='weight_profile'` (**new** vocabulary value, widened the same zero-risk way every prior domain did it), `action='start_weight_corrected'`, `target_user_id=p_user_id`, `before_data`/`after_data` = `{start_weight_kg: ...}` before/after, `note=btrim(p_reason)`.
- Works even if no row exists yet (upserts) — an admin can set a start weight on a participant's behalf from nothing, though the ordinary path is the participant setting their own.

### 2.3 `log_weight_entry(p_challenge_id uuid, p_weight_kg numeric) returns public.weight_entries`

- Requires active membership.
- **Never accepts a date parameter at all** — always targets `public.challenge_current_date(p_challenge_id)` (**existing** function, `supabase/migrations/20260901120100_functions_and_rls.sql`). This makes backdating structurally impossible rather than merely checked, the same design choice `training_entries_guard` makes for training dates.
- Upsert on `(challenge_id, user_id, entry_date)` — inserts if today has no row yet; updates `weight_kg` if today already has one (same-day edit). A row for any date other than today is never reachable through this RPC, so "once the day changes it can't be edited" is true by construction, not by a runtime check on old rows.

### 2.4 `set_weight_hidden(p_challenge_id uuid, p_hidden boolean) returns void`

- Requires active membership.
- `insert into weight_profiles (challenge_id, user_id, is_weight_hidden) values (p_challenge_id, uid, p_hidden) on conflict (challenge_id, user_id) do update set is_weight_hidden = excluded.is_weight_hidden`.
- Works with every other column null — this is exactly how "must work even before a start weight exists" is satisfied: the row is created on first privacy-toggle if nothing else created it first.

### 2.5 `set_official_final_weight(p_challenge_id uuid, p_user_id uuid, p_weight_kg numeric, p_reason text) returns void` (admin)

- `is_admin()` only, mandatory reason on **every** call (including the first) — avoids a first-time/correction branch; every write is audited identically.
- Upserts `official_final_weight_kg/recorded_at/recorded_by` on `weight_profiles`.
- Audit row: `entity_type='weight_profile'`, `action='official_final_weight_set'`, `before_data`/`after_data` = `{official_final_weight_kg}`, `note=btrim(p_reason)`.

### 2.6 `finalize_weight_competition(p_challenge_id uuid) returns public.weight_competition_results` (admin)

- Computes the winner across **every** participant with both `start_weight_kg` and `official_final_weight_kg` set — **`is_weight_hidden` is never consulted here**, satisfying "a hidden participant remains fully eligible."
- `percentage_change = (official_final_weight_kg - start_weight_kg) / start_weight_kg * 100`; winner = most negative value.
- Upserts `weight_competition_results` (`determined_at=now()`, `determined_by=actor`). Re-runnable (e.g. after an admin correction changes who won) — each call overwrites the previous determination; this is an operational recompute, not itself something requiring a mandatory-reason audit trail beyond the existing `determined_by`/`determined_at` columns (it derives from already-audited `weight_profiles` writes).

### 2.7 `disclose_weight_winner(p_challenge_id uuid) returns void` (admin)

- Requires a `weight_competition_results` row to already exist (i.e. `finalize_weight_competition` has run).
- Sets `disclosed_at=now()`, `disclosed_by=actor`. Idempotent (calling twice is harmless).
- This is the **only** mechanism by which a hidden winner's name + percentage become visible to anyone other than the winner/admins — a completely separate action from toggling `is_weight_hidden`, and it affects **only** the single winner row in `weight_competition_results`, never any other participant, and never the winner's own `weight_profiles`/`weight_entries` visibility (§6.3).

### 2.8 `weight_public_ranking(p_challenge_id uuid) returns table(...)` — read model, SECURITY INVOKER

Mirrors `public.challenge_results(p_challenge_id)`'s existing pattern exactly (`security invoker`, `set search_path=''`, a plain query over data RLS already scopes) — **not** SECURITY DEFINER, so it inherently respects `weight_profiles`/`weight_entries` RLS for whoever calls it; no separate privacy logic is duplicated in the function body.

```sql
returns table (
  user_id uuid, display_name text,
  start_weight_kg numeric, latest_weight_kg numeric, latest_entry_date date,
  kg_change numeric, percentage_change numeric
)
```
filtered to rows where `start_weight_locked_at is not null` (a valid locked start weight exists), at least one `weight_entries` row exists, and — because it runs as invoker — a hidden participant's rows are simply invisible to it already via RLS (§4), so the function needs no explicit `is_weight_hidden` filter of its own; it only ever sees what its RLS-scoped queries return.

---

## 3. RLS

```sql
alter table public.weight_profiles           enable row level security;
alter table public.weight_entries            enable row level security;
alter table public.weight_competition_results enable row level security;

revoke all on public.weight_profiles, public.weight_entries, public.weight_competition_results
  from anon, authenticated;
grant select on public.weight_profiles            to authenticated;
grant select on public.weight_entries             to authenticated;
grant select on public.weight_competition_results to authenticated;

create policy weight_profiles_select on public.weight_profiles
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.is_admin()
    or (not is_weight_hidden and public.is_challenge_member(challenge_id))
  );

create policy weight_entries_select on public.weight_entries
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.is_admin()
    or (
      public.is_challenge_member(challenge_id)
      and not exists (
        select 1 from public.weight_profiles wp
        where wp.challenge_id = weight_entries.challenge_id
          and wp.user_id = weight_entries.user_id
          and wp.is_weight_hidden
      )
    )
  );

create policy weight_competition_results_select on public.weight_competition_results
  for select to authenticated
  using (
    public.is_admin()
    or public.is_challenge_member(challenge_id)
    -- Every authenticated challenge member may read this table's row, but the
    -- CONTENT of winner_user_id/winner_percentage_change for a hidden winner
    -- is only meaningful once disclosed_at is set — enforced by having
    -- weight_public_ranking / the frontend read model never surface
    -- winner_user_id at all until disclosed_at is not null. This table's own
    -- RLS intentionally does NOT hide the row itself (there is exactly one
    -- row per challenge and hiding it entirely would also hide "has a winner
    -- been determined yet" from ordinary participants) — the read model is
    -- the enforcement point for the narrower "which fields," per the general
    -- centralized-enforcement principle used throughout this project.
  );

-- No INSERT/UPDATE/DELETE policy on any of the three tables — every write
-- goes through §2's RPCs.
```

**Important, explicit design note on `weight_competition_results`:** RLS on Postgres is row-level, not column-level — it cannot itself say "show this row but blank two columns depending on `disclosed_at`." Two implementation options exist, and this spec recommends the second for consistency with the "centralize at the render/read boundary" principle used everywhere else in this project (see Game Master spec §5's identical reasoning for hidden-weight output safety):
1. A `security invoker` read RPC (`weight_final_result(p_challenge_id)`) that returns `winner_user_id`/`winner_percentage_change` as `NULL` unless `disclosed_at is not null` or the caller is the winner/an admin — this is the recommended shape, mirroring `weight_public_ranking`'s own pattern.
2. Relying on the frontend to withhold the fields — **explicitly rejected**, per "do not fetch hidden data to the client and merely hide the UI component" (§4, and the project's existing hard rule).

So: add `weight_final_result(p_challenge_id uuid) returns table(winner_user_id uuid, winner_display_name text, winner_percentage_change numeric, disclosed boolean)` to §2 as `weight_final_result` — `security invoker`, returns `null` for `winner_user_id`/`winner_display_name`/`winner_percentage_change` when `disclosed_at is null` and the caller is neither the winner nor an admin, otherwise returns the real values. This keeps the actual withholding logic in exactly one server-side place, never the client.

---

## 4. Hide-my-weight — enforcement is centralized, not per-consumer

Default is public (`is_weight_hidden default false`). The RLS policies in §3 are the single enforcement point: every reader of `weight_profiles`/`weight_entries` — the public ranking, a participant's own view of someone else, an admin view — goes through the *same* two policies. There is no second, separate "hide from the ranking" mechanism to keep in sync; `weight_public_ranking` (§2.8) is `security invoker` specifically so it cannot accidentally bypass these policies the way a `security definer` function could if written carelessly.

**Retroactive**: because visibility is computed live from the current `is_weight_hidden` value on every read (never a snapshot, never a "as of the time it was posted" flag), flipping it immediately changes what every subsequent query returns — there is nothing to "re-hide," and turning it back off makes the same historical rows visible again automatically, since the rows themselves were never deleted or altered.

**The owner always sees their own data**: `user_id = auth.uid()` is the first clause in both SELECT policies — always true regardless of `is_weight_hidden`.

**Admins always see it**: `is_admin()` is the second clause in both.

**Game Master's internal access** is not via these RLS policies at all — Game Master's context-assembly runs as the definer of its own SECURITY DEFINER functions (bypassing RLS, exactly like `_game_master_candidates` already does for core challenge data today) and is expected to read `weight_profiles`/`weight_entries` regardless of `is_weight_hidden`. The privacy guarantee for Game Master is enforced entirely on the **output** side (never on the read side) — see `2026-09-05-game-master-context-chat-weight-design.md` §5, not here.

---

## 5. Failure behavior

- `set_start_weight` after the lock: a specific, distinct error ("Din startvikt är låst — be en administratör rätta den om det behövs.") — never a generic failure, since this is an expected, common path (a participant simply waiting past 24h).
- `log_weight_entry` never accepts a date, so there is no "backdating rejected" error surface to design — the RPC is simply incapable of writing any date but today.
- A failed weight write never touches training data — no shared table, no shared trigger, no shared RPC with the training path.
- Weight UI failures (fetch/mutation) render inline within the Profile weight section only — never replace the whole `ProfilePage`.

## 6. UI behavior

### 6.1 Start weight
New card under `src/pages/ProfilePage.tsx` (a sibling of the existing `LiabilityCard`/`MyChallengesCard`/`PersonalCalendar` composition already there), e.g. `src/features/weight/StartWeightCard.tsx`: shows the current value, an editable field while `now() < start_weight_locked_at`, a read-only "låst" state with the locked value afterward, and a visible relative countdown ("låses om Xh") during the open window.

### 6.2 Regular logging
`src/features/weight/WeightLogCard.tsx`: today's value (editable in place all day), a simple history list/chart below it. No proof upload UI of any kind — explicitly not reusing `ProofImagePicker`.

### 6.3 Hide toggle
A single switch in the same area (reuses the `role="switch"` pattern already established in `GameMasterSettingsPanel.tsx`'s `Toggle` component rather than inventing a new control), labelled plainly ("Dölj min vikt") with a one-line explanation of scope (matches every field listed in the brief).

### 6.4 Public ranking
`src/features/weight/WeightRankingPage.tsx` or a card on an existing page (exact placement is an implementation decision, not fixed here) — lists only rows `weight_public_ranking` returns; a hidden participant simply never appears, with no placeholder row (unlike chat's moderation placeholder — there is no "someone is hidden here" row in the ranking, they are absent entirely, matching "hidden data is unavailable... at the data access level," not merely masked).

### 6.5 Official final / winner disclosure
Admin-only UI (new card in the admin area, e.g. under a new `src/pages/admin/WeightFinalPage.tsx` or folded into an existing challenge-detail admin page — exact placement is an implementation decision) to call `set_official_final_weight` per participant, `finalize_weight_competition`, and `disclose_weight_winner`. The participant-facing result (via `weight_final_result`, §3) shows the winner's name + percentage once disclosed, and nothing else about them beyond what their own `is_weight_hidden` setting already permits.

---

## 7. Public live ranking — formula and eligibility (restated precisely)

```
percentage_change = (latest_weight_kg - start_weight_kg) / start_weight_kg * 100
```
More negative = more weight lost. Uses `weight_entries`'s **latest row by `entry_date`** regardless of how old it is (no "must be recent" requirement) — the participant's most recent registered value remains their ranking value until they log a new one. Eligibility for the **live public ranking** (§2.8): `start_weight_locked_at is not null` (a valid locked start weight — corrected or not, doesn't matter, just present and no longer editable) AND at least one `weight_entries` row exists AND `not is_weight_hidden`. This is distinct from the **official final result** (§2.6), which uses `official_final_weight_kg` instead of the latest regular entry and does **not** exclude hidden participants (only the *disclosure* of a hidden winner is separately gated, §2.7/§3).

---

## 8. Isolation guarantees

- No FK from `weight_profiles`/`weight_entries`/`weight_competition_results` to any core table other than `challenges(id)`/`profiles(id)` (the same two tables every other domain in this app references) — none to `training_entries`, `challenge_memberships`' rules, `earned_penalties`, or Game Master tables.
- No trigger on any core table references weight tracking.
- A weight-tracking failure cannot affect training logging, day states, streaks, liability/KASSAN, ranking (the *training* ranking — `challenge_results`/`RankingPage`, untouched and unrelated to `weight_public_ranking`), Straffbanken, or retroactive registration.
- The training log flow (`LogPage`, `submit-training.ts`) has zero references to weight — verified as a requirement to hold, not just a starting assumption, in pgTAP/Vitest coverage below.

## 9. Existing files likely to change

- `src/pages/ProfilePage.tsx` — mount the new weight cards/toggle in the existing composition
- `src/types/database.ts` — regenerated after migration (existing rollout step)
- Possibly `src/pages/admin/AdminPage.tsx` — one new tile linking to the final-weigh-in admin screen, mirroring the existing `EfterregTile`/Game-Master tile pattern exactly

## 10. New files likely to be created

- `supabase/migrations/<ts>_weight_schema.sql` — the three tables, RLS, indexes, `audit_log_entity_type_valid` widened with `'weight_profile'`
- `supabase/migrations/<ts>_weight_rpcs.sql` — §2's RPCs
- `supabase/tests/00XX_weight_schema_rls.test.sql`
- `supabase/tests/00XX_weight_start_lock_and_entries.test.sql`
- `supabase/tests/00XX_weight_privacy_and_ranking.test.sql`
- `supabase/tests/00XX_weight_official_final_and_disclosure.test.sql`
- `src/features/weight/{weight-api,useWeight,StartWeightCard,WeightLogCard,WeightRankingPage}.{ts,tsx}` + tests
- `src/pages/admin/WeightFinalPage.tsx` (or equivalent — see §6.5) + `.module.css`
- `src/features/admin/weight-admin-api.ts`

## 11. Migrations conceptually needed (this spec only)

1. `weight_schema` — three tables, RLS, indexes, audit-vocab widening.
2. `weight_rpcs` — every RPC in §2, including `weight_final_result`.

---

## 12. pgTAP coverage

- Schema: `weight_profiles_start_weight_coherent` and `weight_profiles_official_final_coherent` reject incoherent rows; `weight_entries_unique_day` rejects a second row for the same `(challenge_id, user_id, entry_date)`.
- `set_start_weight`: first save sets both timestamps; a second call inside the 24h window changes the value without moving either timestamp; a call after the 24h boundary is rejected; the participant cannot ever change `start_weight_first_saved_at`/`start_weight_locked_at` through any code path.
- `correct_start_weight`: admin-only; changes `start_weight_kg` after lock; leaves `start_weight_first_saved_at`/`start_weight_locked_at` byte-identical before/after; writes exactly one audit row with the correct before/after values and no other side effect (no change to any `weight_entries` row, no change to any training/streak/liability value — an explicit cross-domain isolation assertion, not just a same-table one).
- `log_weight_entry`: always writes to `challenge_current_date`; a second call the same day updates in place (one row, not two); calling on a later challenge-local day creates a new row and leaves yesterday's untouched and immutable (no update path can reach a non-today row — assert by trying and expecting either a no-op or a rejection).
- `set_weight_hidden`: works with no prior `weight_profiles` row (creates one, every other column null); toggling twice restores original visibility with all historical rows intact (nothing was deleted in between).
- RLS: a co-member cannot see a hidden participant's `weight_profiles` or `weight_entries` rows at all (not just masked — absent from the result set); the owner and an admin always can; turning hiding off makes prior rows visible to co-members again without any data migration.
- `weight_public_ranking`: excludes a hidden participant entirely; excludes a participant with no locked start weight; excludes a participant with zero entries; uses the latest entry regardless of its age; percentage formula matches §7 exactly for a known fixture (e.g. 82.0 → 78.7 ≈ −4.02%).
- `finalize_weight_competition`: includes a hidden participant in the winner computation (assert a hidden participant CAN be computed as the winner); re-running after a `correct_start_weight`/`set_official_final_weight` change updates the stored winner.
- `disclose_weight_winner`: before disclosure, `weight_final_result` returns null winner fields to an ordinary co-member for a hidden winner; after disclosure, it returns `winner_user_id`/`winner_percentage_change` but the co-member still cannot read the winner's `start_weight_kg`/`official_final_weight_kg`/history via `weight_profiles`/`weight_entries` (still hidden) — the two are proven independent in the same test.
- Isolation: a `training_entries` insert/read and `challenge_results()` output are byte-identical before/after every weight RPC in this spec runs (mirrors the Game Master isolation-proof pattern in `supabase/tests/0017_game_master_rls_audit_cron.test.sql`).

## 13. Vitest coverage

- `weight-api.test.ts`: each RPC call sends exactly the documented parameters (no extra client-supplied fields — e.g. `log_weight_entry` never sends a date); a lock-window rejection surfaces a distinct, translated error.
- `useWeight.test.ts`: the 24h countdown display recomputes correctly from `start_weight_locked_at` using fixed fake time, not wall-clock reads at render time.
- `StartWeightCard.test.tsx`: editable before lock, read-only after; shows the correct locked/unlocked state from fixture data without querying the network to determine it (derived purely from the already-fetched `start_weight_locked_at`).
- `WeightLogCard.test.tsx`: never renders a date picker or any date input — the UI structurally cannot request a backdated entry.
- `WeightRankingPage.test.tsx`: a hidden participant's row never renders, even when present in a raw (test-only, mocked) fixture that intentionally includes one — proving the UI trusts the server's filtered result and does not need to separately suppress it (there is nothing to suppress, because a correctly-filtered API response never contains it — the test's job is to prove the component doesn't accidentally reintroduce a hidden row from some other source, e.g. a cached "all participants" list).
- Smoke: `pages.smoke.test.tsx`-style coverage that `ProfilePage` still renders fully when weight data fails to load.

## 14. Rollout dependencies

- Fully independent — buildable, testable, and mergeable with zero dependency on the Chat or Game Master specs.
- The Game Master spec depends on this one for its weight-aware candidates and the hidden-weight output-safety backstop; this spec's migrations must exist first.

## 15. Cross-spec interfaces (explicit)

- **To Game Master spec:** `weight_profiles(challenge_id, user_id, start_weight_kg, official_final_weight_kg, is_weight_hidden, ...)` and `weight_entries(challenge_id, user_id, entry_date, weight_kg)` are the read surface Game Master's context layer consumes (Game Master spec §2). Game Master never writes to any table in this spec.
- **To Chat spec:** none. Weight tracking does not interact with chat.

---

## 16. Non-goals / explicitly out of scope for v1

Weight photos/proof, unit conversion (lb), backdated corrections by the participant, per-entry hide flags (only the whole-participant toggle exists), any automatic public announcement of the winner (disclosure is always an explicit admin action, §2.7), tiered admin roles for who may set the official final weight (both existing admins have identical authority, per the current single-admin-role model).
