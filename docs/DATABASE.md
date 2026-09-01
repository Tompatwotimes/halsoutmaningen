# Hälsoutmaningen — Database design

Reference for the initial schema. The migrations under `supabase/migrations/`
are the source of truth; this document explains them.

| Migration                                 | Contents                                               |
| ----------------------------------------- | ------------------------------------------------------ |
| `20260901120000_core_schema.sql`          | Tables, constraints, indexes, `updated_at` triggers    |
| `20260901120100_functions_and_rls.sql`    | Helpers, guard triggers, day-state fn, audit, RLS      |
| `20260901120200_storage.sql`              | Private `proofs` / `avatars` buckets + object policies |
| `20260901120300_seed_first_challenge.sql` | **Optional** data: the first challenge as a `draft`    |

Nothing in these migrations drops or alters an existing object — they only
`CREATE` / `INSERT … WHERE NOT EXISTS`. Safe to apply to a database whose
`public` schema is empty.

---

## 1. Entity model

```
auth.users ──1:1──> profiles ──1:N──> challenge_memberships ──N:1──> challenges
                        │                                               │
                        │                                               │
                        └──────1:N──> training_entries <──N:1───────────┘
                                          │  (unique per challenge+user+date)
                                          └──1:1──> training_proofs ──> Storage("proofs")

audit_log  (append-only; holds raw ids, NO foreign keys, survives deletes)
```

## 2. Tables

### `profiles`

| Column                      | Type        | Notes                                           |
| --------------------------- | ----------- | ----------------------------------------------- |
| `id`                        | uuid PK     | = `auth.users.id`, `ON DELETE CASCADE`          |
| `display_name`              | text        | 1–80 chars (trimmed), required                  |
| `avatar_path`               | text        | nullable; Storage path in `avatars` bucket      |
| `role`                      | text        | `participant` \| `admin`, default `participant` |
| `active`                    | boolean     | default `true`                                  |
| `created_at` / `updated_at` | timestamptz | `updated_at` auto-maintained                    |

- Rows are created **only** by the `on_auth_user_created` trigger
  (`handle_new_user`), which reads `display_name` / `full_name` from the invite
  metadata and falls back to the email local-part.
- `role` and `active` can only be changed by an admin or a privileged
  (no-JWT) backend session — enforced by `profiles_guard`.

### `challenges`

| Column             | Type    | Constraint                                       |
| ------------------ | ------- | ------------------------------------------------ |
| `id`               | uuid PK | `gen_random_uuid()`                              |
| `name`             | text    | 1–120 chars                                      |
| `start_date`       | date    | —                                                |
| `end_date`         | date    | `>= start_date`; range `<= 1830` days            |
| `timezone`         | text    | valid IANA zone (`challenges_guard`)             |
| `required_minutes` | integer | `1 … 1440`                                       |
| `proof_required`   | boolean | default `true`                                   |
| `missed_day_cost`  | integer | `>= 0`, whole SEK                                |
| `status`           | text    | `draft` \| `active` \| `completed` \| `archived` |
| `created_by`       | uuid    | → `profiles.id`, `ON DELETE SET NULL`            |

- **Derived, never stored:** day count `(end_date - start_date) + 1`, matrix
  columns, elapsed/remaining days, max liability.
- **Rule-lock** (`challenges_guard`): once `status <> 'draft'` **or** the
  challenge has started (in its own timezone), `start_date`, `timezone`,
  `required_minutes`, `proof_required` and `missed_day_cost` are immutable.
  `end_date` may still be **extended** (not shortened) unless
  `completed`/`archived`. `name` and `status` stay editable. A no-JWT session
  bypasses the lock (deliberate break-glass; do it in a migration).

### `challenge_memberships`

| Column                     | Type    | Notes                                                 |
| -------------------------- | ------- | ----------------------------------------------------- |
| `id`                       | uuid PK |                                                       |
| `challenge_id`             | uuid    | → `challenges.id`, `ON DELETE CASCADE`                |
| `user_id`                  | uuid    | → `profiles.id`, `ON DELETE CASCADE`                  |
| `participation_start_date` | date    | required                                              |
| `participation_end_date`   | date    | nullable, **inclusive**; null ⇒ through challenge end |
| `active`                   | boolean | current-visibility/logging gate only                  |
| `created_by`               | uuid    | → `profiles.id`                                       |

- `UNIQUE (challenge_id, user_id)` — exactly one row per person per challenge in
  V1. Rejoin = widen the window; history is in `audit_log`.
- `challenge_memberships_guard` rejects a window that does not intersect the
  challenge range.
- **Eligibility is the date window, never `active`.** Ending someone's
  participation = set `participation_end_date`.

### `training_entries`

| Column                                                     | Type    | Notes                     |
| ---------------------------------------------------------- | ------- | ------------------------- |
| `id`                                                       | uuid PK |                           |
| `challenge_id`                                             | uuid    | → `challenges.id` cascade |
| `user_id`                                                  | uuid    | → `profiles.id` cascade   |
| `challenge_date`                                           | date    | the local challenge day   |
| `duration_minutes`                                         | integer | `1 … 1440`                |
| `activity`                                                 | text    | ≤ 120 chars, nullable     |
| `note`                                                     | text    | ≤ 2000 chars, nullable    |
| `status`                                                   | text    | `active` \| `invalidated` |
| `invalidated_reason` / `invalidated_by` / `invalidated_at` |         | admin correction trail    |

- `UNIQUE (challenge_id, user_id, challenge_date)` — one canonical entry per day.
- `training_entries_guard`:
  - identity columns (`challenge_id`, `user_id`, `challenge_date`) are immutable;
  - a participant may only **create/edit/delete their own** entry, only when
    `challenge_date = challenge_current_date(challenge_id)` (the current local
    day), only while the challenge and their membership are `active`, and the
    date must lie in their participation window;
  - only an admin (or a no-JWT backend) may set `status = 'invalidated'` or act
    on a past day.

### `training_proofs`

| Column                     | Type    | Notes                                                               |
| -------------------------- | ------- | ------------------------------------------------------------------- |
| `id`                       | uuid PK |                                                                     |
| `training_entry_id`        | uuid    | → `training_entries.id` cascade, **UNIQUE** (one proof/entry in V1) |
| `challenge_id` / `user_id` | uuid    | denormalised from the entry by `training_proofs_guard`              |
| `storage_path`             | text    | **UNIQUE**; object key in the `proofs` bucket                       |
| `mime_type`                | text    | jpeg/png/webp/heic/heif only                                        |
| `size_bytes`               | bigint  | `1 … 15 MiB`                                                        |
| `width` / `height`         | integer | optional                                                            |

- Participants may attach/remove proof only on their own current-day entry.
- No `UPDATE` — replace = delete + insert (same day).

### `audit_log`

Append-only (`audit_log_prevent_change` blocks `UPDATE`/`DELETE`). Written only
by the `SECURITY DEFINER` function `audit_row_change`:

| Trigger source          | When it logs                                                                        |
| ----------------------- | ----------------------------------------------------------------------------------- |
| `challenges`            | every insert/update/delete                                                          |
| `challenge_memberships` | every insert/update/delete                                                          |
| `training_entries`      | only when the actor is an admin or a privileged backend (corrections/invalidations) |
| `training_proofs`       | only when the actor is an admin or a privileged backend                             |

It has **no foreign keys** (`actor_user_id`, `challenge_id`, `target_user_id`,
`entity_id` are raw uuids): the log must outlive anything it references, and the
`AFTER DELETE` triggers would otherwise fail an FK check against the row they are
recording the deletion of.

Columns: `actor_user_id`, `challenge_id`, `target_user_id`, `entity_type`,
`entity_id`, `action` (`insert`/`update`/`delete`/`invalidate`/`revalidate`),
`before_data`/`after_data` (jsonb row snapshots), `note`.

## 3. Indexes

| Table                   | Index                                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------- |
| `challenges`            | `(status)`, `(created_by)`                                                                                    |
| `challenge_memberships` | `UNIQUE (challenge_id, user_id)`, `(user_id)`, `(challenge_id, active)`                                       |
| `training_entries`      | `UNIQUE (challenge_id, user_id, challenge_date)`, `(challenge_id, challenge_date)`, `(user_id, challenge_id)` |
| `training_proofs`       | `UNIQUE (training_entry_id)`, `UNIQUE (storage_path)`, `(user_id)`, `(challenge_id)`                          |
| `audit_log`             | `(challenge_id, created_at desc)`, `(entity_type, entity_id)`, `(actor_user_id)`                              |

The dashboard / matrix queries are all `O(1)` round-trips against
`challenge_day_states(challenge_id)` or a direct range scan on
`(challenge_id, challenge_date)` — never per cell.

## 4. Functions

| Function                               | Security    | Purpose                                                                                                                  |
| -------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------ |
| `set_updated_at()`                     | invoker     | `updated_at` trigger helper                                                                                              |
| `is_admin()`                           | definer     | current user is an active admin — used in RLS                                                                            |
| `current_user_role()`                  | definer     | `'participant'` / `'admin'`                                                                                              |
| `is_challenge_member(challenge_id)`    | definer     | current user has a membership row (any state)                                                                            |
| `shares_challenge_with(other_user)`    | definer     | the two users share a challenge — profile visibility                                                                     |
| `is_valid_timezone(text)`              | invoker     | exists in `pg_timezone_names`                                                                                            |
| `challenge_current_date(challenge_id)` | definer     | authoritative "today" in the challenge timezone                                                                          |
| `challenge_day_states(challenge_id)`   | **invoker** | canonical `(user, date, state, entry_id, duration)` — mirrors `src/domain/dayState.ts`; RLS filters non-members to empty |
| `try_cast_uuid(text)`                  | invoker     | safe uuid parse for Storage path segments                                                                                |
| `handle_new_user()`                    | definer     | `auth.users` → `profiles`                                                                                                |
| `*_guard()`                            | definer     | the write-time rule enforcement described above                                                                          |
| `audit_row_change()`                   | definer     | writes `audit_log`                                                                                                       |
| `audit_log_prevent_change()`           | invoker     | makes `audit_log` append-only                                                                                            |

`SECURITY DEFINER` helpers use `SET search_path = ''` and fully-qualified names;
`EXECUTE` is revoked from `public`/`anon` and granted to `authenticated`.

The definer predicates exist to break RLS recursion: e.g. the `profiles` SELECT
policy calls `is_admin()` and `shares_challenge_with()`, which read `profiles` /
`challenge_memberships` without re-triggering their policies.

## 5. RLS policy summary

RLS is **enabled on every table**. `anon` has no privileges on any table.
`service_role` bypasses RLS (used only by privileged Edge Functions).

| Table                   | SELECT                            | INSERT                          | UPDATE                         | DELETE                         |
| ----------------------- | --------------------------------- | ------------------------------- | ------------------------------ | ------------------------------ |
| `profiles`              | self ∪ admin ∪ shares-a-challenge | — (trigger only)                | self (not role/active) ∪ admin | — (cascade from auth)          |
| `challenges`            | member ∪ admin                    | admin, `created_by = uid`       | admin (+ rule-lock trigger)    | admin **and** `status='draft'` |
| `challenge_memberships` | member ∪ admin                    | admin                           | admin                          | admin                          |
| `training_entries`      | member ∪ admin                    | own & member, ∪ admin (+ guard) | own ∪ admin (+ guard)          | own ∪ admin (+ guard)          |
| `training_proofs`       | member ∪ admin                    | own & member, ∪ admin (+ guard) | — (no policy)                  | own ∪ admin (+ guard)          |
| `audit_log`             | admin                             | — (definer only)                | — (blocked)                    | — (blocked)                    |

"member" = `is_challenge_member(challenge_id)` — a membership row exists (active
or not). Group visibility of names, entries, activity, notes and proof is
intentional (social verification, `PRODUCT_SPEC §11–12`). Email and other auth
fields are **not** exposed — the frontend only ever reads `profiles`.

## 6. Storage

Two **private** buckets (no public URLs, ever). Reads go through short-lived
signed URLs the client requests after the SELECT policy authorises.

| Bucket    | Path                                                     | Size / types                      |
| --------- | -------------------------------------------------------- | --------------------------------- |
| `proofs`  | `{challenge_id}/{user_id}/{challenge_date}/{uuid}.{ext}` | ≤ 15 MiB, jpeg/png/webp/heic/heif |
| `avatars` | `{user_id}/{uuid}.{ext}`                                 | ≤ 5 MiB, jpeg/png/webp            |

`storage.objects` policies:

| Bucket    | read                                    | write (insert)                                  | update/delete               |
| --------- | --------------------------------------- | ----------------------------------------------- | --------------------------- |
| `proofs`  | admin ∪ member of `folder[1]` challenge | `folder[2] = uid` **and** member of `folder[1]` | owner (`folder[2]`) ∪ admin |
| `avatars` | any authenticated user                  | `folder[1] = uid`                               | `folder[1] = uid`           |

The DB `training_proofs` row and the Storage object are written in two steps by
the client; a failure between them leaves an orphan on one side. Acceptable for
V1 — a later reconciliation job / Edge Function can sweep.

## 7. Seed strategy

- **Schema** → migrations only. No dashboard changes.
- **`supabase/seed.sql`** → local-stack only (not run against hosted); kept
  empty.
- **First challenge** → optional migration `…0300`, idempotent, `status='draft'`,
  fixed id `11111111-1111-4111-8111-111111111111`. An admin activates it from
  the UI. Drop the migration if you prefer to create it entirely via the admin
  UI later.
- **First admin** → bootstrap manually once: create the account (Dashboard →
  Authentication → Add user, or `auth.admin`), then
  `update public.profiles set role = 'admin' where id = '…';` in the SQL editor.
  `handle_new_user` will already have created the profile row; the
  `profiles_guard` trigger allows the change because a SQL-editor session has a
  NULL `auth.uid()`.

## 8. Security-sensitive decisions

1. **Authorization is entirely in the database.** Frontend guards only hide UI.
2. **`SECURITY DEFINER` everywhere it matters**, always with `search_path = ''`
   and schema-qualified names, `EXECUTE` locked to `authenticated`.
3. **Group visibility is scoped to shared challenges**, computed by definer
   predicates — no table is world-readable to all authenticated users except
   avatars (low sensitivity, by design).
4. **The frontend never touches `auth.users`.** Only `profiles` is exposed, and
   only the non-sensitive columns exist on it.
5. **Proof/avatar buckets are private**; path-based ownership + membership
   checks; signed URLs only.
6. **`audit_log` is append-only** and admin-read-only; challenge-impacting admin
   actions are recorded automatically by triggers.
7. **Challenge rules lock after start** so historical completion cannot be
   silently rewritten.
8. **No public sign-up.** `enable_signup = false`; accounts come from an
   admin-triggered privileged Edge Function (`inviteUserByEmail`). The
   service-role key stays server-side.
9. **A NULL `auth.uid()` is treated as a trusted backend** in the guard
   triggers (service_role / SQL editor / migrations). This is what makes
   bootstrapping and Edge-Function operations possible; it is never reachable
   from a browser session (which always carries a JWT).

## 9. What is NOT in this migration (later phases)

- Stats / liability aggregate views (Fas 5) — built on `challenge_day_states`.
- The recent-dashboard and full-matrix RPCs (Fas 6–7).
- Ranking view (Fas 8 — formula undecided).
- Admin RPCs / Edge Functions: `invite_participant`, `end_participation`,
  `invalidate_entry` (Fas 3 / 9), each writing `audit_log` explicitly.
- `admin_participants` view joining `auth.users` for invite status.
