# Weight Tracking / Viktkampen Implementation Plan

> **For agentic workers:** Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship start weight (participant-set, 24h-locked, admin-correctable), optional daily weight logging, a centralized hide-my-weight privacy model enforced at the RLS layer, a public live ranking, and an admin-only official final weigh-in with a narrow winner-disclosure mechanism — fully independent of Shared Chat and Game Master.

**Spec:** `docs/superpowers/specs/2026-09-05-weight-tracking-design.md` (authoritative for every schema/RPC/column name — this plan sequences construction, it does not redefine anything).

**Architecture:** Three new tables (`weight_profiles`, `weight_entries`, `weight_competition_results`), seven SECURITY DEFINER RPCs, two SECURITY INVOKER read-model functions (`weight_public_ranking`, `weight_final_result`), RLS-only reads with a three-way (owner / admin / not-hidden-and-member) policy shape, and a Profile-page UI.

**Tech stack:** React 19 + TypeScript + Vite, TanStack Query, Supabase Postgres 17 / RLS / RPC, Vitest + Testing Library, pgTAP, existing UI primitives (`Card`, `Toggle`-shaped switch from `GameMasterSettingsPanel`, `StatTile`).

## Global constraints

- Weight tracking never modifies `src/features/challenge/submit-training.ts`, `LogPage.tsx`, or any training-flow file — zero coupling to training logging, enforced by review, not just by convention.
- No weight proof image, no `training_proofs`-style bucket, no `ProofImagePicker` reuse.
- `log_weight_entry` never accepts a date parameter — backdating is structurally impossible, not merely rejected by a check.
- `start_weight_first_saved_at`/`start_weight_locked_at` are set exactly once, by `set_start_weight`'s first call, and are never written by any other RPC (including `correct_start_weight`) for the rest of the row's life.
- RLS is the only enforcement point for hide-my-weight — no read model may be `SECURITY DEFINER` in a way that bypasses it (`weight_public_ranking`/`weight_final_result` are `SECURITY INVOKER`, per spec §2.8/§3).
- Full local gates before every `src/`-touching commit: `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`, `npm run format:check`.
- Full migration chain + pgTAP must pass in GitHub Actions before this plan's final task is done.
- Do not `supabase db push`, merge, or deploy — gated by explicit approval (§ Rollout).
- Branch: `feat/weight-tracking`, created from `main` only after Shared Chat has merged (per the approved rollout order) — or, if built in parallel for review purposes, rebased onto `main` post-chat-merge before its own merge, since both must land before Plan 3.

---

## File map

### Database
- Create: `supabase/migrations/20260905150000_weight_schema.sql`
- Create: `supabase/migrations/20260905150100_weight_rpcs.sql`
- Create: `supabase/tests/0021_weight_schema_rls.test.sql`
- Create: `supabase/tests/0022_weight_start_lock_and_entries.test.sql`
- Create: `supabase/tests/0023_weight_privacy_and_ranking.test.sql`
- Create: `supabase/tests/0024_weight_official_final_and_disclosure.test.sql`

### Domain / frontend
- Create: `src/features/weight/types.ts`
- Create: `src/features/weight/weight.ts` (pure helpers: percentage formula, lock-window check)
- Create: `src/features/weight/weight.test.ts`
- Create: `src/features/weight/weight-api.ts`
- Create: `src/features/weight/weight-api.test.ts`
- Create: `src/features/weight/useWeight.ts`
- Create: `src/features/weight/useWeight.test.ts`
- Create: `src/features/weight/StartWeightCard.tsx`, `.module.css`, `.test.tsx`
- Create: `src/features/weight/WeightLogCard.tsx`, `.module.css`, `.test.tsx`
- Create: `src/features/weight/WeightPrivacyToggle.tsx`, `.test.tsx`
- Create: `src/pages/WeightRankingPage.tsx`, `.module.css`
- Create: `src/features/weight/WeightRankingList.tsx`, `.module.css`, `.test.tsx`

### Admin
- Create: `src/features/admin/weight-admin-api.ts`
- Create: `src/pages/admin/WeightFinalPage.tsx`, `.module.css`
- Create: `src/features/admin/WeightFinalPanel.tsx`, `.test.tsx`

### Integration
- Modify: `src/pages/ProfilePage.tsx`
- Modify: `src/pages/AdminPage.tsx`
- Modify: `src/app/AppRoutes.tsx`
- Modify: `src/pages/pages.smoke.test.tsx`
- Modify: `src/types/database.ts` (regenerated at rollout, not this plan)

### Docs
- Create: `docs/WEIGHT_TRACKING.md`

---

## Task 1: Pure domain types and helpers

**Files:**
- Create: `src/features/weight/types.ts`
- Create: `src/features/weight/weight.ts`
- Create: `src/features/weight/weight.test.ts`

**Interfaces produced:**
```ts
export interface WeightProfile {
  challengeId: string;
  userId: string;
  startWeightKg: number | null;
  startWeightFirstSavedAt: string | null;
  startWeightLockedAt: string | null;
  isWeightHidden: boolean;
  officialFinalWeightKg: number | null;
  officialFinalRecordedAt: string | null;
}
export interface WeightEntry {
  id: string; challengeId: string; userId: string;
  entryDate: string; weightKg: number;
}

export function percentageChange(startKg: number, latestKg: number): number; // (latest-start)/start*100
export function isStartWeightLocked(lockedAt: string | null, nowIso: string): boolean; // lockedAt !== null && nowIso >= lockedAt
export function hoursUntilLock(lockedAt: string, nowIso: string): number; // for the countdown display, clamped to >= 0
```

- [ ] **Step 1: Write failing pure-domain tests**

```ts
import { describe, expect, it } from 'vitest';
import { hoursUntilLock, isStartWeightLocked, percentageChange } from './weight';

describe('percentageChange', () => {
  it('matches the spec example: 82.0 -> 78.7 is approximately -4.02%', () => {
    expect(percentageChange(82.0, 78.7)).toBeCloseTo(-4.02, 1);
  });
  it('is positive for a weight gain', () => {
    expect(percentageChange(80, 84)).toBeCloseTo(5, 4);
  });
});

describe('isStartWeightLocked', () => {
  it('is false before lockedAt', () => {
    expect(isStartWeightLocked('2026-09-06T12:00:00Z', '2026-09-06T11:59:59Z')).toBe(false);
  });
  it('is true exactly at and after lockedAt', () => {
    expect(isStartWeightLocked('2026-09-06T12:00:00Z', '2026-09-06T12:00:00Z')).toBe(true);
    expect(isStartWeightLocked('2026-09-06T12:00:00Z', '2026-09-06T12:00:01Z')).toBe(true);
  });
  it('is false when no start weight has been set yet', () => {
    expect(isStartWeightLocked(null, '2026-09-06T12:00:00Z')).toBe(false);
  });
});

describe('hoursUntilLock', () => {
  it('counts down from 24 toward 0', () => {
    expect(hoursUntilLock('2026-09-06T12:00:00Z', '2026-09-05T18:00:00Z')).toBeCloseTo(18, 1);
  });
  it('never goes negative once locked', () => {
    expect(hoursUntilLock('2026-09-06T12:00:00Z', '2026-09-07T00:00:00Z')).toBe(0);
  });
});
```

- [ ] **Step 2: Run and confirm failure**
```bash
npm run test -- src/features/weight/weight.test.ts
```

- [ ] **Step 3: Implement** `types.ts` and `weight.ts` exactly per the interfaces above.

- [ ] **Step 4: Run and confirm pass**
```bash
npm run test -- src/features/weight/weight.test.ts
```

- [ ] **Step 5: Commit**
```bash
git add src/features/weight/types.ts src/features/weight/weight.ts src/features/weight/weight.test.ts
git commit -m "feat(weight): add pure weight domain types and helpers"
```

---

## Task 2: Weight schema + RLS

**Files:**
- Create: `supabase/migrations/20260905150000_weight_schema.sql`
- Create: `supabase/tests/0021_weight_schema_rls.test.sql`

**Interfaces produced:** tables `weight_profiles`, `weight_entries`, `weight_competition_results` exactly per spec §1.1–§1.3; RLS per spec §3. No RPCs yet — schema/RLS ships as its own reviewable unit, matching Chat Plan Task 2 and GM1 Task 2's precedent.

- [ ] **Step 1: Write failing pgTAP**

- `weight_profiles_start_weight_coherent`: reject a row with `start_weight_kg` set but `start_weight_first_saved_at` null (and every other null/non-null combination that isn't all-three-null or all-three-set).
- `weight_profiles_official_final_coherent`: same shape for the three official-final columns.
- `weight_entries_unique_day`: a second insert for the same `(challenge_id, user_id, entry_date)` throws.
- `weight_competition_results_disclosure_coherent`: `disclosed_at` set without `disclosed_by` (or vice versa) throws.
- `audit_log_entity_type_valid` now accepts `'weight_profile'`.
- RLS `weight_profiles_select`/`weight_entries_select`: a hidden participant's rows are **absent** (not present-but-masked) from a co-member's query result set; the owner and an admin always see them; a **non-hidden** participant's rows are visible to a co-member.
- RLS `weight_competition_results_select`: any challenge member (not just admin) can see that a row exists (per spec §3's explicit design note — the row itself isn't hidden, only specific field disclosure is gated at the read-model layer, which doesn't exist until Task 6).
- Direct-write rejection: no role can `insert`/`update`/`delete` any of the three tables directly.

- [ ] **Step 2: Push, run, confirm failure**
```bash
git push -u origin feat/weight-tracking
gh workflow run database-tests.yml --ref feat/weight-tracking
```

- [ ] **Step 3: Implement** the migration exactly per spec §1.1–§1.3, §3.

- [ ] **Step 4: Re-run CI to green** (all of `0001`–`0020` plus `0021`).

- [ ] **Step 5: Commit**
```bash
git add supabase/migrations/20260905150000_weight_schema.sql supabase/tests/0021_weight_schema_rls.test.sql
git commit -m "feat(weight): add weight_profiles/weight_entries/weight_competition_results schema and RLS"
```

---

## Task 3: `set_start_weight` and `correct_start_weight`

**Files:**
- Create: `supabase/migrations/20260905150100_weight_rpcs.sql`
- Create: `supabase/tests/0022_weight_start_lock_and_entries.test.sql`

**Interfaces produced:**
```sql
public.set_start_weight(p_challenge_id uuid, p_weight_kg numeric) returns public.weight_profiles
public.correct_start_weight(p_challenge_id uuid, p_user_id uuid, p_weight_kg numeric, p_reason text) returns void
```
Exact bodies per spec §2.1/§2.2.

- [ ] **Step 1: Write failing pgTAP**

This is the highest-value correctness surface in the whole plan — test it exhaustively:
- First call sets `start_weight_kg`, `start_weight_first_saved_at = now()`, `start_weight_locked_at = now() + 24h` (assert the 24h delta exactly, e.g. `extract(epoch from (locked_at - first_saved_at)) = 86400`).
- A second call **within** the 24h window changes `start_weight_kg` but leaves `start_weight_first_saved_at`/`start_weight_locked_at` byte-identical to their first-call values (capture both before and after, compare directly).
- A third call **after** `now() >= start_weight_locked_at` (construct this by inserting a `weight_profiles` row directly with a `start_weight_locked_at` in the past, then calling the RPC) throws, and leaves `start_weight_kg` unchanged.
- Non-member calling `set_start_weight` throws.
- `correct_start_weight` by a non-admin throws.
- `correct_start_weight` with an empty reason throws.
- `correct_start_weight` after the participant's lock changes `start_weight_kg` and leaves `start_weight_first_saved_at`/`start_weight_locked_at` untouched — the exact case the spec calls out as easy to get wrong.
- `correct_start_weight` writes exactly one `audit_log` row: `entity_type='weight_profile'`, `action='start_weight_corrected'`, `before_data`/`after_data` containing the old/new `start_weight_kg`, `note` = reason.
- `correct_start_weight` on a participant with **no** existing `weight_profiles` row succeeds (upserts one) — admin can set a start weight from nothing.

- [ ] **Step 2: Push, run, confirm failure**

- [ ] **Step 3: Implement**

- [ ] **Step 4: Re-run CI to green**

- [ ] **Step 5: Commit**
```bash
git add supabase/migrations/20260905150100_weight_rpcs.sql supabase/tests/0022_weight_start_lock_and_entries.test.sql
git commit -m "feat(weight): add set_start_weight and correct_start_weight"
```

---

## Task 4: `log_weight_entry`

**Files:**
- Modify: `supabase/migrations/20260905150100_weight_rpcs.sql`
- Modify: `supabase/tests/0022_weight_start_lock_and_entries.test.sql`

**Interfaces produced:**
```sql
public.log_weight_entry(p_challenge_id uuid, p_weight_kg numeric) returns public.weight_entries
```
Exact body per spec §2.3 — no date parameter exists at all.

**Interfaces consumed:** `public.challenge_current_date(uuid)` (existing).

- [ ] **Step 1: Write failing pgTAP**

- First call for "today" (using the fixture challenge's real current date via `challenge_current_date`) inserts a row with `entry_date = challenge_current_date(challenge_id)`.
- A second call the same day **updates** the existing row (`weight_kg` changes, `id` and `entry_date` unchanged, only one row exists for that day) rather than inserting a second one.
- Assert the function's argument list is exactly `p_challenge_id uuid, p_weight_kg numeric` via `pg_get_function_arguments` — proving no date parameter exists to backdate through.
- A row inserted directly (as `postgres`, simulating "yesterday's entry") cannot be reached or altered by any call to `log_weight_entry` — call it once "today" and assert yesterday's fixture row is byte-identical before/after.
- Non-member throws.

- [ ] **Step 2: Push, run, confirm failure**

- [ ] **Step 3: Implement**

- [ ] **Step 4: Re-run CI to green**

- [ ] **Step 5: Commit**
```bash
git add supabase/migrations/20260905150100_weight_rpcs.sql supabase/tests/0022_weight_start_lock_and_entries.test.sql
git commit -m "feat(weight): add log_weight_entry (challenge-day-only, no backdating)"
```

---

## Task 5: `set_weight_hidden` and `weight_public_ranking`

**Files:**
- Modify: `supabase/migrations/20260905150100_weight_rpcs.sql`
- Create: `supabase/tests/0023_weight_privacy_and_ranking.test.sql`

**Interfaces produced:**
```sql
public.set_weight_hidden(p_challenge_id uuid, p_hidden boolean) returns void
public.weight_public_ranking(p_challenge_id uuid) returns table (
  user_id uuid, display_name text, start_weight_kg numeric,
  latest_weight_kg numeric, latest_entry_date date,
  kg_change numeric, percentage_change numeric
)
```
Exact bodies per spec §2.4/§2.8 — `weight_public_ranking` is `security invoker`.

- [ ] **Step 1: Write failing pgTAP**

- `set_weight_hidden(true)` on a participant with **no** prior `weight_profiles` row creates one with every other column null — the exact "must work before start weight exists" requirement.
- Toggling `true` then `false` restores visibility of prior `weight_entries` rows to a co-member with no data migration (insert entries while hidden, toggle off, assert a co-member can now see them, with identical values to what was inserted).
- `weight_public_ranking` excludes: a hidden participant entirely; a participant with `start_weight_locked_at is null`; a participant with zero `weight_entries` rows.
- `weight_public_ranking` includes a valid participant with the exact formula from spec §7 (fixture: start 82.0, latest 78.7, assert `percentage_change` ≈ −4.02).
- `weight_public_ranking` uses the **latest by `entry_date`** row regardless of age — fixture with an entry from 30 days ago and no others still appears with that value.
- Call `weight_public_ranking` **as** a hidden participant's co-member and assert the hidden participant's row is absent from the returned set (not just excluded by a `where not is_weight_hidden` the function forgot — this is enforced by RLS since the function is `security invoker`, so this test is really proving that invoker-security choice holds, not re-testing Task 2's RLS).

- [ ] **Step 2: Push, run, confirm failure**

- [ ] **Step 3: Implement**

- [ ] **Step 4: Re-run CI to green**

- [ ] **Step 5: Commit**
```bash
git add supabase/migrations/20260905150100_weight_rpcs.sql supabase/tests/0023_weight_privacy_and_ranking.test.sql
git commit -m "feat(weight): add set_weight_hidden and weight_public_ranking"
```

---

## Task 6: Official final weigh-in and winner disclosure

**Files:**
- Modify: `supabase/migrations/20260905150100_weight_rpcs.sql`
- Create: `supabase/tests/0024_weight_official_final_and_disclosure.test.sql`

**Interfaces produced:**
```sql
public.set_official_final_weight(p_challenge_id uuid, p_user_id uuid, p_weight_kg numeric, p_reason text) returns void
public.finalize_weight_competition(p_challenge_id uuid) returns public.weight_competition_results
public.disclose_weight_winner(p_challenge_id uuid) returns void
public.weight_final_result(p_challenge_id uuid) returns table (
  winner_user_id uuid, winner_display_name text, winner_percentage_change numeric, disclosed boolean
)
```
Exact bodies per spec §2.5–§2.7 and §3's `weight_final_result` addition. `weight_final_result` is `security invoker`.

This is the most product-sensitive surface in this plan — write every pgTAP case below, do not summarize or skip any.

- [ ] **Step 1: Write failing pgTAP**

- `set_official_final_weight` by a non-admin throws; empty reason throws; writes exactly one audit row (`entity_type='weight_profile'`, `action='official_final_weight_set'`) every call, including the first (no first-time/correction branch to accidentally under-audit).
- `finalize_weight_competition` computes the correct winner (most negative `percentage_change`) across a 3-participant fixture where one participant has `is_weight_hidden=true` — **assert the hidden participant can be the computed winner** (this is the single most important assertion in this task: eligibility for the real competition must never consult `is_weight_hidden`).
- `finalize_weight_competition` excludes a participant missing either `start_weight_kg` or `official_final_weight_kg` from winner consideration.
- Re-running `finalize_weight_competition` after `correct_start_weight`/`set_official_final_weight` changes the underlying numbers updates the stored winner (upsert, not insert-only).
- `disclose_weight_winner` before `finalize_weight_competition` has ever run throws (no row to disclose).
- `disclose_weight_winner` is idempotent (call twice, no error, `disclosed_at`/`disclosed_by` set from the first call, unchanged by the second — or updated, whichever the implementation chooses; assert whichever is implemented is stable, i.e. a third call produces the same observable state as the second).
- **Before disclosure**, `weight_final_result` called by an ordinary co-member of a **hidden** winner returns `winner_user_id`/`winner_display_name`/`winner_percentage_change` all `null`, `disclosed=false`.
- **After disclosure**, the same call returns the real `winner_user_id`/`winner_display_name`/`winner_percentage_change`, `disclosed=true`.
- **In both cases**, that same co-member's direct `select` on `weight_profiles`/`weight_entries` for the winner still returns **zero rows** (RLS unaffected by disclosure — the two mechanisms are proven independent in the same test, per spec §3's explicit design note).
- A **non-hidden** winner's result is visible via `weight_final_result` regardless of `disclosed_at` (disclosure only matters for a hidden subject) — assert `weight_final_result` returns real values immediately after `finalize_weight_competition` for a non-hidden winner, with no `disclose_weight_winner` call needed.
- The winner's own call to `weight_final_result` (or direct table access) always sees their own real data regardless of hiding or disclosure — owner-sees-own-data is unconditional.
- An admin sees the real winner data via `weight_final_result` at any time, disclosed or not.

- [ ] **Step 2: Push, run, confirm failure**

- [ ] **Step 3: Implement**

- [ ] **Step 4: Re-run CI to green.** This is the task most likely to need iteration — budget for at least one CI round-trip fixing an edge case, consistent with this project's actual history on every non-trivial RLS/RPC task so far.

- [ ] **Step 5: Commit**
```bash
git add supabase/migrations/20260905150100_weight_rpcs.sql supabase/tests/0024_weight_official_final_and_disclosure.test.sql
git commit -m "feat(weight): add official final weigh-in, competition finalize and winner disclosure"
```

---

## Task 7: Typed API layer

**Files:**
- Create: `src/features/weight/weight-api.ts`
- Create: `src/features/weight/weight-api.test.ts`

**Interfaces produced:**
```ts
export class WeightError extends Error {}
export async function setStartWeight(challengeId: string, weightKg: number): Promise<WeightProfile>;
export async function logWeightEntry(challengeId: string, weightKg: number): Promise<WeightEntry>;
export async function setWeightHidden(challengeId: string, hidden: boolean): Promise<void>;
export async function fetchMyWeightProfile(challengeId: string, userId: string): Promise<WeightProfile | null>;
export async function fetchMyWeightEntries(challengeId: string, userId: string): Promise<WeightEntry[]>;
export async function fetchWeightPublicRanking(challengeId: string): Promise<WeightRankingRow[]>;
export async function fetchWeightFinalResult(challengeId: string): Promise<WeightFinalResult>;
```

Same untyped-boundary pattern as `game-master-api.ts` (`as unknown as SupabaseClient`).

- [ ] **Step 1: Write failing tests**

- Each RPC call sends exactly the documented parameter set — in particular, assert `logWeightEntry` **never** sends anything date-shaped (no `entryDate`/`date` key in the call payload, proving the client cannot even attempt to backdate through this adapter).
- `setStartWeight` on a lock rejection surfaces a `WeightError` with the server's message passed through, not swallowed or replaced.
- `fetchWeightPublicRanking` calls the RPC (not a raw table select) and maps every returned field.
- A transport failure from any function rejects with `WeightError`.

- [ ] **Step 2: Run, confirm failure**
```bash
npm run test -- src/features/weight/weight-api.test.ts
```

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run, confirm pass**

- [ ] **Step 5: Commit**
```bash
git add src/features/weight/weight-api.ts src/features/weight/weight-api.test.ts
git commit -m "feat(weight): add typed weight API adapter"
```

---

## Task 8: `useWeight` hooks

**Files:**
- Create: `src/features/weight/useWeight.ts`
- Create: `src/features/weight/useWeight.test.ts`

**Interfaces produced:**
```ts
export const weightKeys = {
  profile: (challengeId: string, userId: string) => ['weight', 'profile', challengeId, userId] as const,
  entries: (challengeId: string, userId: string) => ['weight', 'entries', challengeId, userId] as const,
  ranking: (challengeId: string) => ['weight', 'ranking', challengeId] as const,
  final: (challengeId: string) => ['weight', 'final', challengeId] as const,
};
export function useMyWeightProfile(challengeId, userId);
export function useMyWeightEntries(challengeId, userId);
export function useWeightPublicRanking(challengeId);
export function useWeightFinalResult(challengeId);
export function useSetStartWeight();
export function useLogWeightEntry();
export function useSetWeightHidden();
```

- [ ] **Step 1: Write failing tests**

- `useSetStartWeight`'s mutation invalidates `weightKeys.profile` on success.
- `useSetWeightHidden`'s mutation invalidates both `weightKeys.profile` and `weightKeys.ranking` (a privacy change must refresh the ranking view for the toggling user's own next read, since they may now appear/disappear from it).
- `useLogWeightEntry` invalidates `weightKeys.entries` and `weightKeys.ranking`.
- Each query has `enabled: false` when `challengeId`/`userId` is null, matching the existing `useChallengeData`/`useGameMaster` convention.

- [ ] **Step 2: Run, confirm failure**
```bash
npm run test -- src/features/weight/useWeight.test.ts
```

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run, confirm pass**

- [ ] **Step 5: Commit**
```bash
git add src/features/weight/useWeight.ts src/features/weight/useWeight.test.ts
git commit -m "feat(weight): add useWeight TanStack Query hooks"
```

---

## Task 9: `StartWeightCard`, `WeightLogCard`, `WeightPrivacyToggle`

**Files:**
- Create: `src/features/weight/StartWeightCard.tsx`, `.module.css`, `.test.tsx`
- Create: `src/features/weight/WeightLogCard.tsx`, `.module.css`, `.test.tsx`
- Create: `src/features/weight/WeightPrivacyToggle.tsx`, `.test.tsx`

- [ ] **Step 1: Write failing component tests**

`StartWeightCard.test.tsx`:
- Before any start weight exists: shows an input + save action, no lock/countdown UI.
- After first save, within the 24h window (fixture with `startWeightLockedAt` in the future): input remains editable; a countdown/relative-time string derived from `hoursUntilLock` is shown.
- After the lock (fixture with `startWeightLockedAt` in the past): input is **not** editable (assert no editable field is rendered, or it is `disabled` — pick one and test it precisely), a "låst" state label is shown instead.

`WeightLogCard.test.tsx`:
- Renders today's value editable.
- **Never renders any date-input element** — assert `container.querySelector('input[type="date"]')` is null and no calendar/date-picker component is mounted, proving backdating isn't even offered as a UI affordance.
- Submitting calls `useLogWeightEntry`'s mutation with only a weight value.

`WeightPrivacyToggle.test.tsx`:
- Reuses the `role="switch"` pattern from `GameMasterSettingsPanel`'s `Toggle` (import/compose it if it's exported reusably; otherwise duplicate the minimal markup rather than generalizing `GameMasterSettingsPanel` itself, which is out of scope for this plan) — toggling calls `useSetWeightHidden` with the new boolean.

- [ ] **Step 2: Run, confirm failure**
```bash
npm run test -- src/features/weight/StartWeightCard.test.tsx src/features/weight/WeightLogCard.test.tsx src/features/weight/WeightPrivacyToggle.test.tsx
```

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run, confirm pass + build**

- [ ] **Step 5: Commit**
```bash
git add src/features/weight/StartWeightCard.tsx src/features/weight/StartWeightCard.module.css src/features/weight/StartWeightCard.test.tsx \
        src/features/weight/WeightLogCard.tsx src/features/weight/WeightLogCard.module.css src/features/weight/WeightLogCard.test.tsx \
        src/features/weight/WeightPrivacyToggle.tsx src/features/weight/WeightPrivacyToggle.test.tsx
git commit -m "feat(weight): add StartWeightCard, WeightLogCard and privacy toggle"
```

---

## Task 10: Mount in Profile, smoke coverage

**Files:**
- Modify: `src/pages/ProfilePage.tsx`
- Modify: `src/pages/pages.smoke.test.tsx`

- [ ] **Step 1: Write failing smoke test**

- `ProfilePage` still renders its existing streak/liability content in full when weight data fails to load (mirrors the existing Game-Master isolation-smoke pattern) — a mocked `fetchMyWeightProfile` rejection must not replace the page.
- `ProfilePage` renders the new weight cards from fixture data alongside the existing `LiabilityCard`/`PersonalCalendar` content (assert both are present, not one replacing the other).

- [ ] **Step 2: Run, confirm failure**
```bash
npm run test -- src/pages/pages.smoke.test.tsx
```

- [ ] **Step 3: Implement.** Add the three cards from Task 9 into `ProfilePage.tsx`'s existing composition.

- [ ] **Step 4: Run full suite + build**
```bash
npm run test
npm run build
```

- [ ] **Step 5: Commit**
```bash
git add src/pages/ProfilePage.tsx src/pages/pages.smoke.test.tsx
git commit -m "feat(weight): mount weight cards in ProfilePage"
```

---

## Task 11: Public ranking page

**Files:**
- Create: `src/pages/WeightRankingPage.tsx`, `.module.css`
- Create: `src/features/weight/WeightRankingList.tsx`, `.module.css`, `.test.tsx`
- Modify: `src/app/AppRoutes.tsx`
- Modify: `src/pages/pages.smoke.test.tsx`

**Interfaces produced:** route `/viktkampen` (normal auth, not admin — same pattern as `/arkivet`).

- [ ] **Step 1: Write failing tests**

`WeightRankingList.test.tsx`:
- Renders every field spec §6.4 lists (start/latest/kg change/percentage/dates) for a public fixture row.
- Given a fixture array that (incorrectly, for test purposes) includes a row shaped like a hidden participant, the component still renders exactly what it's given — this test exists to prove the component does **no** client-side filtering of its own (all filtering is server-side per spec §4); name the test explicitly as proving that absence, e.g. "renders every row it receives, trusting the server's filtering entirely."

Smoke: `/viktkampen` renders for an authenticated participant (not gated by `RequireAdmin`).

- [ ] **Step 2: Run, confirm failure**

- [ ] **Step 3: Implement.** No nav-tab entry — reached via a link from `ProfilePage`, mirroring how `/arkivet` is reached from `GroupPage` (a discrete card/link, not a bottom-nav slot).

- [ ] **Step 4: Run, confirm pass + build**

- [ ] **Step 5: Commit**
```bash
git add src/pages/WeightRankingPage.tsx src/pages/WeightRankingPage.module.css \
        src/features/weight/WeightRankingList.tsx src/features/weight/WeightRankingList.module.css src/features/weight/WeightRankingList.test.tsx \
        src/app/AppRoutes.tsx src/pages/pages.smoke.test.tsx
git commit -m "feat(weight): add public weight ranking page"
```

---

## Task 12: Admin — official final weigh-in UI

**Files:**
- Create: `src/features/admin/weight-admin-api.ts`
- Create: `src/pages/admin/WeightFinalPage.tsx`, `.module.css`
- Create: `src/features/admin/WeightFinalPanel.tsx`, `.test.tsx`
- Modify: `src/pages/AdminPage.tsx`
- Modify: `src/app/AppRoutes.tsx`

**Interfaces produced:** route `/admin/viktkampen`, `RequireAdmin`-gated; `weight-admin-api.ts` wraps `set_official_final_weight`/`finalize_weight_competition`/`disclose_weight_winner`.

- [ ] **Step 1: Write failing tests**

`WeightFinalPanel.test.tsx`:
- Per-participant official-final-weight input + save, mandatory-reason `ConfirmSheet` pattern (reusing the same shape as `GameMasterRunLog`'s cancel flow) — confirm disabled until reason typed.
- A "Fastställ vinnare" (finalize) action calls `finalize_weight_competition` and displays the computed winner.
- A "Publicera vinnare" (disclose) action, shown only once a winner has been finalized, calls `disclose_weight_winner`.
- **No** control anywhere in this panel can set `is_weight_hidden` for a participant, view a hidden participant's raw history for any purpose other than the admin's already-existing full-read access, or bypass `finalize_weight_competition`'s own eligibility logic — this is an explicit negative-assertion test, mirroring the "no manual roast" tests in `GameMasterRunLog.test.tsx`/`GameMasterSettingsPanel.test.tsx`.

- [ ] **Step 2: Run, confirm failure**

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run full suite + build**

- [ ] **Step 5: Commit**
```bash
git add src/features/admin/weight-admin-api.ts src/pages/admin/WeightFinalPage.tsx src/pages/admin/WeightFinalPage.module.css \
        src/features/admin/WeightFinalPanel.tsx src/features/admin/WeightFinalPanel.test.tsx \
        src/pages/AdminPage.tsx src/app/AppRoutes.tsx
git commit -m "feat(weight): add admin official final weigh-in and winner disclosure UI"
```

---

## Task 13: Final integration, docs, release gate

**Files:**
- Create: `docs/WEIGHT_TRACKING.md`

- [ ] **Step 1: Document** the 24h-lock model, hide-my-weight enforcement point (RLS, not UI), the official-final/disclosure model precisely (this is the part most likely to be mis-remembered later — write the exact before/after-disclosure visibility matrix from spec §2.7/Task 6 verbatim into the doc).

- [ ] **Step 2: Run every local gate**
```bash
npm run typecheck
npm run lint
npm run test
npm run build
npm run format:check
```

- [ ] **Step 3: Run the real GitHub Actions Database Tests on the branch tip**
```bash
gh workflow run database-tests.yml --ref feat/weight-tracking
```
Require all of `0001`–`0024` pass.

- [ ] **Step 4: Review diff for scope.** Required: no `chat_*`/`game_master_*` table or file touched; `src/features/challenge/submit-training.ts` untouched; no weight proof/image upload path anywhere; `navigation.ts` untouched.

- [ ] **Step 5: Commit**
```bash
git add docs/WEIGHT_TRACKING.md
git commit -m "docs(weight): document lock model, privacy enforcement and final result"
```

- [ ] **Step 6: Report and stop** — branch, HEAD, migrations, table/RPC list, JS test total, pgTAP total (`0021`–`0024`), GitHub Actions result URL, known risks. **Do not merge, db push, or deploy.**

---

## Rollout (recorded for the approver, not executed here)

1. Confirm Cloudflare remains paused.
2. Merge `feat/weight-tracking` → `main` (after Shared Chat has already merged, per the approved order).
3. `npx supabase db push --linked --dry-run` — expect exactly `20260905150000_weight_schema.sql`, `20260905150100_weight_rpcs.sql`.
4. Apply, `npm run db:types`, review the diff (expect only the three weight tables + seven weight RPC signatures added).
5. Full local gates, clean `git status`, commit regenerated types if that's the only diff.
6. Restore Cloudflare's deploy command; retry the latest `main` build.
7. Live smoke test: set a start weight, confirm the 24h countdown, log a daily entry, toggle hide and confirm a second account can no longer see it, confirm KASSAN/streak/ranking/training are unaffected.
8. Rollback consideration: purely additive schema, no altered existing table/function — disabling is a frontend revert (remove the mounted cards/routes) with no database action required.
