# Hälsoutmaningen — Game Master (GM1)

Game Master is an autonomous "surprise engine" layered on top of the
challenge. It occasionally turns authoritative challenge state into a
hand-written private ambush or public roast. It is seasoning, not the main
experience: **träna varje dag → registrera → se gruppen → streak/skuld/ranking
→ final** stays the product.

Design source of truth:
[`docs/superpowers/specs/2026-09-04-game-master-v1-design.md`](./superpowers/specs/2026-09-04-game-master-v1-design.md).
This document describes GM1 as actually built, not the aspirational full
GM1–GM4 roadmap.

Migrations:
[`supabase/migrations/20260904130000_game_master_foundation.sql`](../supabase/migrations/20260904130000_game_master_foundation.sql),
[`…130100_game_master_engine.sql`](../supabase/migrations/20260904130100_game_master_engine.sql),
[`…130200_game_master_templates.sql`](../supabase/migrations/20260904130200_game_master_templates.sql).
pgTAP coverage:
[`supabase/tests/0015…0017`](../supabase/tests/) (55 + 86 + 49 = 190 assertions).

---

## 1. Product invariants and how they're enforced

Spec §2 is a hard list of things Game Master must never do: remove/protect a
streak, create/forgive debt, change KASSAN, grant free days, mark a day
completed, change ranking, approve/reject efterregistrering, alter
Straffbanken, or make core logging depend on Game Master being up.

This is enforced structurally, not by convention:

- **No core table, trigger or function references a Game Master object.** The
  three GM migrations add tables and functions that only reference core
  tables for _reads_ (`challenge_results()`, `challenge_day_states()`,
  `challenge_streak_runs()`, `challenge_current_date()`, `is_admin()`,
  `is_challenge_member()`, `challenge_memberships`, `profiles`). Nothing in
  `training_entries`, `challenge_day_states`, `challenge_results`,
  `earned_penalties`, `penalty_assignments` or `retroactive_training_requests`
  knows Game Master exists.
- **Every pulse function swallows its own errors.** `_run_game_master_pulse`
  wraps its entire body in a `begin … exception when others then …` block: any
  failure (bad template render, corrupt payload, whatever) is caught, written
  as a `game_master_runs` row with `outcome = 'error'`, and the function
  returns `NULL`. It never re-raises. `_game_master_tick_all` additionally
  wraps _each challenge's_ pulse in its own exception handler so one broken
  challenge can never abort the loop for the others.
- **The frontend never awaits a pulse on the critical path.** `submitTraining`
  (`src/features/challenge/submit-training.ts`) calls
  `requestGameMasterPulse(...).catch(() => undefined)` only _after_ the core
  training write has already succeeded, and never awaits or surfaces its
  result. `GameMasterAmbush` (`src/features/game-master/GameMasterAmbush.tsx`)
  is a pure leaf presenter: its query uses `retry: false` +
  `throwOnError: false`, and loading/error/no-event all render `null` — a Game
  Master failure is indistinguishable from "no event" anywhere in the UI.

This isolation is proven, not just asserted: `supabase/tests/0017_game_master_rls_audit_cron.test.sql`
Section G forces a pulse and then re-reads `challenge_day_states`,
`challenge_results` and `challenge_streak_runs` for the affected user to show
they are byte-for-byte unchanged, and Section H performs an ordinary
`training_entries` insert with Game Master both enabled and mid-pulse to show
core writes are entirely unaffected.

**If Game Master fails for three days, the only symptom is three days of
silence.**

---

## 2. The pulse model

Game Master wakes in two ways, both funnelling into the same internal
`_run_game_master_pulse(challenge_id, source, forced_roll)`:

### Event pulse

After a training entry is successfully submitted, the frontend calls the
authenticated RPC `request_game_master_pulse(p_challenge_id)`. The call
carries **only a challenge id** — never a victim, template, score or text;
the server is the sole source of randomness and reads all state itself.

- The caller must be an admin or an active member of the challenge, or the
  RPC raises.
- A **90-second server-side throttle** applies per challenge: if any
  `source = 'event'` run started in the last 90 seconds, the RPC returns
  `NULL` immediately without invoking the engine. Client-side spam is
  therefore harmless.
- `GameMasterAmbush` also fires at most one such pulse per browser session per
  challenge (`requestSessionStartPulse`, guarded by `sessionStorage`) the
  first time the authenticated shell mounts — a convenience against needless
  chatter, not a security boundary; the 90s server throttle is authoritative.

### Scheduled pulse

A `pg_cron` job runs `_game_master_tick_all()` hourly (`17 * * * *`). For
every `active` challenge with Game Master `enabled`, the dispatcher:

1. computes the challenge's **local** hour and date via
   `now() at time zone <challenge.timezone>`;
2. skips the challenge unless the local hour is **08 or 20**;
3. skips it if a `source = 'scheduled'` run already exists for that exact
   local `{date, hour}` window (dedupe — the hourly tick can land inside the
   same window more than once around DST transitions without double-firing);
4. otherwise calls `_run_game_master_pulse(challenge_id, 'scheduled', NULL)`.

Because the local hour/date is recomputed per challenge from its own
timezone, this is correct across multiple challenges in different timezones
and across DST changes without any special-casing.

Registration is guarded: the migration wraps `create extension pg_cron` +
`cron.schedule(...)` in a `do $$ … exception when others …$$` block, so an
environment without `pg_cron` available still applies the migration cleanly
— `_game_master_tick_all()` exists unconditionally and can be invoked
directly (tests call it this way).

**No push notifications in GM1** — both pulse kinds only ever populate rows a
client reads on its own next query.

---

## 3. Silence, scoring and the 9 GM1 families

Silence — a pulse that deliberately produces no event — is a normal,
successful outcome, not a failure. Every pulse (event or scheduled) writes
exactly one `game_master_runs` row, whether the outcome is `event`,
`silence`, `disabled`, `cooldown` or `error`.

A pulse:

1. loads `game_master_settings` — missing row or `enabled = false` → outcome
   `disabled`;
2. checks the global 4h any-event cooldown — blocked → outcome `cooldown`;
3. calls `_game_master_candidates(challenge_id)`, which derives one scored
   candidate per family from `challenge_results()` / day-states / streak-runs
   / `game_master_memories`;
4. discards any candidate scoring below **35**, already-fired
   (fingerprint-matched, non-cancelled) or blocked by a cooldown (below);
5. if nothing survives → outcome `silence` (`reason: no_eligible_candidate`);
6. otherwise **weighted-selects one candidate using `score²`** as the weight,
   then weighted-selects a template within that family/visibility (also
   `score²`-style weighting, using each template's `weight *
final_weight^max(0, escalation-0.7)`), honouring the template's own
   cooldown and `once_per_subject` flag;
7. rolls a separate **emission probability** — a roll that loses → outcome
   `silence` (`reason: emission_roll_lost`), a template pool this cooldown
   leaves empty → outcome `silence` (`reason: no_eligible_template`);
8. otherwise renders and freezes a `game_master_events` row and records
   `outcome = 'event'`.

### Candidate score (`_game_master_score`, spec §4)

```
score = clamp(20,40, base) + clamp(0,30, magnitude) + clamp(0,20, novelty)
      + clamp(0,10, final_relevance) + clamp(-20,10, attention_balance)
```

clamped again to `[0, 100]` overall. Candidates below **35** never survive.

### Emission probability

```
p = clamp(0.05, 0.60, ((score - 30) / 180) * intensity * escalation)
```

- `intensity`: low `0.65` / normal `1.00` / high `1.35`, from
  `game_master_settings.intensity` (`_game_master_intensity`).
- `escalation = 0.7 + progress²`, where `progress` is the clamped fraction of
  the challenge elapsed by challenge-local "today"
  (`_game_master_escalation`). Early in a challenge this is quiet (≈0.7 at
  day 0); by the final week it approaches 1.7. An empty/degenerate date range
  is treated as full finale (`1.7`).

### The 9 GM1 candidate families

`_game_master_candidates` derives exactly these families (source:
`20260904130100_game_master_engine.sql`, plan Task 3 Step 3):

| Family              | Visibility | Source                                                          |
| ------------------- | ---------- | --------------------------------------------------------------- |
| `missed_day`        | private    | a freshly missed eligible day for the subject                   |
| `streak_long`       | public     | an active streak crossing a milestone length                    |
| `streak_broken`     | public     | a streak run that just ended                                    |
| `debt_leader`       | public     | the participant currently carrying the most liability           |
| `kassan`            | public     | the group's total liability (no subject)                        |
| `comeback`          | public     | training resumed after a broken/collapsed streak                |
| `ranking_position`  | public     | a notable leaderboard position                                  |
| `historic_callback` | varies     | a stored `game_master_memories` fact becoming callback-eligible |
| `general_system`    | public     | a generic, subject-less observation                             |

**`general_system` is deliberately dormant in GM1.** Its maximum attainable
score is `20 + 0 + 8 + 6 + 0 = 34` — one point under the 35 floor — by
construction (`_game_master_candidates`, comment: _"deliberately below the 35
floor so a generic observation can NEVER, on its own, defeat silence and spam
the group"_). The family, its 8 seeded templates and its scoring inputs exist
so it is ready to be un-capped in a later phase, but under GM1's scoring it
can never actually emit.

A side effect worth knowing: candidate generation for `comeback` /
`historic_callback` is idempotent-write, not read-only — a broken streak run
of ≥14 days writes a `streak_collapse` row into `game_master_memories`
(unique on `(challenge_id, fingerprint)`) every time candidates are computed,
regardless of whether that pulse actually emits. This is the only write
inside candidate generation and it never touches a core table.

---

## 4. Cooldowns

Applied, in this order, inside `_run_game_master_pulse` (spec §6 defaults —
GM1 implements exactly these):

| Cooldown           | Window                                             | Scope                                                                                    |
| ------------------ | -------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Global any-event   | 4 h                                                | per challenge, blocks the whole pulse before candidates are even generated               |
| Public event       | 36 h                                               | blocks any `public`-visibility candidate                                                 |
| Same subject       | 48 h                                               | blocks any candidate whose `subject_user_id` matches a recent event's subject            |
| Same family        | 72 h                                               | blocks any candidate whose family matches a recent event's family                        |
| Per-template       | `game_master_templates.cooldown_hours` (per row)   | blocks that exact template until its own cooldown elapses                                |
| Once-per-subject   | `game_master_templates.once_per_subject` (per row) | that template can never fire for the same subject twice in the challenge                 |
| Fingerprint dedupe | forever (until cancelled)                          | a candidate whose `fingerprint` already produced a non-cancelled event never fires again |

Every severity-5 template in the seed carries **either** `once_per_subject =
true` **or** `cooldown_hours >= 336` (14 days) — usually the former. Settings
(intensity, enable/disable toggles) scale _probability_, never bypass any of
these integrity rules — there is no "force emit" path anywhere, admin
included.

---

## 5. Templates

`game_master_templates` holds 96 hand-written GM1 rows, no AI:

| Family              | Count  |
| ------------------- | ------ |
| `missed_day`        | 14     |
| `streak_broken`     | 14     |
| `streak_long`       | 12     |
| `debt_leader`       | 10     |
| `kassan`            | 10     |
| `comeback`          | 10     |
| `historic_callback` | 10     |
| `ranking_position`  | 8      |
| `general_system`    | 8      |
| **Total**           | **96** |

Severity distribution: 12×severity 1, 25×severity 2, 28×severity 3, 15×
severity 4, **16×severity 5** (matches spec §18's "about 16/96"). Visibility:
80 public, 16 private. 9 of the 16 severity-5 templates are private and 7
public, so the rare "vad fan skrev appen precis?" moment stays mostly
personal rather than group spectacle.

### The 12 allowed placeholders (spec §18)

```
{name} {streak} {previous_streak} {missed_days} {debt_sek} {kassan_sek}
{rank} {participant_count} {days_until_final} {final_date} {eligible_days}
{completed_days}
```

Enforced twice, independently:

- **On write** — a `before insert or update` trigger on
  `game_master_templates` calls `_game_master_validate_template`, which
  rejects any `{token}` outside this 12-word vocabulary. This makes it
  structurally impossible to seed or edit in a template using an unapproved
  placeholder.
- **On render** — `_game_master_render(template, payload)` re-checks the same
  vocabulary as defence in depth, then substitutes each of the 12 keys from
  the candidate's payload (a key absent from the payload renders as the empty
  string — a frozen roast is never left with a literal `{name}` in it because
  of a missing value).

### Per-family placeholder discipline

The 12-word list is a _global_ allow-list; nothing at the database level
stops a `missed_day` template from referencing `{rank}`, which its payload
never populates (it would just render empty). Each family is disciplined by
convention (documented in the templates migration's header comment) to use
only the placeholders its own candidate payload actually provides — e.g.
`kassan` and `general_system` never use `{name}` because those candidates
have no subject. This per-family discipline is checked by the pgTAP seed
assertions in `0015`, not by a database constraint.

No template mentions tokens, competitions, titles, rivalries or prizes —
that is GM2+ territory.

---

## 6. Admin controls (`/admin/game-master`)

Route: `/admin/game-master`, `RequireAdmin`-gated (client-side hint only —
every mutating RPC also checks `is_admin()` server-side and writes an
`audit_log` row; RLS is the real enforcement per CLAUDE.md §10/§17).
Components: `GameMasterSettingsPanel` + `GameMasterRunLog`
(`src/features/admin/`), backed by `game-master-admin-api.ts`.

An admin **may**:

- toggle the whole subsystem on/off (`enabled` — the emergency brake:
  "Av innebär att inga nya händelser skapas");
- set intensity: låg / normal / hög;
- toggle private roasts, public roasts and Arkivet independently;
- inspect **every** recent pulse decision (`game_master_runs`), including
  silences, with candidate/eligible counts and diagnostics;
- inspect every recent event (`game_master_events`), private and public,
  cancelled or not — admins see the frozen title/body regardless of
  visibility;
- **cancel/hide one event with a mandatory reason** (`cancel_game_master_event`):
  the event flips to `status = 'cancelled'`, disappears from every
  non-admin `SELECT` and from Arkivet, can never fire again (its fingerprint
  stays matched), and the action is audited (`entity_type =
'game_master_event'`, the reason lands in `audit_log.note`, never the
  roast text itself).

An admin explicitly **cannot**, anywhere in the product:

- "roast X now" / manually trigger an emission;
- pick a victim/subject for an event;
- pick or influence which template is used;
- pick a winner (no competitions exist yet to have a winner);
- mint or affect a Competition Token (GM2 — not built).

There is no such affordance in the UI, the API layer, or any RPC — Game
Master always chooses its own subject, timing and text.

---

## 7. Archive (Arkivet)

Route `/arkivet`, `RequireAuth`-gated (normal participant auth, not admin),
reached from a discrete card on the Group page
(`src/pages/GroupPage.tsx`). Not a sixth bottom-nav item — the bottom bar
still has exactly five slots (Hem, Gruppen, Logga, Översikt, Ranking); Arkivet
sits alongside Straffbanken/Profil in the top-bar/desktop-rail menu reach, via
its own link.

`fetchGameMasterArchive` (`src/features/game-master/game-master-api.ts`)
selects only events where **all** of:

```
visibility = 'public' AND archive = true AND status = 'active'
```

RLS (`game_master_events_select`) independently guarantees a non-admin can
only ever see `public` + non-`cancelled` events (or their own `private`
events) in the first place — the archive query's own filter is a second,
narrower layer on top of that. Net effect: **private events never appear in
Arkivet, cancelled events never appear, and only events whose _template_ was
seeded `archive = true` (and whose challenge had `archive_enabled` on at
emission time) appear.**

It is a chronicle, not a feed: `GameMasterArchive` renders a read-only list —
no likes, no comments, no reply, no participant posting, nothing to compose.
Game Master writes the history; participants only read it.

Note: `status = 'expired'` is a modelled state (in the `game_master_events`
CHECK constraint and the frontend `GameMasterEventStatus` type) but GM1 never
transitions an event into it — no scheduled job flips `active → expired`. The
14-day `expires_at` set at emission only affects the **ambush** surface
(`fetchNextGameMasterEvent` filters `expires_at is null or expires_at >
now()`); Arkivet ignores `expires_at` entirely, by design — a chronicle
should not lose entries just because their in-app nudge window passed.

---

## 8. No AI in GM1 — and GM2/GM3/GM4 are deferred

GM1 ships **zero** AI/LLM dependency: no API key, no external call, no
generated text at any point. Every title/body is one of the 96 hand-written
rows above, verbatim except for the 12 placeholder substitutions. `_game_master_render`
only ever does string replacement.

Per spec §19, later phases are **not** implemented on this branch and there
is no scaffolding for them beyond what's noted above (the dormant
`general_system` family, the `final_weight` column):

- **GM2** — machine-verifiable competitions (`first_valid_live_log`),
  competition participants, a token ledger, the pixel-dumbbell Competition
  Token, invalidation/recompute. Not built: no `competitions`,
  `competition_participants` or token-ledger table exists.
- **GM3** — automatic rivalry detection, temporary titles (KASSÖR,
  STREAK-BYRÅKRAT, …), richer memory/storyline scoring. Not built: no
  rivalry or title table exists.
- **GM4** — finale mode: FM Atlet lore, weight-loss drama, countdown,
  recap/chronicle, final-day closure. Not built beyond the finale
  _escalation curve_ (§3 above), which is general-purpose and already used by
  every GM1 family.

---

## 9. Deployment rule — Cloudflare pause/unpause for a migration-bearing phase

GM1 ships three new migrations. Per spec §20, whenever a phase adds database
migrations, the Cloudflare deploy must be **paused** before merging so `main`
never serves a build that expects a schema not yet live, then **unpaused**
after the migration and type regeneration are confirmed. This mirrors how
[`docs/DEPLOYMENT.md`](./DEPLOYMENT.md) documents the rest of the hosted
setup (Cloudflare Worker with Static Assets, git-connected to `main`).

### 9.1 Pause

Cloudflare dashboard → Workers & Pages → the `halsoutmaningen` Worker →
Settings → Builds → **Deploy command**.

Change:

```
npx wrangler deploy
```

to:

```
npx wrangler versions upload --assets=./dist
```

Save. From this point, a push to `main` still **builds** the Worker (so CI
build failures are still caught) but uploads a version **without** promoting
it to production traffic — the live site keeps serving the pre-GM1 build.

### 9.2 Merge and migrate

```bash
cd ~/projects/halsoutmaningen
git switch main
git pull --ff-only
git status              # must be clean

npx supabase db push --project-ref offvlyflactysibrssco
```

Expect exactly these three migrations to apply:

- `20260904130000_game_master_foundation.sql`
- `20260904130100_game_master_engine.sql`
- `20260904130200_game_master_templates.sql`

### 9.3 Regenerate types and re-run every gate

```bash
npm run db:types
npm run typecheck
npm run lint
npm run test
npm run build
npm run format:check
git status
```

If `src/types/database.ts` is the only diff:

```bash
git add src/types/database.ts
git commit -m "chore: regenerate types after game master gm1"
git push
```

This is also the point where the `// TODO(gm1-types)` casts in
`game-master-api.ts` / `game-master-admin-api.ts`
(`supabase as unknown as SupabaseClient`) become safe to remove in a later,
separate cleanup — they exist only because the generated `Database` type
cannot know about GM1's tables/RPCs until this step runs.

### 9.4 Unpause

Cloudflare dashboard → Workers & Pages → the `halsoutmaningen` Worker →
Settings → Builds → **Deploy command**.

Change back:

```
npx wrangler versions upload --assets=./dist
```

to:

```
npx wrangler deploy
```

Save, then retry the latest `main` build so it actually promotes to
production.

### 9.5 Live smoke test

- normal participant can still log training normally;
- Game Master disabled for the challenge → no visible change anywhere, core
  screens unchanged;
- Game Master enabled at normal intensity → an ambush can eventually appear,
  but silence for a while is expected and correct;
- `/admin/game-master` loads for an admin; a participant hitting it is
  redirected away;
- `/arkivet` loads;
- dismissing an ambush ("Noterat") prevents it reappearing on refresh;
- a public archived event appears in Arkivet; a private event never does,
  from any account other than its subject or an admin;
- normal training logging still works if the Game Master pulse RPC is made to
  fail (e.g. by temporarily disabling `game_master_settings.enabled`, which
  routes every pulse straight to `outcome = 'disabled'`);
- the `pg_cron` job `halsoutmaningen-game-master-hourly` exists
  (`select * from cron.job where jobname = 'halsoutmaningen-game-master-hourly';`)
  and a `source = 'scheduled'` row appears in `game_master_runs` after the
  next local 08 or 20 window;
- KASSAN total, streaks, ranking order, Straffbanken and efterregistrering are
  all unchanged by any Game Master activity.

Do not add a permanent "roast now" UI to make this smoke test more
convenient — none exists by design (§6).
