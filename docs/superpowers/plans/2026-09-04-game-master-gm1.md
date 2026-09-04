# Game Master GM1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an isolated, autonomous Game Master foundation that occasionally creates private/public hand-written roasts from authoritative challenge data, remembers what it emitted, escalates softly toward the finale, exposes an archive/admin emergency brake, and can fail without affecting the core challenge.

**Architecture:** GM1 is a separate Supabase-backed subsystem. The server owns candidate generation, scoring, cooldowns, randomness and persistence; the browser only requests best-effort pulses, fetches eligible events, marks views, and renders them. A Supabase cron dispatcher supplies scheduled morning/evening pulses. No Game Master table or function may participate in determining training validity, debt, KASSAN, streak, ranking, Straffbanken or afterregistration.

**Tech Stack:** React + TypeScript + Vite, TanStack Query, Supabase Postgres 17/RLS/RPC/pg_cron, Vitest + Testing Library, pgTAP, existing UI components (`Card`, `Button`, `Badge`, `Sheet`, `ConfirmSheet`, `PageHeader`).

**Spec:** `docs/superpowers/specs/2026-09-04-game-master-v1-design.md`

## Global Constraints

- Preserve the existing five-item bottom navigation and mobile-first visual design.
- No AI.
- No Game Master push notifications.
- No competitions, tokens, rivalries or titles in GM1.
- No service-role credentials in the browser.
- All SECURITY DEFINER functions use `SET search_path = ''`, schema-qualified names, explicit auth checks, and revoke EXECUTE from PUBLIC/anon.
- Game Master failure must never roll back or block core training/admin operations.
- Participant-triggered pulse calls accept only `challenge_id`; they never accept target user, template, score or text.
- Pending/archived Game Master state must never feed core challenge calculations.
- Public archive contains only `public` archival events.
- Private events are readable only by their subject and admins.
- Every admin setting/cancellation change is audited.
- Templates are frozen into event title/body/payload when emitted.
- Unknown template placeholders are rejected.
- Random tests must be deterministic via an internal test-only roll/seed path that is not granted to application roles.
- Full local gates required: `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`, `npm run format:check`.
- Full migration chain + pgTAP must pass in GitHub Actions before merge.
- Do not `supabase db push`, merge, or deploy automatically.

---

## File map

### Database
- Create: `supabase/migrations/20260904130000_game_master_foundation.sql`
  - tables, constraints, RLS, indexes, audit vocabulary, template validation
- Create: `supabase/migrations/20260904130100_game_master_engine.sql`
  - scoring helpers, candidate generation, pulse functions, mark-view/cancel/settings RPCs, cron dispatcher
- Create: `supabase/migrations/20260904130200_game_master_templates.sql`
  - 96 hand-written V1 templates
- Create: `supabase/tests/0015_game_master_foundation.test.sql`
- Create: `supabase/tests/0016_game_master_engine.test.sql`
- Create: `supabase/tests/0017_game_master_rls_audit_cron.test.sql`

### Domain / frontend adapter
- Create: `src/features/game-master/types.ts`
- Create: `src/features/game-master/game-master.ts`
- Create: `src/features/game-master/game-master.test.ts`
- Create: `src/features/game-master/game-master-api.ts`
- Create: `src/features/game-master/useGameMaster.ts`
- Create: `src/features/game-master/GameMasterAmbush.tsx`
- Create: `src/features/game-master/GameMasterAmbush.css`
- Create: `src/features/game-master/GameMasterAmbush.test.tsx`
- Create: `src/features/game-master/GameMasterArchive.tsx`
- Create: `src/features/game-master/GameMasterArchive.css`
- Create: `src/features/game-master/GameMasterArchive.test.tsx`

### Pages / admin
- Create: `src/pages/GameMasterArchivePage.tsx`
- Create: `src/pages/GameMasterArchivePage.css`
- Create: `src/pages/admin/GameMasterPage.tsx`
- Create: `src/pages/admin/GameMasterPage.css`
- Create: `src/features/admin/game-master-admin-api.ts`
- Create: `src/features/admin/GameMasterSettingsPanel.tsx`
- Create: `src/features/admin/GameMasterSettingsPanel.test.tsx`
- Create: `src/features/admin/GameMasterRunLog.tsx`

### Integration
- Modify: `src/app/AppRoutes.tsx`
- Modify: `src/pages/GroupPage.tsx`
- Modify: `src/pages/GroupPage.css`
- Modify: `src/pages/AdminPage.tsx`
- Modify: `src/pages/AdminPage.css`
- Modify: `src/features/challenge/submit-training.ts`
- Modify: `src/types/database.ts` only as temporary compile bridge if required; regenerate from hosted schema after production migration
- Modify: `src/pages.smoke.test.tsx`
- Create or modify the authenticated app-level component that already wraps the normal logged-in routes; mount `GameMasterAmbush` there. If the current repo has no single authenticated shell component, mount it in `AppRoutes.tsx` immediately inside the authenticated route layout rather than creating a second navigation shell.

### Docs
- Create: `docs/superpowers/specs/2026-09-04-game-master-v1-design.md`
- Create: `docs/superpowers/plans/2026-09-04-game-master-gm1.md`
- Create: `docs/GAME_MASTER.md`

---

### Task 1: Freeze the approved design and establish pure frontend types

**Files:**
- Create: `docs/superpowers/specs/2026-09-04-game-master-v1-design.md`
- Create: `docs/superpowers/plans/2026-09-04-game-master-gm1.md`
- Create: `src/features/game-master/types.ts`
- Create: `src/features/game-master/game-master.ts`
- Create: `src/features/game-master/game-master.test.ts`

**Interfaces:**
- Produces:
  - `GameMasterVisibility = 'private' | 'public'`
  - `GameMasterEventStatus = 'active' | 'expired' | 'cancelled'`
  - `GameMasterIntensity = 'low' | 'normal' | 'high'`
  - `GameMasterSeverity = 1 | 2 | 3 | 4 | 5`
  - `GameMasterEvent`
  - `GameMasterSettings`
  - `presentationForSeverity(severity): 'micro' | 'sheet'`
  - `intensityMultiplier(intensity): number`
  - `escalationMultiplier(startDate, endDate, today): number`

- [ ] **Step 1: Write failing pure-domain tests**

```ts
import { describe, expect, it } from 'vitest';
import {
  escalationMultiplier,
  intensityMultiplier,
  presentationForSeverity,
} from './game-master';

describe('game-master presentation', () => {
  it('uses micro for severity 1-2 and sheet for 3-5', () => {
    expect(presentationForSeverity(1)).toBe('micro');
    expect(presentationForSeverity(2)).toBe('micro');
    expect(presentationForSeverity(3)).toBe('sheet');
    expect(presentationForSeverity(5)).toBe('sheet');
  });
});

describe('game-master intensity', () => {
  it('uses the approved multipliers', () => {
    expect(intensityMultiplier('low')).toBe(0.65);
    expect(intensityMultiplier('normal')).toBe(1);
    expect(intensityMultiplier('high')).toBe(1.35);
  });
});

describe('final escalation', () => {
  it('starts near 0.7 and approaches 1.7 at the finale', () => {
    expect(escalationMultiplier('2026-09-01', '2026-11-28', '2026-09-01')).toBeCloseTo(0.7, 4);
    expect(escalationMultiplier('2026-09-01', '2026-11-28', '2026-11-28')).toBeCloseTo(1.7, 4);
  });
});
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run:

```bash
npm run test -- src/features/game-master/game-master.test.ts
```

Expected: fail because module/functions do not exist.

- [ ] **Step 3: Add exact pure implementation**

```ts
import type { GameMasterIntensity, GameMasterSeverity } from './types';

export function presentationForSeverity(
  severity: GameMasterSeverity,
): 'micro' | 'sheet' {
  return severity <= 2 ? 'micro' : 'sheet';
}

export function intensityMultiplier(intensity: GameMasterIntensity): number {
  if (intensity === 'low') return 0.65;
  if (intensity === 'high') return 1.35;
  return 1;
}

export function escalationMultiplier(
  startDate: string,
  endDate: string,
  today: string,
): number {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  const current = Date.parse(`${today}T00:00:00Z`);
  if (end <= start) return 1.7;
  const p = Math.max(0, Math.min(1, (current - start) / (end - start)));
  return 0.7 + p * p;
}
```

`types.ts` must define the interfaces used by later tasks:

```ts
export type GameMasterVisibility = 'private' | 'public';
export type GameMasterEventStatus = 'active' | 'expired' | 'cancelled';
export type GameMasterIntensity = 'low' | 'normal' | 'high';
export type GameMasterSeverity = 1 | 2 | 3 | 4 | 5;

export interface GameMasterEvent {
  id: string;
  challengeId: string;
  family: string;
  visibility: GameMasterVisibility;
  subjectUserId: string | null;
  title: string;
  body: string;
  severity: GameMasterSeverity;
  archive: boolean;
  startsAt: string;
  expiresAt: string | null;
  status: GameMasterEventStatus;
  firstSeenAt: string | null;
  dismissedAt: string | null;
}

export interface GameMasterSettings {
  challengeId: string;
  enabled: boolean;
  privateRoastsEnabled: boolean;
  publicRoastsEnabled: boolean;
  archiveEnabled: boolean;
  intensity: GameMasterIntensity;
}
```

- [ ] **Step 4: Run focused tests**

```bash
npm run test -- src/features/game-master/game-master.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-09-04-game-master-v1-design.md \
        docs/superpowers/plans/2026-09-04-game-master-gm1.md \
        src/features/game-master/types.ts \
        src/features/game-master/game-master.ts \
        src/features/game-master/game-master.test.ts
git commit -m "docs: define game master v1 and gm1 plan"
```

---

### Task 2: Add Game Master persistence, RLS and template validation

**Files:**
- Create: `supabase/migrations/20260904130000_game_master_foundation.sql`
- Create: `supabase/tests/0015_game_master_foundation.test.sql`

**Interfaces:**
- Produces tables:
  - `game_master_settings`
  - `game_master_templates`
  - `game_master_events`
  - `game_master_event_views`
  - `game_master_memories`
  - `game_master_runs`
- Produces helper:
  - `public._game_master_validate_template(text) returns boolean`
- No participant/admin direct writes except where explicitly granted later through RPCs.

- [ ] **Step 1: Write pgTAP tests first**

Test exact invariants:
- settings defaults to enabled/normal
- template severity restricted to 1..5
- visibility restricted to private/public
- event status restricted to active/expired/cancelled
- private event requires subject
- event body/title are frozen columns
- duplicate view `(event_id,user_id)` rejected
- memory fingerprint is unique per challenge
- unknown template placeholder rejected
- allowed placeholder accepted
- participant cannot insert/update/delete event/template/memory/run directly
- admin cannot bypass the RPC write model by direct mutation if the table has no write policy

Use current fixture conventions from existing `supabase/tests/*.sql`; do not invent a second JWT fixture style.

- [ ] **Step 2: Run Database Tests on a feature branch and confirm the new file fails**

The project has no local Docker on this VM. Push the failing test on the feature branch and run the existing GitHub Actions `Database Tests` workflow.

Expected: migration objects do not exist.

- [ ] **Step 3: Implement the foundation migration**

Required columns:

```sql
create table public.game_master_settings (
  challenge_id uuid primary key references public.challenges(id) on delete cascade,
  enabled boolean not null default true,
  private_roasts_enabled boolean not null default true,
  public_roasts_enabled boolean not null default true,
  archive_enabled boolean not null default true,
  intensity text not null default 'normal'
    check (intensity in ('low','normal','high')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.game_master_templates (
  id uuid primary key default gen_random_uuid(),
  template_key text not null unique,
  family text not null,
  visibility text not null check (visibility in ('private','public')),
  severity smallint not null check (severity between 1 and 5),
  title_template text not null,
  body_template text not null,
  weight numeric not null default 1 check (weight > 0),
  cooldown_hours integer not null default 72 check (cooldown_hours >= 0),
  once_per_subject boolean not null default false,
  archive boolean not null default true,
  final_weight numeric not null default 1 check (final_weight > 0),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.game_master_events (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.challenges(id) on delete cascade,
  family text not null,
  visibility text not null check (visibility in ('private','public')),
  subject_user_id uuid references public.profiles(id),
  template_id uuid references public.game_master_templates(id),
  severity smallint not null check (severity between 1 and 5),
  title_text text not null,
  body_text text not null,
  payload jsonb not null default '{}'::jsonb,
  archive boolean not null default true,
  status text not null default 'active'
    check (status in ('active','expired','cancelled')),
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles(id),
  cancelled_reason text,
  created_at timestamptz not null default now(),
  check (visibility <> 'private' or subject_user_id is not null),
  check (
    (status <> 'cancelled' and cancelled_at is null and cancelled_by is null and cancelled_reason is null)
    or
    (status = 'cancelled' and cancelled_at is not null and cancelled_by is not null and length(btrim(cancelled_reason)) > 0)
  )
);

create table public.game_master_event_views (
  event_id uuid not null references public.game_master_events(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  first_seen_at timestamptz not null default now(),
  dismissed_at timestamptz,
  primary key (event_id,user_id)
);

create table public.game_master_memories (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.challenges(id) on delete cascade,
  subject_user_id uuid references public.profiles(id),
  memory_type text not null,
  fingerprint text not null,
  memory_date date not null,
  importance smallint not null check (importance between 1 and 5),
  payload jsonb not null default '{}'::jsonb,
  earliest_callback_at timestamptz,
  expires_at timestamptz,
  callback_count integer not null default 0 check (callback_count >= 0),
  created_at timestamptz not null default now(),
  unique (challenge_id,fingerprint)
);

create table public.game_master_runs (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.challenges(id) on delete cascade,
  source text not null check (source in ('event','scheduled')),
  outcome text not null check (outcome in ('event','silence','disabled','cooldown','error')),
  candidate_count integer not null default 0 check (candidate_count >= 0),
  eligible_count integer not null default 0 check (eligible_count >= 0),
  selected_event_id uuid references public.game_master_events(id),
  diagnostics jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);
```

Add indexes for:
- events `(challenge_id, created_at desc)`
- events `(challenge_id, status, starts_at)`
- events `(subject_user_id, created_at desc)`
- events `(template_id, created_at desc)`
- runs `(challenge_id, started_at desc)`
- memories `(challenge_id, subject_user_id, memory_type)`
- templates `(family, enabled)`

Template validation:
- allow only placeholders listed in the approved spec
- a trigger on insert/update rejects unknown `{...}` placeholders in both title/body

RLS:
- templates/settings/memories/runs: admin SELECT only
- events: admin OR public+challenge-member OR private+subject
- views: owner SELECT only
- no table write policies for participants; later RPCs perform mutation

Update existing audit vocabulary/checks only as required for:
- `game_master_settings_changed`
- `game_master_event_cancelled`

- [ ] **Step 4: Run Database Tests**

Expected: `0015_game_master_foundation.test.sql` PASS and all prior files still PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260904130000_game_master_foundation.sql \
        supabase/tests/0015_game_master_foundation.test.sql
git commit -m "feat(game-master): add isolated persistence foundation"
```

---

### Task 3: Implement server-authoritative candidate scoring, silence and pulses

**Files:**
- Create: `supabase/migrations/20260904130100_game_master_engine.sql`
- Create: `supabase/tests/0016_game_master_engine.test.sql`

**Interfaces:**
- Produces internal functions:
  - `public._game_master_escalation(challenge_id uuid) returns numeric`
  - `public._game_master_intensity(challenge_id uuid) returns numeric`
  - `public._game_master_render(text,jsonb) returns text`
  - `public._game_master_candidates(challenge_id uuid) returns table(...)`
  - `public._run_game_master_pulse(challenge_id uuid, source text, forced_roll numeric default null) returns uuid`
  - `public._game_master_tick_all() returns void`
- Produces authenticated RPCs:
  - `public.request_game_master_pulse(challenge_id uuid) returns uuid`
  - `public.mark_game_master_event_seen(event_id uuid, dismiss boolean default false) returns void`
- Produces admin RPCs:
  - `public.update_game_master_settings(challenge_id uuid, enabled boolean, private_roasts_enabled boolean, public_roasts_enabled boolean, archive_enabled boolean, intensity text) returns void`
  - `public.cancel_game_master_event(event_id uuid, reason text) returns void`

- [ ] **Step 1: Write deterministic pgTAP cases**

Cover:
- non-member cannot request a pulse
- member may request pulse but cannot choose victim/template/content
- disabled Game Master returns no event and records `disabled`
- global cooldown records `cooldown`
- low-score/forced high roll records `silence`
- forced low roll emits an eligible event
- only one event per pulse
- private/public toggles filter candidates correctly
- same subject blocked inside subject cooldown
- same family blocked inside family cooldown
- exact template obeys cooldown/once-per-subject
- event stores rendered text and payload
- later source-data changes do not rewrite existing title/body
- repeated deterministic retry does not duplicate a logically identical threshold event
- escalation early < middle < finale
- intensity low < normal < high
- severity-5 template receives its stronger once/cooldown behavior
- `mark_game_master_event_seen` only marks events the caller can read
- user cannot mark another user's private event
- admin cancellation requires reason and hides the event from participant queries
- malformed template rendering cannot fail a core training insert because no core trigger calls the engine

- [ ] **Step 2: Push failing test and run CI**

Expected: fail because engine functions do not exist.

- [ ] **Step 3: Implement exact candidate families for GM1**

GM1 candidate families must use authoritative DB-derived values only:

1. `missed_day`
   - a newly missed eligible day in the last 48 hours
   - magnitude increases with recent missed count
2. `streak_long`
   - active streak crossing 7/14/21/30/45/60
   - fingerprint includes user+threshold so each threshold is naturally idempotent
3. `streak_broken`
   - most recently ended streak >= 5 days
   - magnitude scales with previous streak
   - store a narrative memory when previous streak >= 14
4. `debt_leader`
   - current highest positive liability
   - no event if all debt is zero
5. `kassan`
   - total liability bucketed by 1,000 SEK
   - fingerprint includes bucket so the same bucket does not emit repeatedly
6. `comeback`
   - user with current streak >= 7 after a stored >=14-day streak-collapse memory
7. `ranking_position`
   - current top or bottom placement only; do not implement historical overtake detection in GM1
8. `historic_callback`
   - eligible stored memory older than its `earliest_callback_at`
9. `general_system`
   - low-weight generic observation; never used to defeat all silence and spam the group

Every candidate returns:
- `family`
- `subject_user_id`
- `visibility`
- `score`
- `payload`
- `fingerprint`

`_run_game_master_pulse`:
1. verifies settings
2. enforces minimum any-event cooldown
3. generates candidates
4. applies visibility/family/subject/template cooldowns
5. discards scores < 35
6. weighted-selects one candidate using `score²`
7. computes emission probability using approved intensity/escalation formula
8. uses `forced_roll` only when internal caller provides it; public wrapper always passes NULL
9. returns silence when roll loses
10. selects one enabled eligible template from candidate family
11. renders only approved placeholders
12. freezes title/body/payload into `game_master_events`
13. inserts a `game_master_runs` row for every pulse outcome
14. stores major memories idempotently
15. returns emitted event id or NULL

The exposed `request_game_master_pulse`:
- requires authenticated active challenge member/admin
- accepts only `challenge_id`
- applies a server-side minimum request interval so client spam is harmless
- calls `_run_game_master_pulse(...,'event',NULL)`

- [ ] **Step 4: Add scheduled dispatcher**

Enable/use `pg_cron` following the repository's Supabase migration conventions.

Schedule one hourly job, e.g.:

```sql
select cron.schedule(
  'halsoutmaningen-game-master-hourly',
  '17 * * * *',
  $$select public._game_master_tick_all();$$
);
```

`_game_master_tick_all()`:
- loops active challenges with Game Master enabled
- computes local challenge hour from `challenges.timezone`
- only runs scheduled pulse in local hour 08 or 20
- checks `game_master_runs` so each local `{date,hour}` window runs once
- never throws out of the per-challenge loop; catch and record error per challenge

The cron job must call an internal function with no EXECUTE grant to app roles.

- [ ] **Step 5: Run CI Database Tests**

Expected: new engine suite PASS; all old suites PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260904130100_game_master_engine.sql \
        supabase/tests/0016_game_master_engine.test.sql
git commit -m "feat(game-master): add sparse autonomous pulse engine"
```

---

### Task 4: Seed the 96-template roast bank

**Files:**
- Create: `supabase/migrations/20260904130200_game_master_templates.sql`
- Extend: `supabase/tests/0015_game_master_foundation.test.sql`

**Interfaces:**
- Produces exactly 96 enabled V1 templates on a clean migration chain.

- [ ] **Step 1: Add failing seed assertions**

Assert:
- total enabled templates = 96
- all nine approved families are represented
- severity 1–5 all represented
- exactly 16 templates have severity 5
- every severity-5 template has `once_per_subject=true` OR `cooldown_hours >= 336`
- no unknown placeholders
- private and public templates both exist
- no template contains token/competition/title copy in GM1
- no template changes core outcomes

- [ ] **Step 2: Run CI and confirm failure**

Expected: template count is 0.

- [ ] **Step 3: Seed exactly this distribution**

- `missed_day`: 14
- `streak_long`: 12
- `streak_broken`: 14
- `debt_leader`: 10
- `kassan`: 10
- `comeback`: 10
- `ranking_position`: 8
- `historic_callback`: 10
- `general_system`: 8

Total: 96.

Copy rules:
- Swedish
- dry/system voice
- no emojis required in roast body
- no protected-trait jokes
- no body/appearance insults in the weight-loss context
- harshness targets behavior/performance/ego/history
- 16 severity-5 entries
- public severity-5 is rarer than private severity-5
- minimum 14-day same-template cooldown for severity 5
- no template promises a competition reward

Representative SQL row format:

```sql
insert into public.game_master_templates (
  template_key, family, visibility, severity,
  title_template, body_template,
  weight, cooldown_hours, once_per_subject, archive, final_weight
) values (
  'missed_day_001',
  'missed_day',
  'private',
  3,
  'SYSTEMET HAR NOTERAT EN AVVIKELSE',
  'Kravet var 30 minuter. Dygnet innehöll 1 440.',
  1.0,
  96,
  false,
  false,
  1.0
);
```

Required examples to include verbatim or with only placeholder substitution:

```text
SYSTEMET HAR NOTERAT EN AVVIKELSE
Kravet var 30 minuter. Dygnet innehöll 1 440.
```

```text
INCIDENTRAPPORT
{name} misslyckades med att hitta 30 minuter under ett helt dygn. Försvarsmaktens fortsatta existens bedöms tills vidare inte vara hotad.
```

```text
KASSAN
Gruppen har nu gemensamt misslyckats ihop till {kassan_sek} kr. Det börjar likna en finansieringsmodell.
```

```text
STATUS
{name} har {streak} dagar i rad. Självförtroendet bedöms nu ligga farligt långt före den dokumenterade atletiska förmågan.
```

```text
HISTORIK
Förra gången {name} nådde hit tog det därefter ungefär ett dygn att återställa ordningen.
```

At least one severity-5 missed-day template should preserve the approved cold precision style rather than merely adding profanity.

- [ ] **Step 4: Run DB CI**

Expected: 96-template assertions PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260904130200_game_master_templates.sql \
        supabase/tests/0015_game_master_foundation.test.sql
git commit -m "feat(game-master): seed the v1 roast bank"
```

---

### Task 5: Add typed API and best-effort event pulse

**Files:**
- Create: `src/features/game-master/game-master-api.ts`
- Create: `src/features/game-master/useGameMaster.ts`
- Create: `src/features/game-master/game-master-api.test.ts`
- Modify: `src/features/challenge/submit-training.ts`

**Interfaces:**
- Produces:
  - `requestGameMasterPulse(challengeId): Promise<string | null>`
  - `fetchNextGameMasterEvent(challengeId): Promise<GameMasterEvent | null>`
  - `fetchGameMasterArchive(challengeId): Promise<GameMasterEvent[]>`
  - `markGameMasterEventSeen(eventId, dismiss): Promise<void>`
  - `useNextGameMasterEvent(challengeId)`
  - `useGameMasterArchive(challengeId)`
  - `useRequestGameMasterPulse()`

- [ ] **Step 1: Write failing API tests**

Mock Supabase and assert:
- pulse RPC receives only challenge id
- no user id/template/body/score is sent
- next-event query respects current user through RLS rather than client-side subject filtering as security
- archive query requests active, public, archive=true events
- mark-view calls protected RPC
- pulse failure is swallowable by a caller using best-effort wrapper

- [ ] **Step 2: Run focused tests; confirm fail**

```bash
npm run test -- src/features/game-master/game-master-api.test.ts
```

- [ ] **Step 3: Implement adapter and hook**

Use the repository's existing Supabase/TanStack Query conventions.

After a successful normal training submit in `submit-training.ts`, invoke the pulse **after** the core submit has returned success:

```ts
void requestGameMasterPulse(challengeId).catch(() => undefined);
```

Do not await this call in the core success path.
Do not change the result returned by normal logging.
Do not call it for retroactive-registration approval in GM1.

Also request one best-effort pulse when the authenticated app becomes active for the first time in a browser session; dedupe client-side with a `sessionStorage` key per challenge. Server-side throttling remains authoritative.

- [ ] **Step 4: Test core isolation**

Add/extend a training-submit test:

```ts
it('keeps a successful training submit successful when Game Master pulse fails', async () => {
  // normal training RPC succeeds
  // Game Master pulse rejects
  // expect submit result to remain successful
});
```

- [ ] **Step 5: Run focused + full JS tests**

```bash
npm run test -- src/features/game-master/game-master-api.test.ts
npm run test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/game-master/game-master-api.ts \
        src/features/game-master/useGameMaster.ts \
        src/features/game-master/game-master-api.test.ts \
        src/features/challenge/submit-training.ts
git commit -m "feat(game-master): connect best-effort event pulses"
```

---

### Task 6: Build private/public ambush presentation

**Files:**
- Create: `src/features/game-master/GameMasterAmbush.tsx`
- Create: `src/features/game-master/GameMasterAmbush.css`
- Create: `src/features/game-master/GameMasterAmbush.test.tsx`
- Modify: authenticated route layout in `src/app/AppRoutes.tsx` or the existing shared authenticated shell if one exists

**Interfaces:**
- Consumes `useNextGameMasterEvent`
- Calls `markGameMasterEventSeen`
- Severity 1–2 → micro presentation
- Severity 3–5 → existing `Sheet`
- At most one unseen event presented at a time

- [ ] **Step 1: Write failing component tests**

Cases:
- no event → renders nothing
- severity 1 → small non-blocking system banner
- severity 3 → Sheet
- severity 5 → Sheet, not full-screen
- private event copy renders frozen title/body
- dismissal marks event dismissed
- public event is only shown once per current user after view mutation/refetch
- accessibility: system title present; dismiss control has accessible name
- component error/loading never blocks the app shell

- [ ] **Step 2: Run test and confirm fail**

```bash
npm run test -- src/features/game-master/GameMasterAmbush.test.tsx
```

- [ ] **Step 3: Implement using existing UI primitives**

Copy guidance:
- eyebrow: `SYSTEMET`
- no cartoon styling
- no new bottom nav item
- severity 1–2 micro container must not cover primary controls
- severity 3–5 use `Sheet`
- one discrete dismiss action: `Noterat`

On first render, mark `first_seen_at`; dismissal additionally sets `dismissed_at`.

- [ ] **Step 4: Mount globally inside authenticated app only**

Mount once around authenticated pages, after auth/challenge context exists.

Never mount on login/activation routes.

- [ ] **Step 5: Run focused/full tests and build**

```bash
npm run test -- src/features/game-master/GameMasterAmbush.test.tsx
npm run test
npm run build
```

- [ ] **Step 6: Commit**

```bash
git add src/features/game-master/GameMasterAmbush.tsx \
        src/features/game-master/GameMasterAmbush.css \
        src/features/game-master/GameMasterAmbush.test.tsx \
        src/app/AppRoutes.tsx
git commit -m "feat(game-master): add sparse in-app ambushes"
```

---

### Task 7: Add Arkivet without creating a social feed

**Files:**
- Create: `src/features/game-master/GameMasterArchive.tsx`
- Create: `src/features/game-master/GameMasterArchive.css`
- Create: `src/features/game-master/GameMasterArchive.test.tsx`
- Create: `src/pages/GameMasterArchivePage.tsx`
- Create: `src/pages/GameMasterArchivePage.css`
- Modify: `src/pages/GroupPage.tsx`
- Modify: `src/pages/GroupPage.css`
- Modify: `src/app/AppRoutes.tsx`
- Modify: `src/pages.smoke.test.tsx`

**Interfaces:**
- New route: `/arkivet`
- Requires normal authentication
- Public archive only
- No likes/comments/post composer

- [ ] **Step 1: Write failing archive tests**

Assert:
- chronological reverse order
- only public + archive=true + non-cancelled events
- private events never render
- cancelled events never render
- date + family/system label + frozen title/body
- empty state is understated
- no like/comment/post controls exist

- [ ] **Step 2: Run test and confirm fail**

```bash
npm run test -- src/features/game-master/GameMasterArchive.test.tsx
```

- [ ] **Step 3: Implement archive component/page**

Group page gets one discrete card:

```text
ARKIVET
Systemets officiella historieskrivning.
```

Do not add a bottom-nav tab.

- [ ] **Step 4: Add route and smoke coverage**

`/arkivet` sits behind normal authentication, not admin-only.

- [ ] **Step 5: Run focused/full tests**

```bash
npm run test -- src/features/game-master/GameMasterArchive.test.tsx
npm run test
```

- [ ] **Step 6: Commit**

```bash
git add src/features/game-master/GameMasterArchive.tsx \
        src/features/game-master/GameMasterArchive.css \
        src/features/game-master/GameMasterArchive.test.tsx \
        src/pages/GameMasterArchivePage.tsx \
        src/pages/GameMasterArchivePage.css \
        src/pages/GroupPage.tsx \
        src/pages/GroupPage.css \
        src/app/AppRoutes.tsx \
        src/pages.smoke.test.tsx
git commit -m "feat(game-master): add the challenge archive"
```

---

### Task 8: Add admin emergency brake and observability

**Files:**
- Create: `src/features/admin/game-master-admin-api.ts`
- Create: `src/features/admin/GameMasterSettingsPanel.tsx`
- Create: `src/features/admin/GameMasterSettingsPanel.test.tsx`
- Create: `src/features/admin/GameMasterRunLog.tsx`
- Create: `src/pages/admin/GameMasterPage.tsx`
- Create: `src/pages/admin/GameMasterPage.css`
- Modify: `src/pages/AdminPage.tsx`
- Modify: `src/pages/AdminPage.css`
- Modify: `src/app/AppRoutes.tsx`

**Interfaces:**
- Route: `/admin/game-master`
- Uses admin RPCs defined in Task 3
- No “roast now” action

- [ ] **Step 1: Write failing settings tests**

Assert:
- master on/off
- private/public/archive toggles
- intensity low/normal/high
- save calls one server RPC
- participant route blocked by existing `RequireAdmin`
- event cancellation requires non-empty reason
- no UI exists to choose a participant/template or manually emit a roast

- [ ] **Step 2: Implement admin adapter**

Functions:
- `fetchGameMasterSettings(challengeId)`
- `updateGameMasterSettings(settings)`
- `fetchGameMasterRuns(challengeId, limit=50)`
- `fetchRecentGameMasterEvents(challengeId, limit=50)`
- `cancelGameMasterEvent(eventId, reason)`

- [ ] **Step 3: Implement page**

Sections:
1. **Game Master**
   - enabled switch
   - low / normal / high segmented control
2. **Innehåll**
   - privata roasts
   - publika roasts
   - Arkivet
3. **Senaste beslut**
   - timestamp
   - source
   - outcome
   - candidates/eligible
   - selected family if event
4. **Senaste events**
   - title, family, visibility, severity
   - cancel/hide action with `ConfirmSheet` + mandatory reason

No manual pulse/roast button.

- [ ] **Step 4: Add admin route/card**

Admin overview card:

```text
GAME MASTER
Autonomt överraskningslager, nödbroms och historik.
```

- [ ] **Step 5: Run component/full tests**

```bash
npm run test -- src/features/admin/GameMasterSettingsPanel.test.tsx
npm run test
npm run build
```

- [ ] **Step 6: Commit**

```bash
git add src/features/admin/game-master-admin-api.ts \
        src/features/admin/GameMasterSettingsPanel.tsx \
        src/features/admin/GameMasterSettingsPanel.test.tsx \
        src/features/admin/GameMasterRunLog.tsx \
        src/pages/admin/GameMasterPage.tsx \
        src/pages/admin/GameMasterPage.css \
        src/pages/AdminPage.tsx \
        src/pages/AdminPage.css \
        src/app/AppRoutes.tsx
git commit -m "feat(game-master): add admin emergency brake"
```

---

### Task 9: Prove RLS, audit, cron and failure isolation

**Files:**
- Create: `supabase/tests/0017_game_master_rls_audit_cron.test.sql`
- Modify migration files only if this suite reveals a real defect

**Interfaces:**
- Security proof for GM1.

- [ ] **Step 1: Add exact security tests**

Assert:
- participant sees own private event
- participant cannot see another user's private event
- challenge member sees public event
- non-member sees no event
- admin sees all
- participants cannot read settings/templates/memories/runs
- participants cannot insert/update/delete those tables
- participant cannot call admin settings/cancel RPCs
- admin cancellation reason mandatory
- cancellation produces audit row with actor/reason/event id and no secrets
- settings change produces audit row
- public wrapper cannot supply `forced_roll`
- internal `_run_game_master_pulse` has no EXECUTE grant for `authenticated`, `anon`, PUBLIC
- internal scheduler has no app-role execute grant
- scheduled run executes once per local challenge window
- disabled settings prevent scheduled emission
- core `training_entries` insert succeeds with Game Master disabled
- core training logic has no FK/reference to Game Master tables
- dropping/raising inside a test-only GM function path does not change authoritative day state, liability or streak

- [ ] **Step 2: Run GitHub Database Tests**

Expected: all prior suites + 0015–0017 PASS.

- [ ] **Step 3: Fix only genuine failures**

Do not weaken existing RLS/guards to make Game Master tests pass.

- [ ] **Step 4: Commit**

```bash
git add supabase/tests/0017_game_master_rls_audit_cron.test.sql \
        supabase/migrations/20260904130000_game_master_foundation.sql \
        supabase/migrations/20260904130100_game_master_engine.sql
git commit -m "test(game-master): prove isolation rls and scheduler safety"
```

---

### Task 10: Final integration, docs and release gate

**Files:**
- Create: `docs/GAME_MASTER.md`
- Modify: `src/pages.smoke.test.tsx`
- Modify generated `src/types/database.ts` only if needed for branch compile; production regeneration occurs after migration
- Review all GM1 files

**Interfaces:**
- No new feature behavior; this is verification/release preparation.

- [ ] **Step 1: Document operations**

`docs/GAME_MASTER.md` must document:
- product invariants
- pulse model
- silence
- cooldowns
- template metadata
- allowed placeholders
- admin controls
- archive visibility
- scheduled 08/20 local windows
- no AI
- GM2/GM3/GM4 explicitly deferred
- Cloudflare pause/unpause runbook

- [ ] **Step 2: Add smoke coverage**

At minimum:
- authenticated normal pages still render with no GM event
- `/arkivet` renders
- `/admin/game-master` denied to participant
- `/admin/game-master` renders for admin
- Game Master query failure does not replace the normal page with an error state

- [ ] **Step 3: Run every local gate**

```bash
npm run typecheck
npm run lint
npm run test
npm run build
npm run format:check
```

Expected: all PASS.

- [ ] **Step 4: Run real Database Tests on branch tip**

GitHub Actions must apply full migration chain to throwaway Postgres and report:
- all files PASS
- Result: PASS

Do not rely on a previous intermediate commit.

- [ ] **Step 5: Review diff for scope**

Required:
- no competitions tables
- no token ledger
- no rivalry table
- no title table
- no AI dependency/API key
- no push notifications
- no sixth bottom-nav item
- no core debt/streak/day-state modifications except read-only calls/helpers necessary to derive candidates
- no `service_role` in frontend
- no manual roast action

- [ ] **Step 6: Commit final docs/integration**

```bash
git add docs/GAME_MASTER.md src/pages.smoke.test.tsx
git commit -m "docs(game-master): document gm1 operations and release gate"
```

- [ ] **Step 7: Open PR but stop before merge**

Report:
- branch name
- HEAD
- migration files
- tables/RPCs added
- template count + severity distribution
- JS test total
- pgTAP file/assertion total
- GitHub Actions run URL/result
- exact admin route
- exact archive route
- known risks
- rollout order

Do not merge, db push or deploy.

---

## GM1 rollout after review/approval

This is **not** executed by the implementation agent automatically.

### 1. Pause Cloudflare

Cloudflare Dashboard → Workers & Pages → `halsoutmaningen` → Settings → Builds → Deploy command

Change:

```text
npx wrangler deploy
```

to:

```text
npx wrangler versions upload --assets=./dist
```

Save.

### 2. Merge approved GM1 PR

Then on VM:

```bash
cd ~/projects/halsoutmaningen
git switch main
git pull --ff-only
git status
```

Require clean tree.

### 3. Apply database migrations

```bash
npx supabase db push \
  --project-ref offvlyflactysibrssco
```

Expected GM1 migrations:
- `20260904130000_game_master_foundation.sql`
- `20260904130100_game_master_engine.sql`
- `20260904130200_game_master_templates.sql`

### 4. Regenerate production DB types

```bash
npm run db:types
npm run typecheck
npm run lint
npm run test
npm run build
npm run format:check
git status
```

If generated types are the only expected diff:

```bash
git add src/types/database.ts
git commit -m "chore: regenerate types after game master gm1"
git push
```

### 5. Unpause Cloudflare

Cloudflare Dashboard → Workers & Pages → `halsoutmaningen` → Settings → Builds → Deploy command

Change:

```text
npx wrangler versions upload --assets=./dist
```

back to:

```text
npx wrangler deploy
```

Save.

Retry the latest `main` build.

### 6. Live smoke test

- normal participant can log training normally
- Game Master disabled → no surprises, core unchanged
- Game Master enabled normal intensity
- admin page `/admin/game-master` loads
- participant cannot access admin page
- `/arkivet` loads
- forced/manual DB test event if needed appears only to intended visibility; do not add a permanent “roast now” UI
- dismissing event prevents repeat
- public archived event appears in Arkivet
- private event never appears in public Arkivet
- normal training still works if Game Master pulse API fails
- cron job exists and next morning/evening window can be observed in run log
- KASSAN/streak/ranking/Straffbanken/afterregistration unchanged by Game Master state

---

## After GM1

Do **not** immediately pile on GM2.

Let GM1 run in production long enough to inspect:
- average events/day
- public/private ratio
- which families actually fire
- repeated-victim rate
- severity-5 frequency
- silence rate
- whether users notice patterns
- whether admin ever needs the emergency brake
- whether Arkivet feels like a chronicle rather than a feed

Then write a separate GM2 plan for machine-verifiable competitions + Competition Tokens.
