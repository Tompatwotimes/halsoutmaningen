# Game Master: Context Layer + Chat/Weight Integration Implementation Plan

> **For agentic workers:** Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor Game Master's context-gathering with zero observable behavior change, then add training/chat/weight-aware candidates and a `chat` output channel — while `game_master_events` remains the one canonical frozen record for every effect, GM1's isolation guarantees are re-proven intact, and hidden weight is structurally incapable of reaching a public output.

**Spec:** `docs/superpowers/specs/2026-09-05-game-master-context-chat-weight-design.md`.

**Depends on:** `feat/shared-chat` and `feat/weight-tracking` (this plan's companions) must already be **merged to `main`** before this plan's branch is created — every task from Phase B onward reads or alters `chat_messages`/`weight_profiles`/`weight_entries`, which do not exist before then.

**Architecture:** Four phases, each independently gated and committed: (A) a behavior-preserving context refactor, provably inert; (B) chat-aware context and the `chat_mention`/`training_logged` candidate families; (C) the `output_channel` extension to the existing `game_master_events`/`game_master_templates` tables and the freeze-and-deliver sequence; (D) weight-aware context/candidates with a two-layer hidden-weight output-safety proof, closing with a full re-verification of every GM1 isolation guarantee against the fully-integrated schema.

**Tech stack:** unchanged from GM1 — Supabase Postgres 17 / RLS / RPC / pg_cron, pgTAP, React/TypeScript/Vitest for the small frontend surface this plan touches.

## Global constraints

- **Phase A must produce zero observable behavior change.** Its acceptance gate is: `supabase/tests/0015_game_master_foundation.test.sql`, `0016_game_master_engine.test.sql`, `0017_game_master_rls_audit_cron.test.sql` pass **unmodified**, plus a new golden-output characterization test (Task A1) shows identical `_game_master_candidates` output before and after.
- No new candidate family before Phase A's gate closes. `training_logged` (the first new family) is deliberately sequenced as Phase B's opening task, not Phase A, to keep Phase A's diff strictly refactor-only.
- `game_master_events` remains the canonical frozen record for **every** Game Master effect — a chat delivery is never a second effect, never skips this table, never renders its text a second time.
- The dormant `general_system` family is not touched anywhere in this plan.
- No Competition Tokens, rivalries, titles, or any GM2+ work. No AI/LLM. No redesign of the ambush/Arkivet/admin UI beyond the additive `output_channel` display in Phase C.
- Full local gates before every `src/`-touching commit: `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`, `npm run format:check`.
- Full migration chain + pgTAP must pass in GitHub Actions after every phase's gate task, not just at the very end — each phase is its own reviewable checkpoint.
- Do not `supabase db push`, merge, or deploy — gated by explicit approval (§ Rollout).
- Branch: `feat/game-master-chat-weight-integration`, created from `main` only after confirming `main` already contains both companion plans' merged migrations (verify with `ls supabase/migrations/ | grep -E 'chat_schema|weight_schema'` before starting).

---

## File map

### Database
- Create: `supabase/migrations/20260905160000_game_master_context_refactor.sql` (Phase A)
- Create: `supabase/migrations/20260905160100_game_master_chat_weight_integration.sql` (Phases B–D)
- Create: `supabase/tests/0025_game_master_context_refactor_regression.test.sql`
- Create: `supabase/tests/0026_game_master_training_context.test.sql`
- Create: `supabase/tests/0027_game_master_chat_integration.test.sql`
- Create: `supabase/tests/0028_game_master_output_channel_and_cancellation.test.sql`
- Create: `supabase/tests/0029_game_master_weight_integration_and_privacy.test.sql`
- Create: `supabase/tests/0030_game_master_full_isolation_reverification.test.sql`

### Frontend
- Modify: `src/features/chat/chat-api.ts` (Plan 1's file — adds the `@gm`-triggered pulse wake)
- Modify: `src/features/chat/chat-api.test.ts`
- Modify: `src/features/game-master/game-master-api.ts` (`outputChannel` field)
- Modify: `src/features/game-master/game-master-api.test.ts`
- Modify: `src/features/admin/GameMasterRunLog.tsx` (display `output_channel`)
- Modify: `src/features/admin/GameMasterRunLog.test.tsx`
- Modify: `src/pages/pages.smoke.test.tsx`

### Docs
- Modify: `docs/GAME_MASTER.md`

---

# Phase A — Behavior-preserving context refactor

## Task A1: Golden-output characterization baseline

**Files:**
- Create: `supabase/tests/0025_game_master_context_refactor_regression.test.sql`

This is not a traditional "red, then green" TDD step — there is no new behavior to fail against yet. The correct sequencing for a behavior-preserving refactor is: capture the current, correct output as a fixed baseline **before** touching any code, so every subsequent step in Phase A can be measured against it.

- [ ] **Step 1: Write the characterization test against the CURRENT, unmodified `_game_master_candidates`.**

Build a fixed fixture (one challenge, 2–3 participants, enough training history to produce at least 3 of the 9 GM1 families as real candidates — reuse the exact fixture-construction idioms from `supabase/tests/0016_game_master_engine.test.sql`, e.g. its `pg_temp.done(challenge, user, date)` helper). Call `_game_master_candidates(p_challenge_id)` directly and assert the **exact** set of `(family, subject_user_id, visibility, fingerprint)` tuples returned, plus each candidate's `score` to within a tight tolerance (scores are deterministic given the fixture — assert exact values, not approximations, since nothing about the refactor should introduce floating-point drift).

- [ ] **Step 2: Run this test now, against unmodified code, and confirm it PASSES.**
```bash
git push -u origin feat/game-master-chat-weight-integration
gh workflow run database-tests.yml --ref feat/game-master-chat-weight-integration
```
Expected: `0025` passes immediately — it is documenting current behavior, not driving new behavior. If it fails, the fixture is wrong; fix the fixture, not the (untouched) function.

- [ ] **Step 3: N/A.**

- [ ] **Step 4: Confirmed in Step 2.**

- [ ] **Step 5: Commit**
```bash
git add supabase/tests/0025_game_master_context_refactor_regression.test.sql
git commit -m "test(game-master): capture a golden-output baseline before the context refactor"
```

## Task A2: Extract `_game_master_training_context`, no field changes

**Files:**
- Create: `supabase/migrations/20260905160000_game_master_context_refactor.sql`
- Modify: `supabase/tests/0025_game_master_context_refactor_regression.test.sql`

**Interfaces produced:**
```sql
public._game_master_training_context(p_challenge_id uuid) returns table (...)  -- internal, no app-role EXECUTE
```
containing **exactly** what `_game_master_candidates` reads today from `challenge_results`/`challenge_day_states`/`challenge_streak_runs`/`profiles` — a pure extraction, no new column yet (those come in Task A3).

**Interfaces consumed:** `public.challenge_results`, `public.challenge_day_states`, `public.challenge_streak_runs`, `public.profiles` (all existing, unchanged).

- [ ] **Step 1: Extend the characterization test with a second assertion block**: after this task's migration is applied, re-run the exact same fixture through `_game_master_candidates` and assert **byte-identical** output to Task A1's captured baseline (compare the actual tuple sets, not just "still passes" — a literal equality check against the recorded baseline values).

- [ ] **Step 2: Push, run, confirm the NEW assertion currently fails** (the migration doesn't exist yet, so `_game_master_candidates` is still the old, unrefactored version — this "fails" only in the sense that the new comparison logic has nothing new to compare against yet; if your test harness can't meaningfully "fail" a not-yet-different comparison, instead confirm the test **passes trivially** because pre- and post- are the same function, and treat Step 4 as the real proof once the refactor lands).

- [ ] **Step 3: Implement.** `create or replace function public._game_master_candidates` rewritten to call `_game_master_training_context` instead of inlining the four reads — the 9-branch `UNION ALL` body changes only in *where its inputs come from*, not in any scoring/fingerprint/payload logic.

- [ ] **Step 4: Re-run CI. Required green:** `0015`, `0016`, `0017` **unmodified**, and `0025`'s byte-identical comparison.
```bash
gh workflow run database-tests.yml --ref feat/game-master-chat-weight-integration
```

- [ ] **Step 5: Commit**
```bash
git add supabase/migrations/20260905160000_game_master_context_refactor.sql supabase/tests/0025_game_master_context_refactor_regression.test.sql
git commit -m "refactor(game-master): extract _game_master_training_context, no behavior change"
```

## Task A3: Expand training context with new fields (inert until Phase B/D consume them)

**Files:**
- Modify: `supabase/migrations/20260905160000_game_master_context_refactor.sql`
- Create: `supabase/tests/0026_game_master_training_context.test.sql`

**Interfaces produced:** `_game_master_training_context` gains, per participant: `activity`, `note` (presence flag only in this task — full text is never exposed to a public payload, per spec §2.1/§5), `duration_minutes`, `session_seq`, `created_at`, `challenge_date` from `public.training_entries`; `mime_type`, `size_bytes`, `width`, `height` from `public.training_proofs` (never a storage path or signed URL).

- [ ] **Step 1: Write failing pgTAP.** Call `_game_master_training_context` directly (it has no app-role grant, so this test runs as `postgres`, exactly like `0016`'s direct calls to `_game_master_candidates`) against a fixture `training_entries`/`training_proofs` row and assert every new field matches the fixture exactly. Also assert `_game_master_candidates`'s output is **still** byte-identical to Task A1/A2's baseline (these new fields exist in the context but no candidate family reads them yet — confirm that by re-running the golden-output comparison once more).

- [ ] **Step 2: Push, run, confirm failure** (the new columns don't exist in the context function's return shape yet).

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Re-run CI to green** — `0015`–`0017`, `0025` (still byte-identical), `0026` all pass.

- [ ] **Step 5: Commit**
```bash
git add supabase/migrations/20260905160000_game_master_context_refactor.sql supabase/tests/0026_game_master_training_context.test.sql
git commit -m "feat(game-master): expose per-session training metadata in the context layer"
```

## Task A4: Phase A gate

- [ ] **Step 1:** Run every local gate (no `src/` changes yet in this phase, so this is DB-only): confirm `npm run test` (unaffected) still passes, since no frontend file has changed.
- [ ] **Step 2:** Run GitHub Actions on the branch tip; require **all** of `0001`–`0026` green.
```bash
gh workflow run database-tests.yml --ref feat/game-master-chat-weight-integration
```
- [ ] **Step 3:** Review the diff for this phase: exactly one new migration file, exactly two new/modified pgTAP files, **zero** `src/` changes, **zero** new candidate families in `_game_master_candidates`'s `UNION ALL`.
- [ ] **Step 4: Report the phase boundary** (branch, HEAD, migration filename, pgTAP totals) before proceeding to Phase B — this is a natural human review checkpoint even if not executed as a separate commit.

---

# Phase B — Chat input context, `training_logged`, `chat_mention`

## Task B1: `training_logged` candidate family

**Files:**
- Modify: `supabase/migrations/20260905160000_game_master_context_refactor.sql` (still Phase A's file is acceptable here since it's the same context/candidates function; if Phase A already merged as its own PR before this task starts, use the second migration file instead — see Task C1's note on the same tradeoff)
- Modify: `supabase/tests/0026_game_master_training_context.test.sql`

**Interfaces produced:** one new `UNION ALL` branch in `_game_master_candidates` — `family='training_logged'`, `visibility='public'`, fingerprint `training_logged:{entry_id}`, sourced entirely from `_game_master_training_context` (Task A3) — no chat/weight dependency, sequenced here per the Global Constraints note above (Phase A's gate must stay strictly zero-new-behavior).

- [ ] **Step 1: Write failing pgTAP.** A fresh, previously-unfingerprinted `training_entries` row produces a `training_logged` candidate; a second call to `_game_master_candidates` (nothing new logged) does not re-produce it for the same entry; a second, distinct session logged the same day (via `add_training_session`, giving it a new `session_seq`) produces a **second, separately-fingerprinted** `training_logged` candidate — no double-counting or collision between two sessions on the same day.

- [ ] **Step 2: Run, confirm failure.**

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Re-run CI to green** — `0015`–`0017` still pass (this is a genuinely new family now, so `0025`'s byte-identical check is expected to still hold since that check only exercises the OLD 9 families' fixture, which produces no `training_entries` row shaped to trigger `training_logged` unless the fixture already had one — confirm this explicitly rather than assuming it).

- [ ] **Step 5: Commit**
```bash
git add supabase/migrations/20260905160000_game_master_context_refactor.sql supabase/tests/0026_game_master_training_context.test.sql
git commit -m "feat(game-master): add the training_logged candidate family"
```

## Task B2: `_game_master_chat_context`

**Files:**
- Create: `supabase/migrations/20260905160100_game_master_chat_weight_integration.sql`
- Create: `supabase/tests/0027_game_master_chat_integration.test.sql`

**Interfaces produced:**
```sql
public._game_master_chat_context(p_challenge_id uuid) returns table (
  message_id uuid, seq bigint, sender_type text, sender_user_id uuid,
  body text, created_at timestamptz, is_gm_mention boolean
)
```
per spec §2.2 — internal, no app-role grant. Reads `public.chat_messages` (**existing, from `feat/shared-chat`**), bounded to the 100 most recent `status='active'` rows for the challenge, `is_gm_mention := body ilike '%@gm%'`.

**Interfaces consumed:** `public.chat_messages` (Plan 1).

- [ ] **Step 1: Write failing pgTAP.** Insert 105 chat messages for a fixture challenge (via direct `insert` as `postgres`, since `post_chat_message` enforces the rate limit and this needs bulk fixture data); assert the context returns exactly 100 rows, the 100 most recent by `seq`. Insert one message containing `@gm` and one containing `@GM` (case) and assert both have `is_gm_mention=true`; a message with `@game` (not an exact `@gm` token) has `is_gm_mention=false` if constructed adjacent to a real `@gm` substring test that could false-positive (confirm the match is a literal substring check per spec, not a word-boundary regex — if the design intends substring, `@gmail` would also match; assert this literal behavior is what ships, since spec §2.2 specifies a plain `ilike` substring match, not a word-boundary-aware one). Insert one `status='hidden'` message containing `@gm` and assert it does **not** appear in the context at all (hidden messages excluded from the generation window per spec §2.2).

- [ ] **Step 2: Push, run, confirm failure.**

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Re-run CI to green.**

- [ ] **Step 5: Commit**
```bash
git add supabase/migrations/20260905160100_game_master_chat_weight_integration.sql supabase/tests/0027_game_master_chat_integration.test.sql
git commit -m "feat(game-master): add the bounded chat context and @gm detection"
```

## Task B3: `chat_mention` candidate family

**Files:**
- Modify: `supabase/migrations/20260905160100_game_master_chat_weight_integration.sql`
- Modify: `supabase/tests/0027_game_master_chat_integration.test.sql`

**Interfaces produced:** new `UNION ALL` branch — `family='chat_mention'`, `visibility='public'` always, fingerprint `chat_mention:{message_id}`.

- [ ] **Step 1: Write failing pgTAP.**
- The most recent unfingerprinted `@gm` message produces a candidate; a message without `@gm` never does.
- Calling `_game_master_candidates` twice does not re-produce a candidate for the same already-fingerprinted `@gm` message.
- **`@gm` does not guarantee emission**: run `_run_game_master_pulse(challenge_id, 'event', <forced high roll>)` against a fixture whose only real signal is a `chat_mention` candidate, and assert the outcome is `silence` — the same emission-probability gate every other family already passes through, proving "may increase relevance... must not guarantee a response" is actually true, not just asserted in prose.
- A **forced low roll** against the same fixture **can** emit (with a chat-flavored or ambush-flavored template, whichever exists at this point in the plan — Phase C hasn't landed a chat-output template yet, so this test targets an **ambush**-channel template for `chat_mention` as its first proof; Phase C's Task C2 adds a chat-channel variant later).

- [ ] **Step 2: Push, run, confirm failure.**

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Re-run CI to green.**

- [ ] **Step 5: Commit**
```bash
git add supabase/migrations/20260905160100_game_master_chat_weight_integration.sql supabase/tests/0027_game_master_chat_integration.test.sql
git commit -m "feat(game-master): add the chat_mention candidate family"
```

## Task B4: `@gm` pulse-wake wiring (frontend)

**Files:**
- Modify: `src/features/chat/chat-api.ts` (Plan 1's file)
- Modify: `src/features/chat/chat-api.test.ts`

**Interfaces produced:** `postChatMessage`'s success path conditionally calls the **existing** `requestGameMasterPulse` (from `src/features/game-master/game-master-api.ts`, shipped in GM1).

- [ ] **Step 1: Write failing test.** In `chat-api.test.ts`, mock `requestGameMasterPulse` and assert: posting a message containing `@gm` (any case) calls it exactly once with the challenge id; posting a message **without** `@gm` never calls it; a rejection from `requestGameMasterPulse` does not affect `postChatMessage`'s own resolved result (mirrors `submit-training.gm.test.ts`'s existing isolation-test shape exactly).

- [ ] **Step 2: Run, confirm failure.**
```bash
npm run test -- src/features/chat/chat-api.test.ts
```

- [ ] **Step 3: Implement.**
```ts
if (/@gm/i.test(body)) {
  void requestGameMasterPulse(challengeId).catch(() => undefined);
}
```
placed after `postChatMessage`'s own insert has already resolved successfully — never before, never awaited.

- [ ] **Step 4: Run, confirm pass.**
```bash
npm run test -- src/features/chat/chat-api.test.ts
npm run test
npm run typecheck
```

- [ ] **Step 5: Commit**
```bash
git add src/features/chat/chat-api.ts src/features/chat/chat-api.test.ts
git commit -m "feat(game-master): wake a best-effort pulse when a chat message mentions @gm"
```

## Task B5: Phase B gate

- [ ] **Step 1:** Full local gates (`typecheck`, `lint`, `test`, `build`, `format:check`).
- [ ] **Step 2:** GitHub Actions on the branch tip; require all of `0001`–`0027` green.
- [ ] **Step 3:** Review diff for scope: no new table, no schema alteration yet (Phase C adds those), exactly the two new candidate families, exactly one frontend file's behavior extended.
- [ ] **Step 4:** Report the phase boundary before proceeding to Phase C.

---

# Phase C — Output channel

## Task C1: Schema `ALTER`s and CHECK constraints

**Files:**
- Modify: `supabase/migrations/20260905160100_game_master_chat_weight_integration.sql`
- Modify: `supabase/tests/0028_game_master_output_channel_and_cancellation.test.sql` (create if this is the first task touching it)

**Interfaces produced (exact DDL per spec §3.1/§3.2):**
```sql
alter table public.game_master_events
  add column output_channel text not null default 'ambush' check (output_channel in ('ambush','chat'));
alter table public.game_master_events
  add constraint game_master_events_chat_is_public check (output_channel <> 'chat' or visibility = 'public');
alter table public.game_master_templates
  add column output_channel text not null default 'ambush' check (output_channel in ('ambush','chat'));
alter table public.game_master_templates
  add constraint game_master_templates_chat_is_public check (output_channel <> 'chat' or visibility = 'public');
alter table public.chat_messages
  add column game_master_event_id uuid references public.game_master_events (id);
```

- [ ] **Step 1: Write failing pgTAP.**
- Every one of the 96 existing seeded `game_master_templates` rows has `output_channel='ambush'` after this migration (a `count(*) where output_channel <> 'ambush'` = 0 assertion — proves the `default` applied to every pre-existing row with zero data loss).
- Attempting to insert a `game_master_events` row with `output_channel='chat', visibility='private'` throws (`game_master_events_chat_is_public`).
- Attempting to insert a `game_master_templates` row with the same combination throws.
- `chat_messages.game_master_event_id` accepts a valid `game_master_events.id` and rejects a non-existent uuid (FK enforcement).
- A fresh `game_master_events` insert with no `output_channel` specified defaults to `'ambush'`.

- [ ] **Step 2: Push, run, confirm failure.**

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Re-run CI to green** — `0015` (which seeded/asserted the 96-template shape) must still show 96 templates with no other property disturbed; confirm explicitly rather than assuming.

- [ ] **Step 5: Commit**
```bash
git add supabase/migrations/20260905160100_game_master_chat_weight_integration.sql supabase/tests/0028_game_master_output_channel_and_cancellation.test.sql
git commit -m "feat(game-master): add output_channel to events/templates and the chat delivery link"
```

## Task C2: Freeze-and-deliver sequence

**Files:**
- Modify: `supabase/migrations/20260905160100_game_master_chat_weight_integration.sql`
- Modify: `supabase/tests/0028_game_master_output_channel_and_cancellation.test.sql`

**Interfaces produced:** `create or replace function public._run_game_master_pulse` — the freeze step gains the conditional chat-delivery insert, exactly per spec §3.3 steps 1–4.

Requires at least one `output_channel='chat'` template to exist for a test fixture — insert one directly in the test (not via the real 96-seed migration, which stays ambush-only per Task C1's regression requirement) targeting `family='chat_mention'` (from Phase B), `visibility='public'`, `output_channel='chat'`.

- [ ] **Step 1: Write failing pgTAP.**
- A forced-low-roll pulse against a `chat_mention` candidate with only a chat-channel template available creates exactly one `game_master_events` row (`output_channel='chat'`) **and** exactly one `chat_messages` row with `sender_type='game_master'`, `sender_user_id=null`, `game_master_event_id` = the new event's id, and `body` **identical** to the event's `body_text`.
- The same scenario with only an **ambush**-channel template available (e.g. Phase B's Task B3 fixture template) creates the event row but **zero** `chat_messages` rows.
- `game_master_runs.selected_event_id` is populated identically in both cases — assert it is non-null and matches the created event's id regardless of channel.
- Attempting to contrive a private-visibility candidate paired only with a chat-channel template (should be structurally impossible per `game_master_templates_chat_is_public`, but assert the *pulse* also can't produce this combination by trying to force it end-to-end and confirming it lands on `no_eligible_template`/silence rather than ever emitting).

- [ ] **Step 2: Push, run, confirm failure.**

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Re-run CI to green** — `0015`–`0017` unaffected (every existing ambush-only pulse path in those suites still creates zero `chat_messages` rows — add an explicit `select count(*) from chat_messages` assertion inside `0016`'s existing fixtures if not already implicitly covered, to make this regression explicit rather than assumed).

- [ ] **Step 5: Commit**
```bash
git add supabase/migrations/20260905160100_game_master_chat_weight_integration.sql supabase/tests/0028_game_master_output_channel_and_cancellation.test.sql
git commit -m "feat(game-master): deliver a chat-channel effect as one canonical event plus one linked message"
```

## Task C3: `cancel_game_master_event` cascade

**Files:**
- Modify: `supabase/migrations/20260905160100_game_master_chat_weight_integration.sql`
- Modify: `supabase/tests/0028_game_master_output_channel_and_cancellation.test.sql`

**Interfaces produced:** `create or replace function public.cancel_game_master_event` — adds the cascade step from spec §6.

- [ ] **Step 1: Write failing pgTAP.**
- Cancelling a **chat-channel** event: the canonical event's `status='cancelled'` (as before), **and** the linked `chat_messages` row now has `status='hidden'`, `hidden_at`/`hidden_by`/`hidden_reason` matching the cancellation's actor/time/reason exactly, **and** the chat row's `body` column is unchanged in storage (only the display-time substitution hides it, per Plan 1's `displayBody` helper, which renders the literal `[Borttaget av administratör]` for any `status='hidden'` row regardless of whether a participant or Game Master authored it — assert the raw `body` column, not the rendered UI, to confirm the original text is never lost).
- Exactly **one** `audit_log` row is written for this action (not two) — `entity_type='game_master_event'`, `action='game_master_event_cancelled'`, unchanged shape from GM1.
- **Regression, explicit:** cancelling an **ambush-only** event (no linked chat row) affects **zero** `chat_messages` rows, and every assertion already present in `supabase/tests/0017_game_master_rls_audit_cron.test.sql`'s cancellation section (Section D) still holds byte-for-byte — re-run those exact assertions here against the modified function as a direct regression proof, not a paraphrase.
- A participant cannot reach a GM-authored chat row through `hide_chat_message` (Plan 1's RPC) — confirm this from the Game Master side too (it was already proven from the chat side in Plan 1 Task 4; this is the cross-spec proof that the two moderation paths agree).

- [ ] **Step 2: Push, run, confirm failure.**

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Re-run CI to green.**

- [ ] **Step 5: Commit**
```bash
git add supabase/migrations/20260905160100_game_master_chat_weight_integration.sql supabase/tests/0028_game_master_output_channel_and_cancellation.test.sql
git commit -m "feat(game-master): cascade event cancellation to its linked chat message"
```

## Task C4: Phase C gate + admin display

**Files:**
- Modify: `src/features/game-master/game-master-api.ts`, `game-master-api.test.ts`
- Modify: `src/features/admin/GameMasterRunLog.tsx`, `GameMasterRunLog.test.tsx`

- [ ] **Step 1: Write failing Vitest.** `mapEventRow` includes `outputChannel` in its mapped shape (fixture with `output_channel: 'chat'` maps to `outputChannel: 'chat'`). `GameMasterRunLog` renders an `output_channel` badge/label in "Senaste events" for a chat-flavored fixture, distinct from the existing family/visibility/severity badges — no new interactive control, purely display (re-assert the existing "no manual roast/victim/template picker" negative test still passes unmodified).

- [ ] **Step 2: Run, confirm failure.**
```bash
npm run test -- src/features/game-master/game-master-api.test.ts src/features/admin/GameMasterRunLog.test.tsx
```

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Full local gates + GitHub Actions on the branch tip.** Require `0001`–`0028` green.

- [ ] **Step 5: Commit**
```bash
git add src/features/game-master/game-master-api.ts src/features/game-master/game-master-api.test.ts \
        src/features/admin/GameMasterRunLog.tsx src/features/admin/GameMasterRunLog.test.tsx
git commit -m "feat(game-master): display output_channel in admin run log"
```

- [ ] **Step 6:** Report the phase boundary before proceeding to Phase D.

---

# Phase D — Weight context, candidates, hidden-weight safety

## Task D1: `_game_master_weight_context`

**Files:**
- Modify: `supabase/migrations/20260905160100_game_master_chat_weight_integration.sql`
- Create: `supabase/tests/0029_game_master_weight_integration_and_privacy.test.sql`

**Interfaces produced:**
```sql
public._game_master_weight_context(p_challenge_id uuid) returns table (
  user_id uuid, start_weight_kg numeric, latest_weight_kg numeric, latest_entry_date date,
  percentage_change numeric, official_final_weight_kg numeric, is_weight_hidden boolean
)
```
per spec §2.3. Reads `public.weight_profiles`/`public.weight_entries` (**existing, from `feat/weight-tracking`**) — regardless of `is_weight_hidden`, since this function is `SECURITY DEFINER` (internal, no app-role grant).

- [ ] **Step 1: Write failing pgTAP.** For a fixture with one hidden and one non-hidden participant (each with a start weight and at least one entry), assert `_game_master_weight_context` returns **both** rows with correct, real values — explicitly proving Game Master's own internal read is not blocked by `is_weight_hidden` (this is expected and correct per spec §2.3/§4 — the privacy guarantee is enforced downstream, not here; the test's purpose is to prove this function is the right place for that unblocked read to happen, and that nothing here already, incorrectly, filters it).

- [ ] **Step 2: Push, run, confirm failure.**

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Re-run CI to green.**

- [ ] **Step 5: Commit**
```bash
git add supabase/migrations/20260905160100_game_master_chat_weight_integration.sql supabase/tests/0029_game_master_weight_integration_and_privacy.test.sql
git commit -m "feat(game-master): add the weight context (internal, unfiltered by is_weight_hidden)"
```

## Task D2: New placeholder vocabulary

**Files:**
- Modify: `supabase/migrations/20260905160100_game_master_chat_weight_integration.sql`
- Modify: `supabase/tests/0029_game_master_weight_integration_and_privacy.test.sql`

**Interfaces produced:** `create or replace function public._game_master_validate_template` — allow-list grows from 12 to 15: `{weight_start_kg}`, `{weight_latest_kg}`, `{weight_percentage}`.

- [ ] **Step 1: Write failing pgTAP.**
- All 12 original placeholders (individually and combined) still validate as `true` — an explicit regression list, not "trust it still works," copied from `0015`'s original assertion and re-run here against the modified function.
- Each of the 3 new placeholders validates as `true`.
- An unrelated made-up placeholder (`{weight_trend_emoji}` or similar) still validates as `false` — the allow-list is still closed, just larger.
- The write-time trigger on `game_master_templates` accepts a template using `{weight_percentage}` and rejects one using an unapproved weight-adjacent placeholder.

- [ ] **Step 2: Push, run, confirm failure.**

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Re-run CI to green** — `0015`'s own placeholder-validation assertions must still pass unmodified against the new function body.

- [ ] **Step 5: Commit**
```bash
git add supabase/migrations/20260905160100_game_master_chat_weight_integration.sql supabase/tests/0029_game_master_weight_integration_and_privacy.test.sql
git commit -m "feat(game-master): add the three weight placeholders to the approved vocabulary"
```

## Task D3: `weight_ranking_position` / `weight_progress` candidate families — layer 1

**Files:**
- Modify: `supabase/migrations/20260905160100_game_master_chat_weight_integration.sql`
- Modify: `supabase/tests/0029_game_master_weight_integration_and_privacy.test.sql`

**Interfaces produced:** two new `UNION ALL` branches — `weight_ranking_position` (`visibility='public'`, generated **only** `where not is_weight_hidden`) and `weight_progress` (`visibility='private'`, generated regardless of `is_weight_hidden`, subject-only).

- [ ] **Step 1: Write failing pgTAP.** With a hidden and a non-hidden participant fixture (reuse Task D1's): `_game_master_candidates`'s output contains **zero** `weight_ranking_position` candidates whose subject is the hidden participant (assert this by filtering the returned candidate set, not by trusting the SQL — an actual row-count-is-zero assertion), but **does** contain a `weight_progress` candidate for that same hidden participant. The non-hidden participant produces a normal `weight_ranking_position` candidate.

- [ ] **Step 2: Push, run, confirm failure.**

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Re-run CI to green.**

- [ ] **Step 5: Commit**
```bash
git add supabase/migrations/20260905160100_game_master_chat_weight_integration.sql supabase/tests/0029_game_master_weight_integration_and_privacy.test.sql
git commit -m "feat(game-master): add weight candidate families with hidden-subject filtering at generation time"
```

## Task D4: Render-layer output-safety backstop — layer 2

**Files:**
- Modify: `supabase/migrations/20260905160100_game_master_chat_weight_integration.sql`
- Modify: `supabase/tests/0029_game_master_weight_integration_and_privacy.test.sql`

**Interfaces produced:** `_run_game_master_pulse`'s freeze step gains a pre-freeze check per spec §5.2 — for a `visibility='public'` event whose rendered payload references a weight placeholder, re-verify the subject's `is_weight_hidden` via `_game_master_weight_context` **at freeze time**; if hidden, do not freeze, record `outcome='silence'`, `diagnostics.reason='weight_privacy_blocked'`.

This is the single most important test in this plan. Use the exact "deliberately defeat layer 1" technique already proven in `supabase/tests/0017_game_master_rls_audit_cron.test.sql` §G2 (temporarily `alter table ... disable trigger game_master_templates_validate`, insert/corrupt a template to reference a hidden subject's weight data in a way layer 1 would never naturally produce, re-enable the trigger, then run the pulse).

- [ ] **Step 1: Write failing pgTAP.**
- Construct a fixture where the ONLY eligible candidate is contrived to be a **public**, weight-referencing candidate for a **hidden** subject (bypassing Task D3's own layer-1 filter deliberately, the same way `0017` bypassed template validation — this is not testing "can a normal pulse leak," it is testing "if layer 1 is somehow defeated, does layer 2 still catch it").
- Run `_run_game_master_pulse` with a forced low roll (would otherwise emit): assert `outcome='silence'`, `diagnostics ->> 'reason' = 'weight_privacy_blocked'`, and **zero** `game_master_events` rows created for this pulse.
- Run the **same** scenario for a **non-hidden** subject: assert it emits normally (proving the backstop is precise — it blocks exactly the hidden case, not weight-referencing candidates in general).
- Assert this holds identically whether the candidate's intended `output_channel` is `ambush` or `chat` — construct both variants (per spec §5.2's explicit "regardless of output channel" requirement) and assert both are blocked.
- Assert a **private**-visibility weight candidate for the same hidden subject (i.e. `weight_progress`) is **not** blocked by this check — the backstop only ever applies to `visibility='public'` renders, proving private subject-only behavior is untouched.
- **Arkivet coverage, explicit:** because the block happens at freeze time — before any `game_master_events` row exists — a blocked candidate can never reach Arkivet either, regardless of the template's `archive` flag; assert this directly by attempting the same contrived scenario with the corrupted template's `archive=true` (Arkivet-eligible) and confirming zero rows are created, exactly as in the `archive=false`/`output_channel='ambush'` case above — there is no separate Arkivet-specific code path to test, only this one freeze-time gate, and this assertion proves that structurally rather than by assumption.

- [ ] **Step 2: Push, run, confirm failure.**

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Re-run CI to green.** Budget for at least one iteration — this is the highest-complexity SQL logic in the whole plan.

- [ ] **Step 5: Commit**
```bash
git add supabase/migrations/20260905160100_game_master_chat_weight_integration.sql supabase/tests/0029_game_master_weight_integration_and_privacy.test.sql
git commit -m "feat(game-master): add the render-time hidden-weight output-safety backstop"
```

## Task D5: Full isolation re-verification

**Files:**
- Create: `supabase/tests/0030_game_master_full_isolation_reverification.test.sql`

**Interfaces produced:** none — this is a pure proof task, mirroring GM1's own Task 9.

- [ ] **Step 1: Write the re-verification suite.** Re-run, against the fully-integrated post-Phase-D schema:
- The exact FK-scan from `0017` (no non-GM table has a foreign key to a GM table) — **plus** confirm the new `chat_messages.game_master_event_id → game_master_events` FK is the expected, sole exception, asserted by name.
- The exact trigger-scan from `0017` (no trigger on a non-GM table calls a GM function).
- The exact function-body-reference scan from `0017` (no non-GM function references `game_master_` in its source) — re-verify the exclusion regex still correctly recognizes every GM-named function including the new ones added in this plan.
- The exact before/after snapshot proof from `0017` §G1/§G2 (`challenge_day_states`, `challenge_results.liability_sek`, `challenge_results.current_streak` byte-identical before and after both a real emission and an induced error), run against a fixture that **also** has chat and weight activity happening in the same challenge, proving the new integrations don't introduce a new isolation gap that a training-only fixture wouldn't reveal.
- **New:** the exact same before/after proof for `weight_profiles`/`weight_entries` and `chat_messages` — a GM pulse (event, silence, or error outcome) never alters any row in either domain except the one, explicit, audited `chat_messages` write path already proven in Task C2/C3.
- **New:** a core `training_entries` insert, a `log_weight_entry` call, and a `post_chat_message` call all still succeed with Game Master `enabled=false` for the challenge — the three-domain equivalent of `0017`'s single-domain isolation check.

- [ ] **Step 2: Push, run, confirm it exercises real behavior** (expect this to pass if Phases A–D are correct; a failure here means an earlier task has a defect — fix it in that task's own migration, not here).

- [ ] **Step 3: N/A — pure proof.**

- [ ] **Step 4: Confirm green in CI** — this is the true "is the whole plan safe" gate; require `0001`–`0030` all pass.

- [ ] **Step 5: Commit**
```bash
git add supabase/tests/0030_game_master_full_isolation_reverification.test.sql
git commit -m "test(game-master): re-verify every GM1 isolation guarantee against the integrated schema"
```

## Task D6: Phase D gate

- [ ] **Step 1:** Full local gates.
- [ ] **Step 2:** GitHub Actions on the branch tip; require all of `0001`–`0030` green.
- [ ] **Step 3:** Review diff for scope: no `general_system` change anywhere in the whole plan (grep the full diff for the string `general_system` and confirm every match is in a comment/test asserting it's unchanged, never in a modified scoring/eligibility line); no Competition Token/rivalry/title table or reference anywhere.
- [ ] **Step 4:** Report the phase boundary.

---

## Final task: integration, docs, release gate

**Files:**
- Modify: `docs/GAME_MASTER.md`
- Modify: `src/pages/pages.smoke.test.tsx`

- [ ] **Step 1: Document** (extend `docs/GAME_MASTER.md`, do not rewrite it): the context-layer shape, the two new families and `output_channel`, the exact two-layer hidden-weight safety mechanism with a one-paragraph "why two layers" note, and the `@gm` wake mechanism with its explicit non-guarantee.

- [ ] **Step 2: Add smoke coverage.** Extend the existing Game Master block in `pages.smoke.test.tsx`: a chat-delivered GM message fixture renders inside a mocked `ChatPanel` context with the correct sender badge (cross-feature smoke, exercising both Plan 1's and this plan's rendering logic together for the first time); a Game-Master-disabled challenge still allows normal chat posting and weight logging (the three-domain smoke equivalent of GM1's own "core still works with GM disabled" smoke assertion).

- [ ] **Step 3: Run every local gate.**
```bash
npm run typecheck
npm run lint
npm run test
npm run build
npm run format:check
```

- [ ] **Step 4: Run the real GitHub Actions Database Tests on the final branch tip.**
```bash
gh workflow run database-tests.yml --ref feat/game-master-chat-weight-integration
```
Require `0001`–`0030` all green, `Result: PASS`.

- [ ] **Step 5: Final scope review** against the design spec's §16 (Explicitly out of scope) and this plan's Global Constraints — no Competition Tokens/rivalries/titles/GM2+, no `general_system` change, no ambush/Arkivet/admin UI redesign beyond the additive `output_channel` display, no `service_role` key anywhere in frontend, five-item bottom nav unchanged (`git diff main -- src/config/navigation.ts` must be empty across this **entire** plan).

- [ ] **Step 6: Commit**
```bash
git add docs/GAME_MASTER.md src/pages/pages.smoke.test.tsx
git commit -m "docs(game-master): document context layer, output channel and hidden-weight safety"
```

- [ ] **Step 7: Report and stop.** Branch, HEAD, both migration filenames, every new table/column/function/RPC touched, template-vocabulary change, JS test total, pgTAP total (`0025`–`0030`), GitHub Actions result URL, known risks, and the three-plan rollout order reminder. **Do not merge, db push, or deploy.**

---

## Rollout (recorded for the approver, not executed here)

1. Confirm `feat/shared-chat` and `feat/weight-tracking` are both already merged to `main` and Cloudflare remains paused.
2. Merge `feat/game-master-chat-weight-integration` → `main`.
3. `npx supabase db push --linked --dry-run` — expect **exactly** `20260905160000_game_master_context_refactor.sql`, `20260905160100_game_master_chat_weight_integration.sql`. Stop and report if anything else is proposed.
4. Apply: `npx supabase db push --linked`.
5. `npm run db:types`; review the diff (expect `output_channel` on two existing tables, `game_master_event_id` on `chat_messages`, and the new internal function signatures — nothing about `training_entries`/`weight_profiles`/`chat_messages`'s own already-shipped columns should change, since this migration only reads them).
6. Full local gates, clean `git status`, commit regenerated types if that's the only diff.
7. Restore Cloudflare's deploy command; retry the latest `main` build.
8. Live smoke test: post `@gm` in chat, confirm a `game_master_runs` row appears (event or silence, either is correct — emission is never guaranteed); if an event emits with `output_channel='chat'`, confirm it appears once in the shared chat history with the GAME MASTER sender treatment; cancel it as admin, confirm the placeholder appears; confirm a hidden participant's weight never appears in any public surface even after several natural pulses; confirm KASSAN/streak/ranking/Straffbanken/training/retroactive registration are all unaffected.
9. Rollback consideration: the context refactor (Phase A) touches only internal, ungranted functions — reverting it is a plain migration rollback with zero externally-visible effect to undo. Phases B–D add columns with safe defaults (`output_channel default 'ambush'`) and brand-new candidate families — disabling them without a schema rollback is possible by an admin setting `game_master_settings.enabled=false` for the affected challenge (the existing GM1 emergency brake, unchanged by this plan) while a fix is prepared, exactly as GM1's own rollout runbook already describes.
