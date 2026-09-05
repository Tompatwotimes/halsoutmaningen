# Hälsoutmaningen — Game Master: Context Layer + Chat/Weight Integration Design Specification

**Date:** 2026-09-05
**Status:** Design/spec only — no implementation, no migrations, not deployed
**Product:** Hälsoutmaningen
**Scope:** (a) a behavior-preserving refactor of Game Master's existing context-gathering into a reusable layer, (b) new training-entry-level context, (c) chat-aware and weight-aware candidate families, (d) a `chat` output channel alongside the existing ambush surface, (e) centralized hidden-weight output safety
**Depends on:** `2026-09-05-shared-chat-design.md` (schema must exist first for the chat-integration stage), `2026-09-05-weight-tracking-design.md` (schema must exist first for the weight-integration stage)
**Explicitly excludes:** Competition Tokens, rivalries, titles, any GM2+ work, AI/LLM of any kind, changes to the dormant `general_system` family, any redesign of GM1's UI/nav

This is the only one of the three specs that modifies existing Game Master objects. Every modification is called out explicitly as **(MODIFIES EXISTING)**; everything else is new.

---

## 0. Global product principles (restated, binding across all three specs)

- The core challenge is sacred — unchanged by this spec, same as GM1's original invariant (`docs/superpowers/specs/2026-09-04-game-master-v1-design.md` §2).
- No AI/LLM, no semantic interpretation of free text. `@gm` detection is a literal, case-insensitive substring match — nothing more.
- **GM1's existing behavior must remain unchanged before any chat/weight family is added.** The context-layer refactor (§1) is a distinct, separately-landed, separately-tested stage whose only acceptance criterion is that the existing `supabase/tests/0015_game_master_foundation.test.sql`, `0016_game_master_engine.test.sql`, `0017_game_master_rls_audit_cron.test.sql` keep passing **unmodified**.
- One Game Master pulse decision produces **at most one effect** — this was already true in GM1 (`_run_game_master_pulse` selects at most one candidate and freezes at most one `game_master_events` row) and remains true here; a chat delivery is not a second effect (§3).
- The five-item bottom navigation and existing GM1 UI (ambush, Arkivet, admin panel) are not redesigned.

---

## 1. Context-layer refactor (behavior-preserving, lands first, independently)

### 1.1 What exists today

`_game_master_candidates(p_challenge_id uuid)` (**EXISTING**, `supabase/migrations/20260904130100_game_master_engine.sql`) inline-reads `public.challenge_results(p_challenge_id)`, `public.challenge_day_states(p_challenge_id, user_id)`, `public.challenge_streak_runs(p_challenge_id, user_id)`, `public.game_master_memories`, and `public.profiles.display_name` directly inside one large `plpgsql` function body with a 9-branch `UNION ALL`.

### 1.2 What changes

Extract three focused, internal (no app-role EXECUTE — same convention as every other `_game_master_*` helper), `SECURITY DEFINER`, `set search_path=''` context functions, one per domain, matching this project's three-spec domain boundary:

- `_game_master_training_context(p_challenge_id uuid) returns table (...)` — everything `_game_master_candidates` reads from `challenge_results`/`challenge_day_states`/`challenge_streak_runs`/`profiles` **today**, unchanged in content, **plus** the new per-entry fields listed in §2.1 (this is additive — nothing existing is removed).
- `_game_master_chat_context(p_challenge_id uuid) returns table (...)` — new (§2.2), only meaningful once the chat spec's schema exists.
- `_game_master_weight_context(p_challenge_id uuid) returns table (...)` — new (§2.3), only meaningful once the weight spec's schema exists.

`_game_master_candidates` is rewritten to consume these three functions' output instead of querying the underlying tables directly, but **produces byte-identical candidates for the 9 existing GM1 families** — same scores, same fingerprints, same payloads, given the same underlying data. This is a refactor of *how* the data is assembled, not *what* is assembled for GM1's existing behavior.

### 1.3 Why this order matters

Landing this refactor **before** any new family is added, as its own migration with its own pgTAP suite, gives a clean regression boundary: if `0015`–`0017` fail after this migration, the refactor introduced a behavior change and must be fixed before anything else proceeds. New families are added only in a later migration, on top of an already-proven-unchanged base.

### 1.4 Templates stay pure string renderers

`_game_master_render` (**EXISTING**, extended in §3.4/§5.2, never given query capability) continues to only substitute placeholders from an already-assembled `payload` — it never queries a table. This holds for every new chat/weight template exactly as it already holds for every GM1 template; the brief's "templates/rules must not each perform arbitrary independent database queries" is satisfied because it was already true, and the context-layer refactor is what keeps it true as new domains are added, rather than each new family reaching into `training_entries`/`chat_messages`/`weight_profiles` ad hoc from inside the candidate generator's own `UNION ALL` branch (which is the pattern GM1 already uses for its 9 families and which this refactor generalizes rather than replaces).

---

## 2. Context expansion

### 2.1 Training — new fields (§ per the locked requirements)

`_game_master_training_context` adds, per eligible participant, sourced directly from **existing** tables `public.training_entries`/`public.training_proofs` (never read directly by `_game_master_candidates` in GM1 — this is new read surface, read-only, no write-back):

- `activity`, `note` presence (not full note text into public payloads — see §5), `duration_minutes`, `session_seq`, `created_at` (registration timestamp), `challenge_date` — from `training_entries`.
- Proof **metadata** only where useful — `mime_type`, `size_bytes`, `width`, `height` from `training_proofs` — **never** the image itself or a signed URL; Game Master has no reason to and this spec does not grant it one.
- Everything GM1 already had: `challenge_results()`'s aggregates, `challenge_day_states()`'s per-day state, `challenge_streak_runs()`'s streak history, `game_master_memories`.

This directly answers the inspection report's open question ("does GM already have access to all relevant training metadata?" — no) by supplying exactly the missing fields, and only those.

### 2.2 Chat

`_game_master_chat_context(p_challenge_id uuid)` reads **existing-per-this-spec's-companion** `chat_messages` (owned by `2026-09-05-shared-chat-design.md`):

- The **bounded recent window**: the 100 most recent `status='active'` rows for the challenge (`order by seq desc limit 100`), regardless of `sender_type` — index-backed via chat's own `chat_messages_challenge_seq_idx (challenge_id, seq desc)`, so the cost of "find the recent window" never grows with total history size. No stronger technical reason was found during inspection to deviate from the brief's suggested 100; adopted as specified.
- Hidden (`status='hidden'`) messages are excluded from the window used to **generate new candidates** — an admin-moderated message should not itself become the basis of a fresh Game Master observation. (Its historical existence may still surface later as a structured memory fact if a future phase wants that; this spec does not build that.)
- `sender, body, exact created_at, seq` per message in the window.
- `@gm` detection: `body ilike '%@gm%'` — a literal, case-insensitive substring match, computed at read time, not stored as a column (no schema dependency on chat's table beyond what §3's later `ALTER` already adds for the output-channel link, §3.2).
- Older chat history remains reachable for structured memories/historical callbacks via the same `game_master_memories` table GM1 already has — a chat-derived memory stores a fact (e.g. `memory_type='chat_callback'`, a fingerprint, a short structured `payload`), never a prose excerpt or the message body verbatim, matching GM1's existing "memory stores facts, not prose" design (`docs/superpowers/specs/2026-09-04-game-master-v1-design.md` §10).

### 2.3 Weight

`_game_master_weight_context(p_challenge_id uuid)` reads **existing-per-this-spec's-companion** `weight_profiles`/`weight_entries` (owned by `2026-09-05-weight-tracking-design.md`):

- `start_weight_kg`, latest `weight_entries` value + date, computed `percentage_change`, `official_final_weight_kg` (once set, near/after the finale), `is_weight_hidden`.
- Because this context function is `SECURITY DEFINER` (like every other GM internal helper), it reads **regardless of `is_weight_hidden`** — Game Master's internal access to hidden weight is granted here, exactly as the weight spec's §4 describes and expects. The privacy guarantee is enforced entirely downstream, at candidate generation and render time (§5), never by restricting this read.

---

## 3. Output channel — `game_master_events` remains canonical for every effect

### 3.1 Schema changes **(MODIFIES EXISTING tables, additive only)**

```sql
-- game_master_events (EXISTING table, supabase/migrations/20260904130000_game_master_foundation.sql)
alter table public.game_master_events
  add column output_channel text not null default 'ambush'
    check (output_channel in ('ambush', 'chat'));
alter table public.game_master_events
  add constraint game_master_events_chat_is_public
    check (output_channel <> 'chat' or visibility = 'public');

-- game_master_templates (EXISTING table, same migration)
alter table public.game_master_templates
  add column output_channel text not null default 'ambush'
    check (output_channel in ('ambush', 'chat'));
alter table public.game_master_templates
  add constraint game_master_templates_chat_is_public
    check (output_channel <> 'chat' or visibility = 'public');
```

Both `default 'ambush'` — every one of the 96 existing GM1 templates and every already-frozen `game_master_events` row is `output_channel='ambush'` after this migration applies, with no behavior change: template selection already filters by `(family, visibility)`; adding `output_channel` to that filter is a no-op for any pulse that only ever considers ambush-channel candidates, which is every pulse until §4's new families exist.

The `..._chat_is_public` constraints on both tables are the structural guarantee behind **"Private GM events remain ambush/private behavior and must never materialize in shared chat"** — a private, chat-channel row (or template) cannot exist at all; the database rejects it before any application logic runs.

### 3.2 The chat delivery link **(new column on chat's table, added here — not by the chat spec)**

```sql
-- chat_messages (EXISTING-per-companion-spec table, owned by 2026-09-05-shared-chat-design.md)
alter table public.chat_messages
  add column game_master_event_id uuid references public.game_master_events (id);
```

Added by **this** spec's migration, not the chat spec's own migration, so the chat spec is fully buildable/testable with zero Game Master dependency (chat spec §11/§14/§15 already documents this exact split). This is the only place either spec's own tables are altered by the other domain.

### 3.3 The freeze-and-deliver sequence, inside `_run_game_master_pulse` **(MODIFIES EXISTING function body)**

The existing steps (candidate → filter → weighted-select → template-select → emission roll → freeze) are unchanged through template selection. What changes is only the freeze step:

1. Render title/body **once** via `_game_master_render` (**EXISTING**, extended only for the new placeholder vocabulary, §5.2 — never called twice for the same event).
2. Insert the canonical `game_master_events` row exactly as GM1 already does, now also setting `output_channel` from the selected template's own `output_channel` column.
3. **If and only if `output_channel = 'chat'`**, in the **same transaction**, insert exactly one `chat_messages` row: `challenge_id` = the event's challenge, `sender_type='game_master'`, `sender_user_id=null`, `body` = the **same already-rendered string** from step 1 (never re-rendered, never re-derived), `game_master_event_id` = the new event's id.
4. `game_master_runs.selected_event_id` is set exactly as GM1 already does, unconditionally — **its meaning does not change per channel**: it always means "the event this run produced, if any," regardless of where that event was delivered.

**This is one decision, one effect, delivered through one of two channels** — never two writes representing two effects. The chat row is a *delivery materialization* of the single canonical event, the same way a severity-3 ambush is delivered as a `Sheet` rather than a micro-banner: a presentation/delivery decision layered on the one frozen event, not a second thing that happened.

### 3.4 `_game_master_render` — no new capability, only new vocabulary **(MODIFIES EXISTING function)**

`_game_master_render`'s mechanism (substitute from an approved placeholder list, reject anything else) is unchanged. Only the approved vocabulary grows (§5.2) and — new in this spec — it gains the output-safety refusal described in §5.2. It still never queries a table and never renders the same payload twice for one event.

---

## 4. New candidate families

Added to `_game_master_candidates`'s `UNION ALL` as additional branches, consuming the three context functions from §2. **The 9 existing GM1 families are untouched** — these are pure additions.

### 4.1 `training_logged` (public)

One candidate for the most recent still-unfingerprinted `training_entries` row (via §2.1's new fields) — a fresh, successfully logged, non-embarrassing session. `visibility='public'`, consistent with GM1's existing reasoning that positive facts (`streak_long`, `comeback`) default to public while failure-adjacent facts (`missed_day`) default to private. Fingerprint: `training_logged:{entry_id}` (idempotent per entry, never re-fires for the same session). Score inputs: base reflects "a session was logged" (moderate, not automatically high — this must not fire on every single log or it would dominate every pulse); magnitude may scale with `duration_minutes` relative to the challenge's `required_minutes`; novelty/attention exactly as every other family already computes them.

### 4.2 `chat_mention` (public, `@gm`-triggered)

One candidate for the most recent `@gm`-containing message (§2.2) that has not already produced a candidate (fingerprint `chat_mention:{message_id}`, idempotent). `visibility='public'` always (chat is one shared room — there is no private chat concept to mirror). This is the **signal, not command** mechanism: the candidate competes for selection exactly like every other family — scored, cooldown-checked, subject to the same emission-probability roll — **it is never guaranteed to be selected or to emit**. A base score reflecting "someone explicitly asked" is reasonable (moderate-to-high base, so `@gm` messages are *more likely* than average to eventually produce something, without bypassing any eligibility/cooldown/probability rule), matching "may increase relevance... must not guarantee a response."

### 4.3 `weight_ranking_position` (public, conditional) / `weight_progress` (private)

Mirrors `ranking_position`'s existing top/bottom shape (§ inspection report §7) but sourced from `weight_public_ranking`-equivalent data (§2.3): a public candidate is generated **only** for a subject with `is_weight_hidden=false` (checked at generation time — layer 1 of the hidden-weight safety design, §5.1). A **private** variant (`weight_progress`, visible only to the subject) may be generated regardless of `is_weight_hidden`, since a participant may always see their own data — this is the concrete instance of "private subject-only GM behavior may internally use the user's own hidden weight."

### 4.4 Wake-up wiring for `@gm`

`post_chat_message` (**EXISTING RPC, owned by the chat spec** — not modified by this spec's migration, but its *frontend caller* is) — the frontend (`src/features/chat/chat-api.ts`, a chat-spec file) fires a best-effort pulse **only when the posted message contains `@gm`**, mirroring `submit-training.ts`'s existing pattern exactly:

```ts
if (/@gm/i.test(body)) {
  void requestGameMasterPulse(challengeId).catch(() => undefined);
}
```

Ordinary chat messages do not request a pulse on every send (unlike training, where every log requests one) — this keeps chat's naturally higher message frequency from flooding the 90-second request throttle for no product benefit; `@gm` is the deliberate, narrow trigger for "someone wants Game Master's attention," matching the brief precisely. This one `if` is the only frontend change this spec makes outside of Game Master's own admin/observability surfaces (§9) — it lives in the chat feature's own API module (a file the chat spec already creates), called out here because the *reason* for it is Game Master's, not chat's.

---

## 5. Hidden-weight output safety — two layers, centralized

### 5.1 Layer 1 — candidate/context layer never manufactures a public leak

`_game_master_weight_context` (§2.3) returns `is_weight_hidden` for every row; the `weight_ranking_position` public branch (§4.3) filters `where not is_weight_hidden` **before** producing a candidate — a hidden subject's weight numbers are never assembled into a public candidate's `payload` in the first place. This is the same discipline GM1 already applies implicitly (e.g. `kassan`/`general_system` never receive a `{name}` because their context never included one) generalized to a new, explicitly privacy-sensitive field.

### 5.2 Layer 2 — the render/output path refuses even a mistaken attempt **(MODIFIES EXISTING `_game_master_render`)**

New approved placeholders added to the vocabulary **(extends the existing 12, does not remove or change any of them)**: `{weight_start_kg}`, `{weight_latest_kg}`, `{weight_percentage}`. `_game_master_validate_template` (**EXISTING**, extended) accepts these in addition to the current 12 — existing templates using only the original 12 are entirely unaffected.

Before freezing **any** event whose `visibility='public'` (which, per §3.1's constraint, includes every `output_channel='chat'` event) and whose payload contains one of the three weight placeholders, `_run_game_master_pulse` re-checks the subject's `is_weight_hidden` via `_game_master_weight_context` **at freeze time** (not trusting that candidate generation already filtered correctly) — if hidden, the freeze is refused and the pulse falls through to `outcome='silence'` (`reason='weight_privacy_blocked'`), exactly the same way "no eligible template" already falls through to silence in GM1. This is the backstop: even if a future template author or a bug in layer 1 produced a public candidate referencing a hidden subject's weight, the render path — the one place **every** template, old or new, already passes through — refuses to let it become a frozen, visible event. No per-template author discipline is required, matching the project's existing defense-in-depth pattern for placeholder validation (write-time trigger **and** render-time re-check already exist for the original 12; this is the same shape applied to the three new ones, with an added subject-privacy predicate that the original 12 never needed).

This holds **regardless of output channel** — a public ambush, an Arkivet-archived entry, and a chat delivery are all `visibility='public'` renders and all pass through this single check.

---

## 6. GM chat cancellation **(MODIFIES EXISTING `cancel_game_master_event`)**

`cancel_game_master_event(p_event_id, p_reason)` (**EXISTING**, admin-only, mandatory reason, audited) gains one additional step, added via `create or replace function` in this spec's migration:

- After setting the canonical event's `status='cancelled'` exactly as before, check for a linked chat row: `select id from chat_messages where game_master_event_id = p_event_id`.
- If one exists, also set that row's `status='hidden'`, `hidden_at=now()`, `hidden_by=<same actor>`, `hidden_reason=<same reason>` — one admin action, one audit row (the existing `game_master_event_cancelled` audit entry — no second audit row for the chat side, since it is the same action cascading, not a separate decision).
- If none exists (every GM1 event today, and every future ambush-only event), this step is a no-op (`0` rows affected) — **the function's behavior for every pre-existing use case is provably unchanged**, satisfied by a regression pgTAP case asserting an ambush-only cancellation produces identical results before and after this modification (§8).

The chat row is never physically deleted — "original database row remains" and "participants see `[Borttaget av administratör]`" (chat spec §3.3/§6) apply identically whether the row's origin is a participant message hidden via `hide_chat_message` or a GM message hidden via this cascade; the chat UI renders the same placeholder either way, with no need to know which path caused it.

`participant`-authored chat messages are never reachable through `cancel_game_master_event` (it only ever looks up `game_master_event_id`, which is `null` for every participant row) — the chat spec's `hide_chat_message` remains the only path for those, and explicitly refuses `sender_type='game_master'` rows (chat spec §3.3), so the two moderation paths cannot collide or double-handle the same row.

---

## 7. Failure behavior

- The entire freeze-and-deliver sequence (§3.3) runs inside `_run_game_master_pulse`'s **existing** `exception when others` wrapper — a failure inserting the linked `chat_messages` row (e.g. a constraint violation from an unexpected state) aborts the whole transaction, recording `outcome='error'` and creating **neither** the `game_master_events` row **nor** the `chat_messages` row — never a half-delivered effect (an event with no corresponding chat message, or vice versa).
- A `weight_privacy_blocked` silence (§5.2) is recorded exactly like any other silence reason — visible to admins in `GameMasterRunLog`'s diagnostics, never surfaced to participants.
- `_game_master_tick_all`'s existing per-challenge isolation (`begin...exception when others`, one bad challenge never aborts the loop) is unchanged and now also covers the new chat/weight context reads and the chat-delivery insert.

## 8. Isolation guarantees (re-verified, not just re-asserted)

- No new FK from any core challenge table to any Game Master, chat, or weight table, and no new trigger on a core table — the only new FKs this spec introduces are `chat_messages.game_master_event_id → game_master_events(id)` (GM-table-to-GM-adjacent-table) and read-only function access to `training_entries`/`training_proofs`/`chat_messages`/`weight_profiles`/`weight_entries`, none of which are writes.
- The context-layer refactor (§1) and every new family (§4) only ever **read** `training_entries`/`training_proofs` — no new write path to either table is introduced anywhere in this spec.
- `cancel_game_master_event`'s modification (§6) only ever writes `chat_messages.status`/`hidden_*` for a row it already owns via `game_master_event_id` — never a participant-authored row, never any core table.
- A regression pgTAP suite (§9) re-runs the **exact** isolation assertions from `supabase/tests/0017_game_master_rls_audit_cron.test.sql` (byte-identical `challenge_day_states`/`challenge_results` before and after a pulse, no FK from a non-GM table to a GM table, no core function body references Game Master) against the **post-refactor, post-integration** schema, proving the guarantees introduced in GM1 still hold after this spec's changes, not merely that they held once in the past.

## 9. Existing files likely to change

- `supabase/migrations/20260904130100_game_master_engine.sql` — **not edited in place** (forward-only); its *behavior* is extended by new migrations that `create or replace` `_game_master_candidates`, `_run_game_master_pulse`, `_game_master_render`, `_game_master_validate_template`, and `cancel_game_master_event`
- `src/features/game-master/game-master-api.ts` — `GameMasterEvent`/`mapEventRow` gain `outputChannel` (read-only, for admin display; the participant-facing ambush surface does not need to branch on it, since a chat-delivered event is, by construction, never surfaced as an ambush — it is read from `chat_messages`, not from `fetchNextGameMasterEvent`)
- `src/features/admin/GameMasterRunLog.tsx` — display `output_channel` alongside the existing family/visibility/severity badges in "Senaste events"
- `docs/GAME_MASTER.md` — updated once this ships, to document the new pipeline stages (not part of this design-only phase)

## 10. New files likely to be created

- `supabase/migrations/<ts>_game_master_context_refactor.sql` — §1, no new families, no behavior change (proven by unmodified `0015`–`0017` passing)
- `supabase/migrations/<ts>_game_master_chat_weight_integration.sql` — §2's chat/weight context functions, §3's schema `ALTER`s and `_run_game_master_pulse`/`_game_master_render`/`_game_master_validate_template` updates, §4's new families, §6's `cancel_game_master_event` update. **Depends on both companion specs' schemas already existing** (§11).
- `supabase/tests/00XX_game_master_context_refactor_regression.test.sql` — re-runs `0015`–`0017`'s exact assertions against the refactored functions
- `supabase/tests/00XX_game_master_training_context.test.sql`
- `supabase/tests/00XX_game_master_chat_integration.test.sql`
- `supabase/tests/00XX_game_master_weight_integration_and_privacy.test.sql`
- `supabase/tests/00XX_game_master_output_channel_and_cancellation.test.sql`

## 11. Migrations conceptually needed (this spec only)

1. `game_master_context_refactor` — §1, standalone, zero dependency on chat/weight schemas, provably behavior-preserving.
2. `game_master_chat_weight_integration` — §2–§6, requires both `2026-09-05-shared-chat-design.md`'s and `2026-09-05-weight-tracking-design.md`'s migrations to already be applied (it `ALTER`s `chat_messages` and reads `weight_profiles`/`weight_entries`).

No migration in this spec mixes the chat and weight domains with each other beyond both being read by the same candidate-generation function — each new family (§4.1–§4.3) is independently reviewable and independently a no-op if only one companion spec has landed (e.g. `weight_ranking_position` simply never fires if `weight_profiles` doesn't exist yet — though in practice both companion migrations are expected to land before this one is even written, since it queries their tables directly).

---

## 12. pgTAP coverage

- **Regression (must pass unmodified):** `0015_game_master_foundation.test.sql`, `0016_game_master_engine.test.sql`, `0017_game_master_rls_audit_cron.test.sql` all still pass after the context-layer refactor, with zero edits to those three files.
- **Context refactor:** `_game_master_candidates`'s output for a fixed fixture is identical (same families, scores, fingerprints, payloads) before and after the refactor — a golden-output comparison, not just "still passes the old assertions."
- **Training context:** a candidate can be generated referencing `activity`/`duration_minutes`/`session_seq`/`created_at` from a specific `training_entries` row; proof metadata (`mime_type`/`size_bytes`) is readable in context but never appears in any template's approved placeholder vocabulary (assert no such placeholder was added) — i.e. it's available to future rule logic but nothing in this spec's shipped templates exposes it.
- **`training_logged`:** fingerprint dedupe (fires once per entry, never again for the same session); does not fire for an entry with no corresponding row yet (obviously) and does not re-fire after `add_training_session` appends a second session to the same day (a distinct entry id → a distinct, separate fingerprint — no double-counting).
- **`chat_mention`:** a message containing `@gm` (case variations: `@GM`, `@Gm`) produces a candidate; a message without it does not; a hidden (`status='hidden'`) `@gm` message is excluded from the context window and produces no candidate; the candidate never guarantees emission (assert a forced-high-roll pulse against a real `@gm` candidate still yields silence, exactly like every other family).
- **`weight_ranking_position`/`weight_progress`:** a hidden subject never produces a public candidate (assert zero public candidates reference them) but does produce a private one visible only to themselves; a non-hidden subject produces the public candidate normally.
- **Output channel:** a chat-flavored template selection freezes exactly one `game_master_events` row (`output_channel='chat'`) **and** exactly one `chat_messages` row with matching `game_master_event_id` and identical `body` text, in one transaction; an ambush-flavored selection creates zero `chat_messages` rows; `game_master_runs.selected_event_id` is populated identically regardless of channel; attempting to insert a `game_master_events` row with `output_channel='chat'` and `visibility='private'` directly is rejected by `game_master_events_chat_is_public`; same for a template row.
- **Cancellation cascade:** cancelling a chat-channel event hides its linked chat row (`status='hidden'`, matching `hidden_by`/`hidden_reason`/`hidden_at` to the cancellation's actor/reason/time) and writes exactly one audit row (not two); cancelling an **ambush-only** event (the GM1-era case) affects zero `chat_messages` rows and produces byte-identical results to the pre-this-spec behavior (the explicit regression case for §6's modification).
- **Hidden-weight safety, both layers:** (1) candidate generation never produces a public `weight_ranking_position` candidate for a hidden subject (layer 1, tested directly against `_game_master_candidates`'s output); (2) a **contrived** public event/template referencing a hidden subject's weight placeholder, constructed to bypass layer 1 the same way `0017`'s induced-error test bypassed template validation via a temporarily-disabled trigger, is refused at freeze time and recorded as `outcome='silence'`/`reason='weight_privacy_blocked'` (layer 2, proving the backstop works even when layer 1 is deliberately defeated — the same testing technique already proven in `supabase/tests/0017_game_master_rls_audit_cron.test.sql` §G2).
- **Isolation, re-verified:** the exact FK-scan, trigger-scan, and before/after-snapshot assertions from `0017`, re-run against the post-integration schema (§8).

## 13. Vitest coverage

- `game-master-api.test.ts`: `mapEventRow` correctly narrows/passes through `outputChannel`.
- `GameMasterRunLog.test.tsx`: displays `output_channel` for a chat-delivered event fixture without adding any new admin control beyond display (no "post to chat now" button — still no manual-effect affordance anywhere, unchanged from GM1).
- `chat-api.test.ts` (chat-spec-owned file, GM-relevant addition): `postChatMessage`'s success path fires `requestGameMasterPulse` when and only when the body contains `@gm` (case-insensitive), never on an ordinary message — mirrors `submit-training.gm.test.ts`'s existing isolation-test shape (assert the chat post's own result is unaffected by a pulse failure, exactly like training's).
- Smoke: extend `pages.smoke.test.tsx`'s existing Game-Master coverage to confirm a chat-delivered GM message fixture renders correctly inside the chat panel (chat-spec-owned component) with the GM sender badge, without needing any Game-Master-specific code inside the chat panel beyond reading `sender_type`.

## 14. Rollout dependencies

- §1 (context refactor) has **zero** dependency on either companion spec and can land, be reviewed, and ship entirely on its own, proven by the existing GM1 pgTAP suites.
- §2–§6 (chat/weight integration) require both `2026-09-05-shared-chat-design.md`'s migrations and `2026-09-05-weight-tracking-design.md`'s migrations to already be applied to the target environment — this migration reads/alters their tables directly and cannot be written, let alone applied, before they exist.
- Recommended order: context refactor → chat spec (schema, RPCs, UI, Realtime) → weight spec (schema, RPCs, UI) → this spec's §2–§6 integration migration → GM admin/observability display updates (§9).
- Following the existing project convention (`docs/GAME_MASTER.md` §9, CLAUDE.md's deployment rule): whenever any of these phases adds a migration, Cloudflare's deploy command is paused (`wrangler versions upload --assets=./dist`) before merge, and restored only after the migration is applied and `npm run db:types` has run — unchanged process, repeated per phase.

## 15. Cross-spec interfaces (explicit)

- **From Chat spec:** reads `chat_messages(id, seq, challenge_id, sender_type, sender_user_id, body, status, created_at)` (§2.2); writes only `sender_type='game_master'` rows via its own internal path (§3.3), never via `post_chat_message`; extends (via `ALTER`) `chat_messages` with `game_master_event_id` (§3.2); extends (via `create or replace`) the chat spec's own moderation story only insofar as `cancel_game_master_event`'s cascade (§6) sets the same `status='hidden'` columns `hide_chat_message` (chat spec §3.3) also sets — both paths converge on the identical column shape the chat spec defines, never a second, competing hidden-state representation.
- **From Weight spec:** reads `weight_profiles(challenge_id, user_id, start_weight_kg, official_final_weight_kg, is_weight_hidden, ...)` and `weight_entries(challenge_id, user_id, entry_date, weight_kg)` (§2.3); never writes to either table; never bypasses `is_weight_hidden` for anything that becomes a public or chat-delivered render (§5).
- **To both:** neither companion spec needs to know this spec exists to be built, reviewed, or shipped — the dependency is one-directional (this spec depends on them; they do not depend on this spec), matching §14's rollout order and the brief's "no migration should mix unrelated domains simply for convenience."

---

## 16. Explicitly out of scope

Competition Tokens, rivalries, titles, any GM2+ mechanic, un-capping the dormant `general_system` family (left exactly as GM1 shipped it), keyword/phrase/participant-name auto-triggers beyond literal `@gm`, any redesign of the ambush/Arkivet/admin UI beyond the additive `output_channel` display in §9, any AI/LLM/semantic text interpretation anywhere in the trigger or scoring logic.
