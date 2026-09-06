# Hälsoutmaningen — Weight Tracking / Viktkampen

Optional weight tracking layered beside training. It is **completely
independent of training logging**: no proof image, no training dependency, and
it cannot change or affect completed/missed day state, the training
requirement, streaks, debt/liability, KASSAN, the training ranking,
Straffbanken or efterregistrering. Training stays the product — this is one
section under Profile, not a nav destination.

Design source of truth:
[`docs/superpowers/specs/2026-09-05-weight-tracking-design.md`](./superpowers/specs/2026-09-05-weight-tracking-design.md).
Implementation plan:
[`docs/superpowers/plans/2026-09-05-weight-tracking-implementation.md`](./superpowers/plans/2026-09-05-weight-tracking-implementation.md).

Migrations:
[`…20260905150000_weight_schema.sql`](../supabase/migrations/20260905150000_weight_schema.sql),
[`…20260905150100_weight_rpcs.sql`](../supabase/migrations/20260905150100_weight_rpcs.sql).
pgTAP coverage:
[`supabase/tests/0022…0025`](../supabase/tests/) (32 + 30 + 21 + 27 = **110 assertions**).

---

## 1. Tables

| Table                        | Purpose                                                                                                                                                                                                            |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `weight_profiles`            | One row per `(challenge, participant)`: the 24h-locked start weight, the hide flag, the official final weigh-in. May exist with every nullable column null (created to hold `is_weight_hidden` before any weight). |
| `weight_entries`             | Optional daily regular logging. One row per `(challenge, user, entry_date)`.                                                                                                                                       |
| `weight_competition_results` | Singleton per challenge: the official winner + a separate disclosure gate.                                                                                                                                         |

No FK from any of the three to any table other than `challenges(id)` /
`profiles(id)`. No trigger on any core / chat / Game Master table references
weight tracking. `audit_log_entity_type_valid` was widened with
`'weight_profile'`.

---

## 2. Start weight — the 24-hour lock (server-enforced, never a client timer)

`weight_profiles.start_weight_first_saved_at` and `start_weight_locked_at` are
set **exactly once**, together, at the participant's first successful save, and
are **never written again by any RPC** for the rest of the row's life —
including an admin correction.

- **`set_start_weight(p_challenge_id, p_weight_kg)`** (participant, SECURITY
  DEFINER, `search_path=''`): active membership required, `0 < kg ≤ 400`.
  - First save → `start_weight_kg = kg`, `first_saved_at = now()`,
    `locked_at = now() + interval '24 hours'` (exactly 86400 s apart).
  - Inside the window (`now() < locked_at`) → changes `start_weight_kg` only.
    A `for update` lock guards the first-save race.
  - After the window (`now() >= locked_at`) → rejected with a distinct Swedish
    message: _"Din startvikt är låst — be en administratör rätta den om det
    behövs."_
- **`correct_start_weight(p_challenge_id, p_user_id, p_weight_kg, p_reason)`**
  (admin): `is_admin()` (+ no-JWT break-glass), mandatory non-empty reason,
  `0 < kg ≤ 400`. Changes `start_weight_kg` **only** — `first_saved_at` /
  `locked_at` stay byte-identical. On a participant who has no row yet it
  upserts one, seeding the two timestamps to `now()` / `now()+24h` (the only
  path that ever writes them here, and only when there was nothing to
  preserve). Writes exactly one `audit_log` row
  (`entity_type='weight_profile'`, `action='start_weight_corrected'`,
  `before_data`/`after_data` = `{start_weight_kg}`, `note` = reason).

The frontend never decides "is it locked" from a network call — it derives it
purely from the fetched `start_weight_locked_at` (`isStartWeightLocked` /
`hoursUntilLock` in `src/features/weight/weight.ts`).

---

## 3. Regular weight logging — today only, no backdating

**`log_weight_entry(p_challenge_id, p_weight_kg)`** (participant, SECURITY
DEFINER): active membership, `0 < kg ≤ 400`. It has **no date parameter** — the
only date it can write is `challenge_current_date(p_challenge_id)`, so
backdating is _structurally impossible_, not a runtime check. Upsert on
`(challenge_id, user_id, entry_date)`: inserts today's row, edits it in place on
a repeat call the same challenge day; once the challenge day rolls over the old
row is simply unreachable by this RPC. No proof image, no training dependency.
`WeightLogCard` renders no date/month/datetime input of any kind.

---

## 4. Hide my weight — enforced by RLS, not by React

Default is public (`is_weight_hidden default false`). **`set_weight_hidden(
p_challenge_id, p_hidden)`** (participant) upserts the flag; the
`weight_profiles` row is created on the first toggle if nothing else made it,
so the switch works before any start weight exists.

The **single enforcement point** is the SELECT policy shape in the schema
migration — every reader (the public ranking, a co-member view, an admin view)
passes through the _same_ policies:

- `weight_profiles_select`: `user_id = auth.uid()` **or** `is_admin()` **or**
  `(not is_weight_hidden and is_challenge_member(challenge_id))`.
- `weight_entries_select`: same owner/admin clauses **or**
  `is_challenge_member(challenge_id) and not _weight_is_hidden(challenge_id,
user_id)` — a **SECURITY DEFINER** predicate (same shape as
  `is_challenge_member`): an inline `not exists (... weight_profiles ...)`
  subquery here would itself be RLS-filtered by `weight_profiles`' own policy
  and so could not see the hidden row it is meant to detect.

**Retroactive by construction**: visibility is computed live from the current
`is_weight_hidden` on every read — never snapshotted — so flipping it
immediately changes what every subsequent co-member query returns, and flipping
it back makes the same historical rows visible again with no data migration. A
hidden participant's rows are **absent** from a co-member's result set (not
present-but-masked, and no "someone is hidden here" placeholder in the ranking).

`weight_public_ranking` is **SECURITY INVOKER** (mirrors `challenge_results`)
so RLS still applies on top — but hidden-exclusion for the ranking is **not**
left to caller RLS. Eligibility to appear is a **domain rule** that must hold
identically for every caller, participant **or** admin:

1. `start_weight_locked_at is not null` (a valid locked start weight),
2. ≥ 1 `weight_entries` row,
3. `is_weight_hidden = false` — written **explicitly** into the function's
   `where` clause (`and not wp.is_weight_hidden`), not inferred from RLS.

`percentage_change = (latest − start) / start × 100` using the **latest entry
by `entry_date` regardless of age**; rounded to 2 dp for display, ordering uses
full precision, ties broken by `display_name`.

> The public ranking is **never an admin-inspection surface**. An **admin**
> calling `weight_public_ranking` gets exactly the same hidden-free list an
> ordinary participant does — the explicit `not is_weight_hidden` predicate
> guarantees it. Admin oversight of a hidden participant's weight is unchanged:
> it happens through a direct `select` on `weight_profiles` / `weight_entries`
> (the `is_admin()` RLS clause), never by overloading this read model.
> pgTAP `0024` Section C proves both halves — the admin sees 2 rows (not 3),
> and the admin can still read the hidden participant's `start_weight_kg` /
> `weight_kg` directly.

**Game Master's internal access** (future, not built here) is not via these
policies — it runs as the definer of its own SECURITY DEFINER context and reads
`weight_profiles` / `weight_entries` regardless of `is_weight_hidden`; the
privacy guarantee for Game Master is enforced on the _output_ side, in that
spec.

---

## 5. Official final weigh-in & winner disclosure

The finale is 2026-11-28. The **official final weigh-in is separate from daily
entries** — admin-only, audited every call.

- **`set_official_final_weight(p_challenge_id, p_user_id, p_weight_kg,
p_reason)`** (admin): mandatory reason on **every** call (no first-time vs
  correction branch), one `audit_log` row each time
  (`action='official_final_weight_set'`).
- **`finalize_weight_competition(p_challenge_id)`** (admin, SECURITY DEFINER):
  winner = most negative `(official_final − start) / start × 100` across
  **every** participant with **both** weights set. **`is_weight_hidden` is
  never consulted** — a hidden participant is fully eligible to win. A
  participant missing either weight is excluded. Re-runnable (upsert); a re-run
  that **changes** the winner clears any prior disclosure, a re-run with the
  same winner keeps it.
- **`disclose_weight_winner(p_challenge_id)`** (admin): throws before a
  finalize has ever run; idempotent (`coalesce` keeps the first
  `disclosed_at`/`by`). The **only** mechanism that makes a hidden winner's
  name + percentage visible to co-members — completely separate from
  `is_weight_hidden`, and it touches nothing else.
- **`weight_final_result(p_challenge_id)`** (read model, SECURITY INVOKER):
  returns `winner_user_id`, `winner_display_name`, `winner_percentage_change`,
  `disclosed`. It consults `_weight_winner_is_hidden(challenge)` — a
  one-boolean SECURITY DEFINER predicate (same shape as `is_admin()` /
  `is_challenge_member()`), so a co-member who correctly cannot see a hidden
  winner's `weight_profiles` row can still be told whether the winner is
  hidden. It never returns any start / final kg or history.

### Exact visibility matrix — `weight_final_result` (name + percentage only)

| Caller \ winner state | Non-hidden winner |        Hidden winner, **not** disclosed        |  Hidden winner, **disclosed**  |
| --------------------- | :---------------: | :--------------------------------------------: | :----------------------------: |
| Ordinary co-member    |      ✅ real      | ❌ all winner fields `null`, `disclosed=false` | ✅ name + % (`disclosed=true`) |
| The winner themselves |      ✅ real      |                    ✅ real                     |            ✅ real             |
| Admin                 |      ✅ real      |                    ✅ real                     |            ✅ real             |

**Independent of disclosure:** in **every** cell above, an ordinary co-member's
direct `select` on the winner's `weight_profiles` / `weight_entries` still
returns **zero rows** while the winner is hidden. Disclosure reveals the
_result_ (name + %), never the _weights, chart or history_. A hidden
non-winner stays fully hidden after the finale. A hidden participant who **wins
and is disclosed** has their name + final % published — and nothing else.

---

## 6. UI

- `src/features/weight/WeightSection.tsx` under `ProfilePage` (after
  `RetroactiveRequestsCard`): `StartWeightCard` + `WeightLogCard` +
  `WeightPrivacyToggle` + a link to `/viktkampen`. No sixth bottom-nav item.
- `/viktkampen` (`RequireAuth`, not admin) — `WeightRankingPage` +
  `WeightRankingList`. A hidden participant is simply absent; the list does no
  filtering of its own.
- `/admin/viktkampen` (`RequireAdmin`) — `WeightFinalPage` + `WeightFinalPanel`:
  per-participant official-final input via a mandatory-reason `ConfirmSheet`,
  "Fastställ vinnare", then "Publicera vinnare". No `is_weight_hidden` control,
  no hidden-history viewer.

---

## 7. Non-goals (v1)

Weight photos/proof, lb, participant backdated corrections, per-entry hide
flags (only the whole-participant toggle), automatic winner announcement
(disclosure is always an explicit admin action), tiered admin roles for the
official final weight.
