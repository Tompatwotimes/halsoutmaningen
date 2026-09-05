# Hälsoutmaningen — Shared Chat Design Specification

**Date:** 2026-09-05
**Status:** Design/spec only — no implementation, no migrations, not deployed
**Product:** Hälsoutmaningen
**Scope:** One shared, real-time, text-only chat room per challenge (v1)
**Depends on:** nothing (independently buildable and testable)
**Depended on by:** `2026-09-05-game-master-context-chat-weight-design.md` (Game Master reads/writes this domain; it does not define it)

Companion documents: `2026-09-05-weight-tracking-design.md`, `2026-09-05-game-master-context-chat-weight-design.md`. Where this spec and the Game Master spec both describe a shared object (`chat_messages`, `chat_read_state`), **this document is authoritative for the base shape**; the Game Master spec only *adds* to it (an `ALTER TABLE` for `game_master_event_id`) and never redefines a column differently.

---

## 0. Global product principles (restated, binding across all three specs)

- The core challenge is sacred. Nothing in this spec may change or directly affect: completed/missed day state, training debt/liability, KASSAN, current streak, main training ranking, Straffbanken, retroactive-registration behavior, or core training completion.
- No AI/LLM. No semantic interpretation of free text anywhere in this feature.
- The existing mobile layout and navigation are not redesigned. **The five-item bottom navigation (`src/config/navigation.ts` → `BAR_ITEMS`) is unchanged — chat adds no `NAV_ITEMS` entry.**
- Every write with business rules goes through a `SECURITY DEFINER` RPC (`set search_path = ''`, schema-qualified, `revoke ... from public, anon`, `grant execute ... to authenticated` only where a client calls it directly) — never a raw table-level write policy. This is the same pattern `submit_retroactive_registration`, `assign_penalty`, `update_game_master_settings`, etc. already use.
- RLS is the real enforcement; frontend guards (`RequireAuth`, `RequireAdmin`) are convenience only and are not re-derived here.

---

## 1. Product scope (v1, locked)

One shared room **per challenge**. All participants with a membership row in that challenge (`public.is_challenge_member(challenge_id)` — **existing** function, `supabase/migrations/20260901120100_functions_and_rls.sql`) may read and write it.

- Text only, **max 1000 characters** per message.
- No images, no reactions, no threads, no DMs, no user editing, no user deletion, no push notifications.
- Complete challenge chat history retained for the whole challenge (no expiry, no purge).
- Exact server timestamp stored per message (`created_at`, server-assigned — never client-supplied).
- UI: date separators, per-message timestamps, upward incremental pagination (load older on scroll-up), per-user read state, exact unread count, real-time delivery.
- Not a navigation tab. Mounted globally in the authenticated shell (`src/components/layout/AppShell.tsx`), the same way `GameMasterAmbush` already is.
  - Mobile: floating bubble, bottom-right; opens as a large overlay / bottom sheet / near-fullscreen panel; keyboard behavior must stay stable (input never gets covered/obscured).
  - Desktop: floating bubble, bottom-right; opens as a smaller floating window, not fullscreen.
- Rate limit: max 10 participant messages per rolling 30 seconds per user, enforced server-side, readable Swedish error on rejection (matching existing error-surfacing style, e.g. `SubmitTrainingError`/`RetroactiveError`/`GameMasterError`).
- Admin moderation: hide (never physically delete) a participant message, mandatory reason, audited, row remains in place chronologically, participants see a fixed placeholder.
- `@gm` is a signal only — covered in `2026-09-05-game-master-context-chat-weight-design.md` §4 (the candidate family and pulse-wake wiring); this document defines the chat substrate GM reads/writes, not GM's own decision logic.

---

## 2. Data model

### 2.1 New tables

```sql
create table public.chat_messages (
  id                uuid primary key default gen_random_uuid(),
  seq               bigint generated always as identity,   -- see §3, authoritative order/cursor
  challenge_id      uuid not null references public.challenges (id) on delete cascade,
  sender_type       text not null check (sender_type in ('participant', 'game_master')),
  -- NULL for sender_type='game_master'; NOT NULL and always auth.uid() for 'participant'
  sender_user_id    uuid references public.profiles (id),
  body              text not null
                      constraint chat_messages_body_len
                      check (char_length(body) between 1 and 1000),
  -- Set only when sender_type='game_master' and this row materializes a frozen
  -- game_master_events row. NULL for every participant message. This FK is
  -- added by the Game Master migration (see §9 rollout note), not here —
  -- chat's own schema has zero knowledge of Game Master.
  -- game_master_event_id uuid references public.game_master_events (id),  -- added later, documented for forward reference only
  status            text not null default 'active'
                      check (status in ('active', 'hidden')),
  hidden_at         timestamptz,
  hidden_by         uuid references public.profiles (id),
  hidden_reason     text
                      constraint chat_messages_hidden_reason_len
                      check (hidden_reason is null or char_length(hidden_reason) <= 1000),
  created_at        timestamptz not null default now(),   -- DISPLAY ONLY, never an ordering/cursor key (see §3)

  constraint chat_messages_sender_coherent
    check (
      (sender_type = 'participant' and sender_user_id is not null)
      or (sender_type = 'game_master' and sender_user_id is null)
    ),
  -- Mirrors the existing game_master_events cancelled-coherence pattern exactly
  -- (supabase/migrations/20260904130000_game_master_foundation.sql, constraint
  -- game_master_events_check1).
  constraint chat_messages_hidden_coherent
    check (
      (status <> 'hidden' and hidden_at is null and hidden_by is null and hidden_reason is null)
      or (status = 'hidden' and hidden_at is not null and hidden_by is not null
          and length(btrim(hidden_reason)) > 0)
    )
);

create index chat_messages_challenge_seq_idx
  on public.chat_messages (challenge_id, seq desc);
```

```sql
create table public.chat_read_state (
  challenge_id          uuid not null references public.challenges (id) on delete cascade,
  user_id               uuid not null references public.profiles (id) on delete cascade,
  last_read_seq         bigint not null default 0,
  -- Denormalised convenience for "jump to first unread" UX; always kept in
  -- sync with last_read_seq by mark_chat_read. last_read_seq is authoritative
  -- for every count/comparison — never compare on last_read_message_id or a
  -- timestamp.
  last_read_message_id  uuid references public.chat_messages (id),
  updated_at            timestamptz not null default now(),
  primary key (challenge_id, user_id)
);
```

Both tables are entirely new — nothing in the existing schema is altered by this spec.

### 2.2 Why `seq`, not `created_at`, is the ordering/cursor authority

A PostgreSQL `generated always as identity` column allocates strictly increasing, unique values, but — as the product brief itself notes — **allocation order is not guaranteed to equal transaction commit order** under concurrent writers (two transactions can be assigned seq values 5 and 6 but commit in the order 6-then-5 if the first is slower to commit). This does not undermine `seq` as the canonical key: it is still the single deterministic total order every reader agrees on, which a wall-clock timestamp cannot guarantee (two rows can share a `created_at` value outright, and even when they don't, `created_at` ordering can also disagree with commit order under concurrency, without the benefit of ever being unique). The design explicitly accepts:

- `seq` is the **sole** ordering/pagination/read-state key.
- `created_at` is **display metadata only** — date separators, "sent at HH:MM" — never compared, counted, or sorted by in any correctness-relevant path.
- The frontend sorts/reconciles the message list by `seq`, not by arrival order over Realtime and not by `created_at`.
- Realtime delivery order is **not** trusted as ordering truth (see §7) — it is a transport/invalidation signal only; the client re-sorts whatever it receives by `seq`, and a gap or an out-of-order delivery is repaired by a plain refetch (`seq > last_known_max_seq`), not by trusting the socket's delivery sequence.

This directly satisfies the brief's correctness note and improves on the alternative `(created_at, id)` tuple discussed in the prior inspection report: a `uuid` tiebreaker has no relationship to actual insertion order, whereas `seq`'s allocation order is at least a well-defined, single source of truth every client can agree on without ambiguity, and — combined with "always refetch anything with `seq` greater than what I've already reconciled" — the rare allocation-vs-commit reordering at the boundary self-heals on the next poll/refetch instead of ever being load-bearing for a security or count guarantee.

---

## 3. RPC boundaries

All SECURITY DEFINER, `language plpgsql`, `set search_path = ''`, schema-qualified, `revoke all ... from public, anon`, `grant execute ... to authenticated` only for the participant-facing ones — identical convention to every RPC in `supabase/migrations/20260904100100_retroactive_registration_rpcs.sql` and `20260904130100_game_master_engine.sql`.

### 3.1 `post_chat_message(p_challenge_id uuid, p_body text) returns public.chat_messages`

- Requires `auth.uid()` is not null and is an **active** member of `p_challenge_id` (`exists (select 1 from challenge_memberships where challenge_id=p_challenge_id and user_id=uid and active)`) — mirrors the membership-active check `training_entries_guard` already performs.
- Validates `char_length(btrim(p_body))` between 1 and 1000; rejects whitespace-only.
- **Rate limit, enforced here, no new table**: if `(select count(*) from public.chat_messages where sender_type='participant' and sender_user_id=uid and created_at > now() - interval '30 seconds') >= 10`, raise a distinct, translatable error (e.g. `'För många meddelanden. Vänta en liten stund.'`). This mirrors `request_game_master_pulse`'s existing self-query throttle pattern (`supabase/migrations/20260904130100_game_master_engine.sql`) rather than introducing a new rate-limit table.
- Inserts `(challenge_id, sender_type='participant', sender_user_id=uid, body=btrim(p_body))`. `sender_user_id` is **always** `auth.uid()`, never a parameter — a client cannot submit another user's id or `sender_type='game_master'` because there is no code path that accepts either as input from a participant-facing RPC.
- Returns the inserted row (so the client gets `id`/`seq`/`created_at` immediately without a second round trip).

### 3.2 `mark_chat_read(p_challenge_id uuid, p_seq bigint) returns void`

- Requires membership (existence, not necessarily active — a participant who left should still be able to have read state, matching `is_challenge_member`'s existing "any membership row, active or not" semantics).
- **Verifies `p_seq` belongs to `p_challenge_id`**: `select id into v_message_id from public.chat_messages where seq = p_seq and challenge_id = p_challenge_id` — raise if not found. This prevents a client from advancing its read state using a `seq` that belongs to a different challenge's row (since `seq` is a single global identity across the whole table, not scoped per challenge — see §2.1).
- **Never moves state backwards**: `insert into chat_read_state (challenge_id, user_id, last_read_seq, last_read_message_id) values (p_challenge_id, uid, p_seq, v_message_id) on conflict (challenge_id, user_id) do update set last_read_seq = greatest(chat_read_state.last_read_seq, excluded.last_read_seq), last_read_message_id = case when excluded.last_read_seq > chat_read_state.last_read_seq then excluded.last_read_message_id else chat_read_state.last_read_message_id end, updated_at = now()`.
- Atomic, single statement, no read-then-write race.

### 3.3 `hide_chat_message(p_message_id uuid, p_reason text) returns void` (admin)

- `is_admin()` only (null-uid break-glass permitted, matching `cancel_game_master_event`'s convention).
- Requires non-empty `btrim(p_reason)`.
- **Refuses to operate on a `sender_type='game_master'` row** — those are hidden exclusively via the existing `cancel_game_master_event` RPC (Game Master spec §6), which cascades to the linked chat row. This keeps exactly one canonical "hide" path per message origin instead of two RPCs that could disagree.
- Sets `status='hidden'`, `hidden_at=now()`, `hidden_by=actor`, `hidden_reason=btrim(p_reason)`.
- Writes one `audit_log` row: `entity_type='chat_message'` (**new** value — widens `audit_log_entity_type_valid`, same zero-risk pattern used for every prior domain addition), `entity_id=p_message_id`, `action='chat_message_hidden'`, `target_user_id=<the message's sender_user_id>`, `note=btrim(p_reason)`. No message body in the audit row's `before_data`/`after_data`/`note` (mirrors the existing "no roast body text in the cancellation audit row" guarantee — `supabase/tests/0017_game_master_rls_audit_cron.test.sql`).
- Does **not** delete or blank `body` — "original database row remains" is satisfied by construction; only `status`/`hidden_*` change.

### 3.4 Read models (plain `select`, no RPC needed, RLS does the work)

- Message list: `select * from chat_messages where challenge_id=$1 order by seq desc limit $2` (newest page), then `where seq < :oldest_loaded_seq order by seq desc limit $2` for upward pagination.
- Unread count: `select count(*) from chat_messages where challenge_id=$1 and seq > (select coalesce(last_read_seq,0) from chat_read_state where challenge_id=$1 and user_id=$2)`. No additional exclusion is needed beyond challenge membership (already RLS-scoped): **v1 chat has no per-message visibility subset** — every member sees every row (moderated ones render as the placeholder, but the row, and its `seq`, still count), unlike Game Master's private/public split. This is stated explicitly so it is not re-litigated per read-path: a hidden/moderated message still occupies a `seq` and still counts as "a new thing since you last read," it just displays as `[Borttaget av administratör]` instead of its real body.

---

## 4. RLS

```sql
alter table public.chat_messages   enable row level security;
alter table public.chat_read_state enable row level security;

revoke all on public.chat_messages, public.chat_read_state from anon, authenticated;
grant select on public.chat_messages   to authenticated;
grant select on public.chat_read_state to authenticated;

create policy chat_messages_select on public.chat_messages
  for select to authenticated
  using (public.is_admin() or public.is_challenge_member(challenge_id));

create policy chat_read_state_select on public.chat_read_state
  for select to authenticated
  using (user_id = (select auth.uid()));

-- No INSERT/UPDATE/DELETE policy on either table. post_chat_message,
-- mark_chat_read, hide_chat_message, and Game Master's internal chat-delivery
-- insert (spec 3) are the only writers, exactly like every other table in
-- this project.
```

A client cannot submit another `sender_user_id` or `sender_type='game_master'` — not because a policy blocks it, but because **no INSERT policy exists at all**; the only path to a new row is `post_chat_message`, whose body hard-codes `sender_type='participant'` and `sender_user_id=auth.uid()`. This is the same structural (not merely policy-level) guarantee `game_master_events` already relies on for its own writes.

---

## 5. Failure behavior

- `post_chat_message` failure (network, rate limit, validation) surfaces a Swedish message via a `ChatError` class (mirrors `RetroactiveError`/`GameMasterError`) — the compose box keeps the drafted text so nothing is lost.
- A failed `mark_chat_read` is best-effort and silently retried on next open/scroll — never blocks reading or shown as an error to the user (matches the existing "Game Master best-effort" isolation philosophy: read-state failing to persist is not a page error).
- Chat itself must never affect any other page: chat queries/mutations live entirely inside the floating bubble/panel component tree; a chat fetch failure renders an empty/error state **inside the chat panel only**, never replacing the host page (same principle already proven for `GameMasterAmbush`/`GameMasterArchive` via `retry:false`/`throwOnError:false`).
- Realtime subscription failure/disconnect: falls back to the existing TanStack Query `staleTime`/`refetchOnWindowFocus` polling behavior already configured in `src/app/queryClient.ts` — chat is never solely dependent on the socket being up.

---

## 6. UI behavior

- New component tree under `src/features/chat/`: `ChatBubble.tsx` (the floating trigger + unread badge), `ChatPanel.tsx` (message list + composer, rendered via the existing `Sheet`/portal pattern on mobile, a smaller anchored floating panel on desktop — reusing `src/components/ui/Sheet.tsx` conventions, not inventing a second overlay primitive).
- Mounted once in `src/components/layout/AppShell.tsx`, as a sibling of `<GameMasterAmbush/>` inside `<main>` — same place, same reasoning (never on `/logga-in` or `/aktivera`, since `AppShell` only renders inside `<RequireAuth>`).
- Date separators computed client-side from `created_at` (display only, per §2.2), grouped by challenge-local calendar day using the existing `src/domain/dates.ts`/`src/domain/time.ts` helpers (`currentPlainDateInTimeZone`-style conventions) rather than the browser's local date — consistent with how every other date-sensitive surface in this app already avoids the midnight/timezone bug class (CLAUDE.md §8).
- A GM-authored message (`sender_type='game_master'`) renders with a visibly distinct sender label ("GAME MASTER" via the existing `Badge` component, `tone="neutral"`) — same visual vocabulary already used in `GameMasterArchive`/`GameMasterRunLog`, not a new tone.
- A `status='hidden'` message renders its `hidden_reason`-independent, fixed placeholder text `[Borttaget av administratör]` in place of `body`, still positioned at its normal chronological `seq`.
- Mobile keyboard stability: the composer must not be covered when the on-screen keyboard opens — implemented with the same `visualViewport`-aware technique already required for stable Sheet-based forms in this app (no existing component does this yet since chat is the first near-fullscreen text-input surface; call this out explicitly as new UI-plumbing work, not a copy of an existing pattern).
- Unread badge on `ChatBubble` shows the exact count from §3.4, capped for display only (e.g. "99+") without altering the underlying exact count used for read-state math.

---

## 7. Realtime integration

**First Supabase Realtime consumer in this codebase** (confirmed by inspection — zero existing usage of `supabase.channel`/`postgres_changes` anywhere in `src/` or `supabase/`).

- Migration adds `chat_messages` to the realtime publication: `alter publication supabase_realtime add table public.chat_messages;`.
- Client subscribes only to `INSERT` events on `chat_messages`, filtered to the open challenge: `supabase.channel('chat:'+challengeId).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: \`challenge_id=eq.${challengeId}\` }, handler).subscribe()`. Realtime enforces the same `chat_messages_select` RLS policy for the connected client's JWT, so a non-member's subscription simply receives nothing for that filter — no separate authorization layer needed.
- **TanStack Query remains the canonical client cache.** A Realtime INSERT event never becomes a second source of truth: the handler either (a) invalidates the message-list query (simple, always correct, one extra round trip) or (b) optimistically appends the row to the cached list *and* still reconciles by `seq` against the next natural refetch — either way, the displayed list is always what TanStack Query holds, sorted by `seq`, never a hand-maintained socket-driven array.
- Subscription lifecycle: created in a `useEffect` inside the chat feature's hook (`useChatMessages`, mirroring `useGameMaster.ts`'s shape) keyed on the open challenge id, torn down (`supabase.removeChannel(channel)`) on unmount or challenge-id change — this repo has no existing cleanup pattern to copy (first consumer), so this is new, reviewed plumbing, called out explicitly rather than presented as "following an existing convention."
- No Realtime is enabled on any other table. `chat_read_state` is deliberately **not** realtime-subscribed in v1 (unread counts refresh on normal query invalidation/focus, not live-pushed) — kept out of scope to enable "only what is needed."

---

## 8. Isolation guarantees

- No foreign key from any core table (`training_entries`, `challenge_memberships`, `challenges`, `challenge_results`-adjacent objects) to `chat_messages`/`chat_read_state`, and none in the reverse direction either, except the deliberate, later, Game-Master-owned `chat_messages.game_master_event_id → game_master_events(id)` (added by the Game Master migration, not this one).
- No trigger on any core table references chat in any way.
- A chat failure (RPC error, Realtime disconnect, rate limit) cannot affect training logging, day states, streaks, liability/KASSAN, ranking, Straffbanken, or retroactive registration — chat has no read or write path into any of those tables or functions.
- Chat's own rate limit and moderation are entirely self-contained (§3.1, §3.3) and do not consult or alter any core table.

---

## 9. Existing files likely to change

- `src/components/layout/AppShell.tsx` — mount `<ChatBubble/>` alongside `<GameMasterAmbush/>`
- `src/lib/supabase.ts` — no code change expected (Realtime is enabled via the client's existing `createClient<Database>(...)`), but confirm the `Database` type regeneration includes the new tables after migration (existing `npm run db:types` rollout step)
- `src/types/database.ts` — regenerated after migration (existing, established step — see CLAUDE.md's deployment rule and `docs/GAME_MASTER.md`'s own rollout runbook for precedent)

## 10. New files likely to be created

- `supabase/migrations/<ts>_chat_schema.sql` — `chat_messages`, `chat_read_state`, indexes, RLS, `audit_log_entity_type_valid` widened with `'chat_message'`, Realtime publication grant
- `supabase/migrations/<ts>_chat_rpcs.sql` — `post_chat_message`, `mark_chat_read`, `hide_chat_message`
- `supabase/tests/00XX_chat_schema_rls.test.sql`
- `supabase/tests/00XX_chat_rpcs_and_rate_limit.test.sql`
- `supabase/tests/00XX_chat_ordering_and_read_state.test.sql`
- `src/features/chat/chat-api.ts`, `useChat.ts`, `ChatBubble.tsx`/`.module.css`, `ChatPanel.tsx`/`.module.css`, plus `.test.ts(x)` for each
- `src/features/chat/types.ts` (`ChatMessage`, `ChatSenderType`, `ChatMessageStatus`)

## 11. Migrations conceptually needed (this spec only)

1. `chat_schema` — tables, RLS, indexes, Realtime publication, audit-vocab widening.
2. `chat_rpcs` — the three RPCs in §3.1–3.3.

(A third, later migration — owned by the Game Master spec, not this one — adds `chat_messages.game_master_event_id` and the internal GM insert path. See §14 rollout dependency below and Game Master spec §3.2.)

---

## 12. pgTAP coverage (this spec)

- Schema: `sender_coherent` and `hidden_coherent` CHECK constraints reject incoherent rows; `body` length 1..1000 enforced; `seq` is unique and strictly increasing across inserts.
- RLS: a non-member cannot `select` from `chat_messages`/`chat_read_state` for a challenge they don't belong to; a member sees every row in their challenge (active and hidden, with hidden ones still present as rows); a user sees only their own `chat_read_state` row; no role can `insert`/`update`/`delete` either table directly.
- `post_chat_message`: rejects a non-member; rejects empty/whitespace body; rejects body > 1000 chars; always sets `sender_user_id = auth.uid()` regardless of any attempt to influence it (there is no parameter to attempt this with — assert the function's argument list is exactly `(p_challenge_id uuid, p_body text)`); the 11th message inside 30 seconds is rejected with a distinct error; the 11th message after the window has passed succeeds.
- `mark_chat_read`: rejects a `seq` from a different challenge; never moves `last_read_seq` backwards (call with a lower seq after a higher one, assert unchanged); is idempotent; a non-member cannot call it for a challenge they don't belong to.
- `hide_chat_message`: participant cannot call it; empty reason rejected; hides a participant message and writes the audit row with no body text leaked; **refuses** to operate on a `sender_type='game_master'` row (assert it raises — the rejection behavior is locked by this spec; the specific Swedish wording of the error is an implementation-time copy choice, like every other error string in this project, not a design decision).
- Unread count: exact count across a mix of read/unread/hidden messages, matching §3.4's formula precisely.

## 13. Vitest coverage

- `chat-api.test.ts`: `postChatMessage` sends only `{p_challenge_id, p_body}`; `markChatRead` sends only `{p_challenge_id, p_seq}`; a transport failure rejects, a normal empty/silence-equivalent case (none exists for chat — every successful post returns a row) is not applicable here the way it is for Game Master's best-effort pulse.
- `useChat.test.ts`: read-state advances only forward from the client's perspective too (defensive, even though the server already guarantees it); Realtime handler reconciles by `seq`, never by arrival order (simulate out-of-order delivery in the mock and assert final displayed order is still `seq`-sorted).
- `ChatBubble.test.tsx`: unread badge reflects the exact count; opening the panel does not itself mark everything read (only scrolling/viewing does, per whatever exact interaction is chosen at implementation time — this is a UX decision to finalize then, not specified further here).
- `ChatPanel.test.tsx`: date separators group correctly across a challenge-local midnight boundary using fixed fake dates (not the browser's tz); a hidden message renders the placeholder, never the real `body`; a GM-authored message renders the distinct sender badge; the composer enforces the 1000-char limit client-side (defense in depth only — the server is authoritative).
- Smoke: `pages.smoke.test.tsx`-style coverage that the chat bubble mounts without crashing when chat data fails to load, and that no other page's content is affected by a chat failure (mirrors the existing Game Master smoke assertions).

## 14. Rollout dependencies

- Fully independent — buildable, testable, and mergeable with **zero** dependency on the Weight or Game Master specs.
- The Game Master spec depends on this one: it adds the `game_master_event_id` column via its own `ALTER TABLE public.chat_messages ...` migration and its own internal insert path, strictly after this spec's schema exists. This spec's migrations must land (and be applied to the target environment) before the Game Master chat-integration migration is written against a real column set.
- Realtime must be verified against the actual hosted project's replication settings during rollout (this is the first table added to `supabase_realtime` in this project) — flagged as a rollout risk, not a design gap.

## 15. Cross-spec interfaces (explicit)

- **To Game Master spec:** `chat_messages(id, seq, challenge_id, sender_type, sender_user_id, body, status, created_at)` is the read surface Game Master's context layer consumes for "recent chat activity" and `@gm` detection (Game Master spec §2, §4). Game Master **never** writes `sender_type='participant'` rows and never calls `post_chat_message`; it only ever inserts `sender_type='game_master'` rows through its own internal path, and only ever hides a GM-authored row through `cancel_game_master_event`, never through `hide_chat_message` (§3.3 explicitly refuses GM-authored rows).
- **To Weight spec:** none. Chat and weight tracking do not interact.
- Neither this spec nor its migrations reference `weight_profiles`, `weight_entries`, or any Game Master table. This document's schema is fully self-contained.

---

## 16. Non-goals / explicitly out of scope for v1

Images, reactions, threads, DMs, message editing, message deletion (physical), push notifications, per-message read receipts beyond the single `last_read_seq` cursor, multi-room chat, keyword/phrase/name auto-triggers for Game Master (only literal `@gm`, defined in the Game Master spec), Realtime on `chat_read_state`.
