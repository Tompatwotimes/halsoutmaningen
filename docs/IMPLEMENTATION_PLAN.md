# Hälsoutmaningen — Implementation Plan

Status: **Fas 0–2 complete. Fas 3 in progress.** The four initial migrations
are applied to the hosted project (Postgres 17.6); local/remote history
matches; the first challenge exists as `draft`; the first admin was bootstrapped
manually. Fas 3 (auth end-to-end + admin invite) is built and its Edge Function
/ migrations are written but **not yet deployed** — see `docs/INVITE_FLOW.md`.
This document is the working plan for everything after the scaffold. It is
derived from `CLAUDE.md`, `docs/PRODUCT_SPEC.md` and `docs/ARCHITECTURE.md` and
does not override them. Schema detail lives in `docs/DATABASE.md`.

### Open questions — resolved 2026-09-01

| #   | Question                | Answer applied                                                                                                                                                                                                    |
| --- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Rest days               | None. Every eligible calendar day requires the configured training. Kept config-driven.                                                                                                                           |
| 2   | Participant editing     | Create/edit/delete own entry **only on the current challenge-local day**. No self-service backfill. Admin corrections are audited.                                                                                |
| 3   | Membership deactivation | Participation **date window** is authoritative for evaluation; `active` gates current visibility/logging only and never rewrites history. `participation_end_date` inclusive.                                     |
| 4   | Admin invites           | Private, admin-only, via a privileged Edge Function (`inviteUserByEmail`). No public sign-up.                                                                                                                     |
| 5   | Ranking                 | Still deferred to Fas 8 — build stats cleanly, no permanent formula yet.                                                                                                                                          |
| 6   | Supabase env            | Existing hosted project, connected via the Supabase GitHub integration. Dev against hosted (no local Docker stack — 4 GB VM). All schema via committed migrations. **No migration applied without prior review.** |

---

## 1. Contradictions, ambiguities and assumptions to resolve

Original analysis, kept for the record. §1.1–1.3 and 1.7 are now settled per the
table above; the schema in `docs/DATABASE.md` reflects the resolutions.

### 1.1 "Eligible challenge day" implies rest days, but none are defined

The specs use "eligible challenge day" heavily, which reads as though some days
in the range might not require training. But the only stated eligibility rules
are (a) date within `start_date..end_date` and (b) date within the participation
window. The dashboard example evaluates `Mån/Sön/Lör` alike.

- **Working assumption:** every calendar day in the range is a training day —
  no weekends off, no per-challenge rest-day allowance in V1.
- **Impact if wrong:** day-state logic, liability, matrix columns, streaks.
- **NEEDS DECISION before Fas 2** (schema): do we add an optional
  `rest_weekdays` / `rest_dates` concept to `challenges` now (cheap) or defer?
  Recommendation: add a nullable, unused `rest_weekdays int[]` column now so a
  later migration isn't required; keep V1 logic ignoring it.

### 1.2 Can a participant edit or delete their own training entry?

Specs say a participant may not alter _another_ participant's entry, and that
proof gives social verification — which argues for stability. Backfill is
"maybe, per admin rules" and undefined.

- **Working assumption for V1:**
  - Insert allowed only for `challenge_date = today` (challenge timezone).
  - Owner may update their own entry (duration/activity/note/proof) only while
    `challenge_date = today`. After the local day ends it is frozen for the
    owner.
  - No backfill of past days by participants in V1.
  - Owner may not delete; admin may invalidate (soft) with an audit record.
- **NEEDS DECISION before Fas 4** (logging): confirm the "today only" window,
  or specify a grace period (e.g. until 03:00 next day, or N days back).

### 1.3 `active` flag vs participation dates for eligibility

`challenge_memberships` has both `active boolean` and a date window. The spec's
late-join / early-leave rules are expressed purely with dates.

- **Decision (made):** eligibility and all results are driven by the
  **participation date window** only. `active = false` means "hide from today's
  lists / current dashboards and block new logging", but historical eligible
  days in the window are still evaluated. The domain layer already reflects
  this (`membership.ts`).
- **NEEDS CONFIRMATION before Fas 2:** is that the intended meaning of
  deactivation, or should deactivation also stop evaluation from that date
  (i.e. behave like setting `participation_end_date = today`)?

### 1.4 Multiple membership rows per (challenge, user) — rejoin/leave history

Spec wants "inspect membership history" and reactivation, which suggests keeping
old rows. But multiple overlapping rows make eligibility a union-of-intervals
problem.

- **Decision (made) for V1:** exactly one membership row per (challenge, user),
  enforced by a unique constraint. Rejoin = widen the window or clear
  `participation_end_date`. All membership changes are written to `audit_log`,
  which _is_ the history.
- **Revisit** if a real rejoin-with-gap case appears; migrate to multi-interval
  deliberately.

### 1.5 Ranking formula is explicitly undefined

`PRODUCT_SPEC §17` says the formula must be defined before it becomes
"competitive truth" and warns about late joiners.

- **Deferred to Fas 8.** Proposed default to ratify then:
  primary = completion rate = `completed / (eligible days that are not future)`;
  tie-break 1 = fewer confirmed missed days; tie-break 2 = current streak.
  Participants with `< N` decided eligible days shown but flagged "för få
  dagar" and not ranked competitively.
- **NEEDS DECISION before Fas 8.**

### 1.6 Retroactive challenge-rule edits

`ARCHITECTURE §22`: changing `required_minutes` after start can rewrite history.

- **Decision (made):** once `status = active` and `today >= start_date`, the
  rule fields (`start_date`, `required_minutes`, `proof_required`,
  `missed_day_cost`, `timezone`) are **locked**. Only `name`, `status` and
  `end_date` (extend-only) may change. Enforced in RLS / a security-definer
  update function. Rule versioning is out of scope for V1.

### 1.7 Admin-created accounts / invitations

Creating auth users requires the service-role key, which must never be in the
browser (`CLAUDE.md §19`). `ARCHITECTURE §2` says "no extra backend service
unless justified".

- **Decision (made):** privileged admin operations (invite user, admin
  corrections that touch `auth`/other users) run in **Supabase Edge Functions**
  using the service role, authorized by checking the caller's admin role. Edge
  Functions are part of Supabase, not a separate service — this is justified.
- V1 fallback if Edge Functions slip: admin records a membership by email; the
  person self-signs-up; a trigger links `auth.users.id` to the pending profile
  by matching email.
- **NEEDS DECISION before Fas 3:** Edge Function invite flow now, or email-match
  linking for V1?

### 1.8 Money type and precision

Examples use whole kronor (50, 25). `ARCHITECTURE` says `numeric/integer`.

- **Decision (made):** `missed_day_cost integer` = whole SEK, `CHECK >= 0`. All
  derived amounts are integers. If fractional costs are ever needed, migrate to
  minor units (öre) as `integer`.

### 1.9 Proof read authorization mechanism

Private bucket; group members must view each other's proof but not the public.

- **Decision (made):** Storage RLS `SELECT` policy on the proof bucket that
  parses `challenge/{challenge_id}/...` from the object name and allows read if
  the requester shares that challenge (via a `SECURITY DEFINER` helper
  `is_challenge_member(challenge_id)`). The frontend renders proof through
  short-lived signed URLs created after that check. Upload/update/delete
  policies require the path's `{user_id}` to equal `auth.uid()`.

### 1.10 "Today" trust boundary

The browser computes challenge-local "today" for optimistic UI; PostgreSQL must
be authoritative for completion/missed/debt.

- **Decision (made):** every write path and every aggregate view derives the
  current challenge date server-side as `(now() AT TIME ZONE c.timezone)::date`.
  The frontend value from `src/domain/time.ts` is display-only and is covered by
  boundary tests.

### 1.11 Avatar storage

`profiles.avatar_path` needs a bucket.

- **Decision (made):** separate `avatars` bucket, small size limit. Readable by
  any authenticated user (avatars are low-sensitivity, shown across the group);
  writable only by the owner. Not on the critical path — Fas 5+.

### 1.12 Minor spec arithmetic check

`PRODUCT_SPEC §4` example: `2027-08-01 → 2027-11-30` → "122 dagar", "6 100 kr".
Verified correct (inclusive) and consistent with `missed_day_cost = 50`. No
conflict; noted because the same section elsewhere uses a 30-min / different
values — those are independent example fragments, not one scenario.

---

## 2. Architectural decisions taken in Fas 0

| Area            | Decision                                                                                                | Rationale                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Build tooling   | Vite 7, React 19, TS 5.7, project-reference tsconfigs                                                   | Spec-mandated stack; current majors; 0 audit vulnerabilities                                    |
| Type strictness | `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` + `noImplicitReturns` + more       | Domain logic is money/authorization adjacent; catch mistakes at compile time                    |
| Lint            | `typescript-eslint` strict + stylistic **type-checked**, `eslint-config-prettier`                       | Type-aware rules catch floating promises, unsafe `any`, etc.                                    |
| Routing         | React Router 7, data-driven nav (`src/config/navigation.tsx`)                                           | Nav, shell and route table stay in sync                                                         |
| Server state    | TanStack Query 5, single `QueryClient` in `src/app`                                                     | Spec-recommended; cache/refetch for dashboard freshness                                         |
| Validation      | Zod at every trust boundary (env, auth form, later: API payloads)                                       | Spec-recommended                                                                                |
| Styling         | CSS Modules + design tokens in `src/styles/tokens.css`; **no** CSS framework                            | Full control of a professional identity; avoids a heavy dependency and utility-class soup       |
| Domain layer    | `src/domain/*` — pure, framework-free, exhaustively unit-tested; mirrors canonical PostgreSQL logic     | One canonical day-state / liability implementation, reused everywhere; DB stays source of truth |
| Dates           | Plain `YYYY-MM-DD` strings for challenge-day semantics; UTC-midnight math only for counting             | Mirrors PG `date`; immune to Europe/Stockholm DST                                               |
| "Today"         | `Intl.DateTimeFormat` in the challenge timezone, display-only; PG authoritative                         | `ARCHITECTURE §12`                                                                              |
| Auth            | Supabase Auth, PKCE, session in `localStorage`; `AuthProvider` context + `RequireAuth` / `RequireAdmin` | Client guards hide UI only; RLS enforces                                                        |
| Role source     | `useProfile()` (stub) — role always read from DB, never client-held                                     | `CLAUDE.md §10, §17`                                                                            |
| Secrets         | `.env` (git-ignored) with only `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`; `env.ts` fails fast      | `CLAUDE.md §19`                                                                                 |
| DB workflow     | `supabase/` with `config.toml` + `migrations/`; CLI as dev dependency; Git is source of truth           | `ARCHITECTURE §3, §25`                                                                          |
| Privileged ops  | Supabase Edge Functions with service role (invites, admin corrections) — not a separate backend         | §1.7 above                                                                                      |
| Code splitting  | Route-level `React.lazy`; vendor chunks split (`supabase`, `query`)                                     | Keeps initial payload and cache behaviour sane as features land                                 |
| PWA             | Manifest + theme colour now; service worker deferred to pre-deploy phase                                | Avoid SW cache pain during rapid iteration                                                      |
| Testing         | Vitest + Testing Library + jsdom; fixtures in `src/test/fixtures.ts`                                    | `ARCHITECTURE §27` priorities are domain rules, which are now covered                           |

---

## 3. Phased plan

Each phase is a vertical slice: migration(s) → RLS → types → data hooks → UI →
tests → self-review. Do not start a phase before its `NEEDS DECISION` items are
answered.

### Fas 0 — Foundation (done)

Scaffold, tooling, domain layer, app shell, auth plumbing, Supabase dir. No
backend touched.

### Fas 1 — Supabase project wiring (in progress)

- `supabase login` + `supabase link --project-ref <ref>` (needs project ref and
  DB password — user runs the interactive commands).
- Confirm the connection with `supabase migration list` (shows local vs remote).
- Set `.env` from the hosted project URL + anon key.
- Confirm how the GitHub integration applies migrations (preview branches vs
  direct-to-prod on merge) and agree the review gate.
- No `supabase start` (VM RAM). Output: a linked CLI checkout + documented flow.

### Fas 2 — Core schema + RLS foundations (written, awaiting review)

Migrations authored in `supabase/migrations/` (see `docs/DATABASE.md`):
`profiles`, `challenges`, `challenge_memberships`, `training_entries`,
`training_proofs`, `audit_log`; helper + guard functions; canonical
`challenge_day_states()`; RLS on every table; private `proofs` / `avatars`
Storage buckets + policies; optional first-challenge data insert.
pgTAP tests in `supabase/tests/`. **STOP: do not apply to hosted until the user
approves.** After apply: `npm run db:types` to generate `src/types/database.ts`.

### Fas 3 — Authentication end to end (built, deploy pending)

Done: `useProfile()` reads the real `profiles` row (role + active every load);
login / logout / session restore / `/aktivera` (invite + reset) / route guards
(`RequireAuth`, `RequireAdmin` fail-closed) / deactivated-account notice.
Generated `src/types/database.ts` from the hosted schema (`npm run db:types`
now uses `--linked`). Admin → Deltagare area: challenge picker, participant
list from real Supabase data, invite form. `invite-participant` Edge Function
(`inviteUserByEmail` + membership upsert-as-caller, admin-authorized, idempotent)
— architecture and failure semantics in `docs/INVITE_FLOW.md`.

Not yet done (needs the product owner): deploy the Edge Function, set its
secrets, disable hosted sign-up + add redirect URLs, send the first real invite.
No new migration is required for this phase.

### Fas 4 — Training entries + private proof upload

`training_entries` (unique `(challenge_id, user_id, challenge_date)`,
`duration_minutes > 0`, `status` in `active|invalidated`), `training_proofs`,
private `proof` Storage bucket + policies (§1.9). Insert/update RLS enforcing
ownership + membership + "today" window (§1.2). `Logga träning` form: duration,
activity, note, camera/file input, client-side type/size validation, optimistic
update. Depends on §1.2.

### Fas 5 — Canonical day-state (DB) + Home + Profile

SQL view/function `participant_day_states(challenge_id)` returning
`user_id, challenge_date, state` — the authoritative mirror of
`src/domain/dayState.ts`. Parity test: DB output vs domain output over a seeded
scenario. Build **Hem** (today status, streak, progress, debt, group headline)
and **Profil** (streaks, completed/missed, %, liability breakdown, history).

### Fas 6 — Recent group dashboard

One RPC returning `user_id, display_name, challenge_date, state, entry_id,
duration` for today + previous N days (N configurable, default 5). Horizontally
scrollable status grid, today column emphasised, `X av Y har tränat idag` with
Y computed from participants eligible today. Tap a completed cell → detail +
signed proof URL (§1.9). No per-cell requests.

### Fas 7 — Full challenge matrix

RPC / view over `generate_series(start, end)` × memberships × entries. Sticky
names, sticky date headers, month grouping, "hoppa till idag", compact cells.
Verify query count is O(1), not O(cells).

### Fas 8 — Ranking

Ratify the formula (§1.5), implement as a single SQL view, render the list with
the late-joiner safeguards.

### Fas 9 — Administration

Challenge create/edit (respecting the rule-lock, §1.6), membership management
(add/invite/connect/start/end/activate/deactivate), entry inspection +
invalidation with `audit_log` writes, admin statistics. Audit trail view.

### Fas 10 — Mobile UX hardening + PWA

Real-device passes, empty/loading/error states everywhere, camera UX, service
worker + install prompt, Lighthouse.

### Fas 11 — Production deployment

Cloudflare Pages (frontend env vars), Supabase hosted config parity check,
custom domain, backup/restore note, smoke test. Only after explicit go-ahead.

---

## 4. Testing strategy

- **Domain layer (done, extend per phase):** date ranges, DST boundaries,
  membership eligibility, all five day states, late join, early departure,
  liability splits, proof-required rule, streaks. Pure and fast.
- **DB parity tests (Fas 5+):** seed a fixed scenario, assert the SQL
  day-state / liability output equals the domain output.
- **RLS tests (Fas 2+):** per policy, one allowed and one denied case using
  scoped JWTs (pgTAP or a scripted harness).
- **Component tests:** forms and stateful UI (logging form validation, guards).
- **Not prioritised:** snapshot tests of presentational markup.

---

## 5. Open questions for the product owner

1. **Rest days (§1.1):** is training required every calendar day in the range?
2. **Entry editing window (§1.2):** own-entry edits allowed only on the current
   local day, or is there a grace period / limited backfill?
3. **Deactivation semantics (§1.3):** does deactivating a membership stop
   evaluation from that date, or only hide the person from current views?
4. **Admin invites (§1.7):** Edge Function invite flow for V1, or email-match
   self-signup linking?
5. **Ranking formula (§1.5):** ratify the proposed default or specify another.
6. **Supabase project:** is there an existing hosted project to link, and do
   you want day-to-day dev against hosted or a local stack?
