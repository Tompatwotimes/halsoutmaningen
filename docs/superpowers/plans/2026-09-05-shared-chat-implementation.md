# Shared Chat Implementation Plan

> **For agentic workers:** Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task, exactly as `docs/superpowers/plans/2026-09-04-game-master-gm1.md` was implemented. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship one shared, real-time, text-only chat room per challenge — schema, RLS, RPCs, ordering/read-state, moderation, Realtime, and UI — fully independent of Game Master and Weight Tracking, so it is usable and mergeable on its own.

**Spec:** `docs/superpowers/specs/2026-09-05-shared-chat-design.md` (authoritative for every schema/RPC/column name below — this plan does not redefine anything the spec already fixed, only sequences its construction).

> **Post-merge security correction (2026-09-05, PR #3 finding I-1):** Tasks 2–7 were built to the original "members SELECT `chat_messages` directly; hide is a client render swap" model. Code review found that exposed a moderated message's original `body` / `hidden_reason` to any member via direct PostgREST or a Realtime `UPDATE` payload. Corrected by an added migration `20260905140200_chat_safe_read.sql` + `supabase/tests/0021_chat_safe_read.test.sql`: `chat_messages` SELECT is admin-only, members read via the `list_chat_messages` / `unread_chat_count` SECURITY DEFINER RPCs (which withhold moderated content and resolve sender display names — also closing finding I-2), and Realtime runs on a new no-secrets `chat_activity` signal table. Spec §4a and `docs/CHAT.md §4/§5` are authoritative for the corrected model.

**Architecture:** Two new tables (`chat_messages`, `chat_read_state`), three SECURITY DEFINER RPCs, RLS-only reads, a `bigint generated always as identity` `seq` column as the sole ordering/pagination/read-state authority (never `created_at`), the project's first Supabase Realtime consumer, and a floating bubble/panel mounted once in the existing `AppShell`.

**Tech stack:** React 19 + TypeScript + Vite, TanStack Query, Supabase Postgres 17 / RLS / RPC / Realtime, Vitest + Testing Library, pgTAP, existing UI primitives (`Sheet`, `Button`, `Badge`).

## Global constraints

- No new bottom-nav item; `src/config/navigation.ts` is never touched by this plan.
- No AI/LLM, no semantic text interpretation anywhere in this plan (this plan does not implement `@gm` detection or any Game-Master-aware behavior at all — that is entirely Plan 3's responsibility, added later as a modification to files this plan creates).
- Every write with business rules goes through a `SECURITY DEFINER` RPC (`set search_path = ''`, schema-qualified, `revoke ... from public, anon`, `grant execute ... to authenticated` only where a client calls it directly) — the existing convention in `supabase/migrations/20260904100100_retroactive_registration_rpcs.sql` / `20260904130100_game_master_engine.sql`.
- No table-level INSERT/UPDATE/DELETE RLS policy on `chat_messages` or `chat_read_state` — ever.
- `seq` (a `generated always as identity` column) is the only ordering/pagination/read-state comparison key. `created_at` is display metadata only and must never appear in a `WHERE`/`ORDER BY` clause used for correctness. A PostgreSQL identity column's allocation order is **not** guaranteed to equal transaction commit order under concurrency — this plan never states or assumes otherwise; `seq` is chosen because it is a single deterministic total order every reader agrees on, not because it perfectly reconstructs wall-clock arrival order.
- Full local gates required before every commit that touches `src/`: `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`, `npm run format:check`.
- Full migration chain + pgTAP must pass in GitHub Actions (`gh workflow run database-tests.yml --ref <branch>`) before this plan's final task is considered done.
- Do not `supabase db push`, merge, or deploy at any point in this plan — those are rollout actions gated by explicit user approval (§ Rollout, end of this document).
- This plan's branch: `feat/shared-chat`, created from `main` only once this design branch's plans are approved and `main` is confirmed to be exactly the commit this plan was written against.

---

## File map

### Database
- Create: `supabase/migrations/20260905140000_chat_schema.sql`
- Create: `supabase/migrations/20260905140100_chat_rpcs.sql`
- Create: `supabase/tests/0018_chat_schema_rls.test.sql`
- Create: `supabase/tests/0019_chat_rpcs_and_rate_limit.test.sql`
- Create: `supabase/tests/0020_chat_ordering_and_read_state.test.sql`

### Domain / frontend
- Create: `src/features/chat/types.ts`
- Create: `src/features/chat/chat.ts` (pure helpers)
- Create: `src/features/chat/chat.test.ts`
- Create: `src/features/chat/chat-api.ts`
- Create: `src/features/chat/chat-api.test.ts`
- Create: `src/features/chat/useChat.ts`
- Create: `src/features/chat/useChat.test.ts`
- Create: `src/features/chat/ChatBubble.tsx`
- Create: `src/features/chat/ChatBubble.module.css`
- Create: `src/features/chat/ChatBubble.test.tsx`
- Create: `src/features/chat/ChatPanel.tsx`
- Create: `src/features/chat/ChatPanel.module.css`
- Create: `src/features/chat/ChatPanel.test.tsx`

### Admin
- Create: `src/features/admin/chat-admin-api.ts`
- Create: `src/features/admin/ChatModerationSheet.tsx` (invoked from `ChatPanel` for an admin viewer — see Task 9)
- Create: `src/features/admin/ChatModerationSheet.test.tsx`

### Integration
- Modify: `src/components/layout/AppShell.tsx`
- Modify: `src/pages/pages.smoke.test.tsx`
- Modify: `src/types/database.ts` (regenerated, not hand-edited — see rollout)

### Docs
- Create: `docs/CHAT.md` (operations reference, final task)

---

## Task 1: Pure domain types and helpers

**Files:**
- Create: `src/features/chat/types.ts`
- Create: `src/features/chat/chat.ts`
- Create: `src/features/chat/chat.test.ts`

**Interfaces produced:**
```ts
export type ChatSenderType = 'participant' | 'game_master';
export type ChatMessageStatus = 'active' | 'hidden';

export interface ChatMessage {
  id: string;
  seq: number;
  challengeId: string;
  senderType: ChatSenderType;
  senderUserId: string | null;
  body: string;
  status: ChatMessageStatus;
  hiddenReason: string | null;
  gameMasterEventId: string | null; // always null until Plan 3's migration adds the column
  createdAt: string; // display only
}

export function displayBody(message: Pick<ChatMessage, 'status' | 'body'>): string;
export function chatDateSeparatorKey(createdAtIso: string, timeZone: string): string; // challenge-local calendar day, YYYY-MM-DD
export function isWithinRateLimitWindow(nowIso: string, sentAtIso: string, windowSeconds: number): boolean;
```

- [ ] **Step 1: Write failing pure-domain tests**

```ts
import { describe, expect, it } from 'vitest';
import { chatDateSeparatorKey, displayBody, isWithinRateLimitWindow } from './chat';

describe('displayBody', () => {
  it('returns the fixed placeholder for a hidden message, never the real body', () => {
    expect(displayBody({ status: 'hidden', body: 'något olämpligt' })).toBe(
      '[Borttaget av administratör]',
    );
  });
  it('returns the real body for an active message', () => {
    expect(displayBody({ status: 'active', body: 'Hej!' })).toBe('Hej!');
  });
});

describe('chatDateSeparatorKey', () => {
  it('groups by the CHALLENGE-LOCAL calendar day, not UTC', () => {
    // 2026-09-05T23:30:00Z is already 2026-09-06 in Europe/Stockholm (CEST, UTC+2)
    expect(
      chatDateSeparatorKey('2026-09-05T23:30:00Z', 'Europe/Stockholm'),
    ).toBe('2026-09-06');
  });
});

describe('isWithinRateLimitWindow', () => {
  it('is true for a message sent 29 seconds ago with a 30s window', () => {
    expect(
      isWithinRateLimitWindow(
        '2026-09-05T12:00:29Z',
        '2026-09-05T12:00:00Z',
        30,
      ),
    ).toBe(true);
  });
  it('is false for a message sent 31 seconds ago with a 30s window', () => {
    expect(
      isWithinRateLimitWindow(
        '2026-09-05T12:00:31Z',
        '2026-09-05T12:00:00Z',
        30,
      ),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run and confirm failure**
```bash
npm run test -- src/features/chat/chat.test.ts
```
Expected: fails — `./chat` has no exports yet.

- [ ] **Step 3: Implement**

`types.ts` exactly as the interface block above. `chat.ts`:
```ts
export function displayBody(message: { status: ChatMessageStatus; body: string }): string {
  return message.status === 'hidden' ? '[Borttaget av administratör]' : message.body;
}
// chatDateSeparatorKey uses Intl.DateTimeFormat with timeZone, mirrors the
// existing convention in src/domain/time.ts (currentPlainDateInTimeZone) —
// reuse that helper's approach rather than inventing a second date-formatting
// idiom.
// isWithinRateLimitWindow is display/estimation-only (client never enforces
// the real limit — the server's post_chat_message does); used only to grey
// out the composer optimistically.
```

- [ ] **Step 4: Run and confirm pass**
```bash
npm run test -- src/features/chat/chat.test.ts
```

- [ ] **Step 5: Commit**
```bash
git add src/features/chat/types.ts src/features/chat/chat.ts src/features/chat/chat.test.ts
git commit -m "feat(chat): add pure chat domain types and helpers"
```

---

## Task 2: Chat schema + RLS

**Files:**
- Create: `supabase/migrations/20260905140000_chat_schema.sql`
- Create: `supabase/tests/0018_chat_schema_rls.test.sql`

**Interfaces produced (exact shape per spec §2.1, §4):**
- Tables: `chat_messages`, `chat_read_state`
- No write RPC yet (Task 3) — this task ships schema + RLS only, with no way for any app role to write, matching how `20260904130000_game_master_foundation.sql` shipped schema/RLS a full task before its RPCs.

- [ ] **Step 1: Write failing pgTAP first**

Cover, in `0018_chat_schema_rls.test.sql` (fixture style per `supabase/tests/0013_retroactive_registration_rls_audit.test.sql`):
- `chat_messages_sender_coherent` rejects `sender_type='participant', sender_user_id=null` and rejects `sender_type='game_master', sender_user_id=<not null>`.
- `chat_messages_hidden_coherent` rejects a `status='hidden'` row missing `hidden_at`/`hidden_by`/`hidden_reason`, and rejects a `status='active'` row that has any of them set.
- `body` length: reject empty string, reject 1001 characters, accept exactly 1000.
- `seq` is unique and strictly increasing across three sequential inserts (`select seq from chat_messages order by created_at` — no, order by insertion order via a captured id list — assert `seq` values are distinct and each later insert's `seq` is greater than the prior).
- `audit_log_entity_type_valid` now accepts `'chat_message'` (a `lives_ok` insert exactly like `0015`'s `game_master_settings`/`game_master_event` case).
- RLS: a non-member cannot `select` any row from `chat_messages`/`chat_read_state` for a challenge they don't belong to; a member sees every row (active and hidden) in their own challenge; a user sees only their own `chat_read_state` row, never another user's.
- Direct-write rejection: `insert`/`update`/`delete` into either table as an `authenticated` participant all `throws_ok` (no policy exists at all — confirm via a real attempted write, not by inspecting `pg_policies`).

- [ ] **Step 2: Push and run the failing suite on the feature branch**
```bash
git push -u origin feat/shared-chat
gh workflow run database-tests.yml --ref feat/shared-chat
```
Expected: `0018` fails — the tables/constraints don't exist yet. Poll with `gh run list --workflow=database-tests.yml --branch feat/shared-chat --limit 1` until `status=completed`, then `gh run view <id> --log-failed`.

- [ ] **Step 3: Implement the migration**

Exact table DDL per spec §2.1 (`chat_messages` with `seq bigint generated always as identity`, `chat_read_state` with `last_read_seq bigint not null default 0`), the RLS block per spec §4, the audit-vocab widening (`drop constraint if exists audit_log_entity_type_valid; add constraint ... check (entity_type in (... , 'chat_message'))` — full current list copied from `supabase/migrations/20260904130000_game_master_foundation.sql`, not re-derived), and:
```sql
alter publication supabase_realtime add table public.chat_messages;
```
(Wrap in a `do $$ begin ... exception when others then raise notice ...; end $$;` guard only if a dry run against the real `Database Tests` workflow shows the publication doesn't exist in that environment — confirm this in Step 4 before deciding whether the guard is needed; do not add speculative error handling for a failure mode not yet observed.)

- [ ] **Step 4: Re-run CI, iterate to green**
```bash
gh workflow run database-tests.yml --ref feat/shared-chat
```
Fix any failure exactly as GM1's Task 2/9 iterations did (temp-table grants, stale JWT claims, etc. are the known failure classes from this project's history — check those first). Expected final state: all prior suites (`0001`–`0017`) still pass, `0018` passes in full.

- [ ] **Step 5: Commit**
```bash
git add supabase/migrations/20260905140000_chat_schema.sql supabase/tests/0018_chat_schema_rls.test.sql
git commit -m "feat(chat): add chat_messages/chat_read_state schema and RLS"
```

---

## Task 3: `post_chat_message` and `mark_chat_read`

**Files:**
- Create: `supabase/migrations/20260905140100_chat_rpcs.sql` (this task adds `post_chat_message`/`mark_chat_read`; Task 4 adds `hide_chat_message` to the same file)
- Create: `supabase/tests/0019_chat_rpcs_and_rate_limit.test.sql` (this task's assertions; Task 4 extends the same file)

**Interfaces produced:**
```sql
public.post_chat_message(p_challenge_id uuid, p_body text) returns public.chat_messages
public.mark_chat_read(p_challenge_id uuid, p_seq bigint) returns void
```
Exact bodies per spec §3.1/§3.2.

**Interfaces consumed:** `public.is_challenge_member(uuid)`, `public.challenge_memberships` (existing).

- [ ] **Step 1: Write failing pgTAP**

- `post_chat_message` by a non-member throws.
- `post_chat_message` by an active member inserts a row with `sender_type='participant'`, `sender_user_id` = the caller's own id **regardless of the fact that there is no parameter to try setting it to anything else** — assert the function's argument list is exactly `p_challenge_id uuid, p_body text` via `pg_get_function_arguments`.
- Empty body (`''`) and whitespace-only body (`'   '`) both throw.
- A body of exactly 1000 characters succeeds; 1001 throws.
- `mark_chat_read` with a `seq` belonging to a **different** challenge throws.
- `mark_chat_read` called twice, second time with a lower `seq` than the first, leaves `last_read_seq` at the higher value (never moves backward).
- `mark_chat_read` upserts `last_read_message_id` consistently with `last_read_seq` (same row).
- `mark_chat_read` by a non-member of the target challenge throws.

- [ ] **Step 2: Push, run, confirm failure**
```bash
gh workflow run database-tests.yml --ref feat/shared-chat
```
Expected: `0019` fails — functions don't exist.

- [ ] **Step 3: Implement**

Both functions exactly per spec §3.1/§3.2 — `SECURITY DEFINER`, `set search_path=''`, `revoke all ... from public, anon`, `grant execute ... to authenticated`.

- [ ] **Step 4: Re-run CI to green**

- [ ] **Step 5: Commit**
```bash
git add supabase/migrations/20260905140100_chat_rpcs.sql supabase/tests/0019_chat_rpcs_and_rate_limit.test.sql
git commit -m "feat(chat): add post_chat_message and mark_chat_read"
```

---

## Task 4: `hide_chat_message`, rate limit, audit

**Files:**
- Modify: `supabase/migrations/20260905140100_chat_rpcs.sql` (add `hide_chat_message`; add the rate-limit guard to `post_chat_message` from Task 3 — this task extends that function via the same migration file since it hasn't shipped yet on any branch tip other than this one; if Task 3 already merged to a shared branch tip before this task starts, use `create or replace function` in a new migration instead — for this plan's own sequencing, both land in the same file since they're adjacent tasks on the same feature branch)
- Modify: `supabase/tests/0019_chat_rpcs_and_rate_limit.test.sql`

**Interfaces produced:**
```sql
public.hide_chat_message(p_message_id uuid, p_reason text) returns void
```
Exact body per spec §3.3, including the rate-limit clause added to `post_chat_message` per spec §3.1 (`>= 10` messages in the trailing 30 seconds).

- [ ] **Step 1: Write failing pgTAP**

- Sending 10 messages in immediate succession (same transaction, so `created_at` is effectively identical — acceptable, since the rate limit counts rows, not wall-clock spacing) succeeds; the 11th throws with a distinct error.
- `hide_chat_message` by a participant (non-admin) throws.
- `hide_chat_message` with an empty/whitespace reason throws.
- `hide_chat_message` on an existing participant message: sets `status='hidden'`, `hidden_at`/`hidden_by`/`hidden_reason` all populated correctly; the row still exists (`select count(*)` unchanged); `body` is **unchanged** in storage (only display-time substitution hides it — assert the raw column still holds the original text).
- `hide_chat_message` writes exactly one `audit_log` row: `entity_type='chat_message'`, `action='chat_message_hidden'`, `target_user_id` = the message's original sender, `note` = the reason, and neither `before_data`/`after_data`/`note` contains the message's `body` text (mirrors the "no roast text in the audit row" proof pattern from `supabase/tests/0017_game_master_rls_audit_cron.test.sql`).
- `hide_chat_message` on a row with `sender_type='game_master'` throws (there are no such rows yet in this plan — construct one directly via `insert ... sender_type='game_master'` as `postgres` to test this path in isolation, since the real GM insert path doesn't exist until Plan 3).

- [ ] **Step 2: Push, run, confirm failure**

- [ ] **Step 3: Implement**

- [ ] **Step 4: Re-run CI to green.** At this point run the full local gate placeholder check too — there is no frontend yet, so only the DB gates apply.

- [ ] **Step 5: Commit**
```bash
git add supabase/migrations/20260905140100_chat_rpcs.sql supabase/tests/0019_chat_rpcs_and_rate_limit.test.sql
git commit -m "feat(chat): add hide_chat_message, rate limit and moderation audit"
```

---

## Task 5: Ordering, pagination and read-state pgTAP

**Files:**
- Create: `supabase/tests/0020_chat_ordering_and_read_state.test.sql`

No new migration — this task proves the ordering/pagination contract that Tasks 2–4's schema and RPCs already establish, as its own reviewable test-only commit (mirrors GM1's Task 9 "prove isolation" pattern — a dedicated proof file, not folded into the feature commits).

- [ ] **Step 1: Write failing pgTAP** (it should mostly already pass given Tasks 2–4 — write it as a fresh, from-scratch fixture so it stands alone as documentation of the contract, and confirm it passes for the right reasons, not by accident)

- Insert 5 messages for one challenge; assert `seq` values are strictly increasing in insertion order.
- Upward pagination: `select * from chat_messages where challenge_id=$1 and seq < $2 order by seq desc limit 2` returns exactly the 2 messages immediately before the given `seq`, in the correct order.
- Unread count formula exactly matches spec §3.4: with `last_read_seq` set to the 3rd message's `seq`, `count(*) where seq > last_read_seq` equals 2 (the two after it) — including a **hidden** message in that range (assert it still counts, per spec §3.4's explicit "no additional exclusion beyond membership" decision).
- `mark_chat_read` called with the max real `seq` for the challenge, then called again with a smaller real `seq` from an **earlier** message: `last_read_seq` remains at the max (never regresses) — a second, independent proof of the same guarantee already unit-tested in Task 3, now exercised via a multi-message fixture closer to real usage.
- A `seq` value that has never been assigned to any row in **any** challenge (e.g. `999999999`) passed to `mark_chat_read` throws (belongs-to-no-challenge case, distinct from the belongs-to-a-different-challenge case already covered in Task 3).

- [ ] **Step 2: Push, run, confirm it exercises real behavior** (expect this to already pass if Tasks 2–4 are correct — if it fails, that means an earlier task has a defect; fix the defect in its own task's migration, not here)

- [ ] **Step 3: N/A — no implementation, this task is pure proof**

- [ ] **Step 4: Confirm green in CI**

- [ ] **Step 5: Commit**
```bash
git add supabase/tests/0020_chat_ordering_and_read_state.test.sql
git commit -m "test(chat): prove seq ordering, pagination and read-state contract"
```

---

## Task 6: Typed API layer

**Files:**
- Create: `src/features/chat/chat-api.ts`
- Create: `src/features/chat/chat-api.test.ts`

**Interfaces produced:**
```ts
export class ChatError extends Error {}
export async function postChatMessage(challengeId: string, body: string): Promise<ChatMessage>;
export async function markChatRead(challengeId: string, seq: number): Promise<void>;
export async function fetchRecentChatMessages(challengeId: string, limit?: number): Promise<ChatMessage[]>; // newest page, seq desc
export async function fetchOlderChatMessages(challengeId: string, beforeSeq: number, limit?: number): Promise<ChatMessage[]>;
export async function fetchUnreadCount(challengeId: string, userId: string): Promise<number>;
```

**Interfaces consumed:** `post_chat_message`, `mark_chat_read` RPCs (Tasks 3–4); direct `select` on `chat_messages`/`chat_read_state` (RLS-scoped, Task 2).

Follow the untyped-boundary pattern already established in `src/features/game-master/game-master-api.ts` (`const gmdb = supabase as unknown as SupabaseClient`, narrowing helpers `asRecord`/`jstr`/`jnum`) — the generated `Database` type has no knowledge of `chat_messages` until this plan's migrations are applied and `npm run db:types` runs (rollout, not this task).

- [ ] **Step 1: Write failing API tests**

Mock `@/lib/supabase` (pattern from `game-master-api.test.ts`) and assert:
- `postChatMessage` calls the RPC with **exactly** `{ p_challenge_id, p_body }` — no extra client-supplied field, no `sender_user_id`, no `sender_type`.
- `markChatRead` calls the RPC with exactly `{ p_challenge_id, p_seq }`.
- `fetchRecentChatMessages` orders `seq desc`, limits to the given count, never filters or sorts by `created_at`.
- `fetchOlderChatMessages` filters `seq < beforeSeq`, orders `seq desc`.
- `fetchUnreadCount` computes from `last_read_seq` vs. the max fetched `seq` set — or, simpler and to match spec §3.4 exactly, issues the same `count(*) where seq > last_read_seq` query server-side rather than fetching rows to count client-side; assert the query shape, not a client-side count.
- A transport failure from any function rejects with `ChatError`.

- [ ] **Step 2: Run and confirm failure**
```bash
npm run test -- src/features/chat/chat-api.test.ts
```

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run and confirm pass**
```bash
npm run test -- src/features/chat/chat-api.test.ts
npm run typecheck
```

- [ ] **Step 5: Commit**
```bash
git add src/features/chat/chat-api.ts src/features/chat/chat-api.test.ts
git commit -m "feat(chat): add typed chat API adapter"
```

---

## Task 7: `useChat` — TanStack Query + Realtime reconciliation

**Files:**
- Create: `src/features/chat/useChat.ts`
- Create: `src/features/chat/useChat.test.ts`

**Interfaces produced:**
```ts
export const chatKeys = {
  messages: (challengeId: string) => ['chat', 'messages', challengeId] as const,
  unread: (challengeId: string, userId: string) => ['chat', 'unread', challengeId, userId] as const,
};
export function useChatMessages(challengeId: string | null): UseInfiniteQueryResult<ChatMessage[]>; // seq-based pages, per Task 6
export function useUnreadChatCount(challengeId: string | null, userId: string | null);
export function usePostChatMessage();
export function useMarkChatRead();
```

This task is Realtime-**less** — polling/staleTime only (Task 10 adds the subscription on top without changing this hook's public shape, per spec §7's "TanStack Query remains canonical cache" principle: the Realtime handler will only ever call `invalidateQueries`/`setQueryData` against the keys already defined here).

- [ ] **Step 1: Write failing tests**

- `useChatMessages` returns pages sorted by `seq` ascending for display (newest at the bottom of a chat feed) even when the mocked `chat-api` returns them in `seq desc` (API) order — assert the hook, not the API, is responsible for final display ordering.
- Fetching the next (older) page uses the oldest currently-loaded `seq` as the cursor.
- `usePostChatMessage().mutate` never throws out of the caller (mirrors `useRequestGameMasterPulse`'s existing "safe to fire-and-forget" contract) — assert a mocked rejection doesn't propagate.
- `useMarkChatRead` invalidates `chatKeys.unread` on success.

- [ ] **Step 2: Run, confirm failure**
```bash
npm run test -- src/features/chat/useChat.test.ts
```

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run, confirm pass**

- [ ] **Step 5: Commit**
```bash
git add src/features/chat/useChat.ts src/features/chat/useChat.test.ts
git commit -m "feat(chat): add useChat TanStack Query hooks"
```

---

## Task 8: `ChatBubble` + `ChatPanel` (no mount yet)

**Files:**
- Create: `src/features/chat/ChatBubble.tsx`, `ChatBubble.module.css`, `ChatBubble.test.tsx`
- Create: `src/features/chat/ChatPanel.tsx`, `ChatPanel.module.css`, `ChatPanel.test.tsx`

**Interfaces consumed:** `useChatMessages`, `useUnreadChatCount`, `usePostChatMessage`, `useMarkChatRead` (Task 7); `Sheet`, `Button`, `Badge` (existing).

- [ ] **Step 1: Write failing component tests**

`ChatBubble.test.tsx`:
- Renders the unread count from `useUnreadChatCount`'s mocked value.
- Clicking it opens `ChatPanel` (or sets the open state the parent controls — implementation detail; test whatever the actual composition is).

`ChatPanel.test.tsx`:
- Renders messages newest-at-bottom, oldest-at-top, in `seq` order from a fixture that is **not** already sorted (proves the panel trusts `useChatMessages`'s ordering guarantee, not its own).
- A `status='hidden'` message fixture renders the literal string `[Borttaget av administratör]`, never its `body`.
- A `sender_type='game_master'` message fixture renders a visibly distinct sender label using the existing `Badge` component (`tone="neutral"`, text "GAME MASTER") — same visual vocabulary as `GameMasterArchive`/`GameMasterRunLog`, not a new tone.
- Date separators appear between messages whose `chatDateSeparatorKey` differ (Task 1's pure helper), using a fixed challenge timezone from a fixture, not the test runner's local timezone.
- The composer rejects (disables submit) empty/whitespace input and input over 1000 characters, client-side, in addition to the server being authoritative.
- A `useChatMessages` error state renders an understated empty/error state **inside the panel only** — the test wraps the panel in a harness that also renders unrelated sibling content and asserts that sibling content is unaffected (mirrors the `GameMasterAmbush`/`GameMasterArchive` isolation-test pattern).

- [ ] **Step 2: Run, confirm failure**
```bash
npm run test -- src/features/chat/ChatBubble.test.tsx src/features/chat/ChatPanel.test.tsx
```

- [ ] **Step 3: Implement**

`ChatPanel` renders inside the existing `Sheet` component on mobile (near-fullscreen: pass whatever `Sheet` prop combination achieves this, or a dedicated CSS variant if `Sheet` has no "near-fullscreen" mode yet — check `src/components/ui/Sheet.module.css` before assuming one needs to be added); on desktop, a smaller anchored floating panel (new CSS, not a `Sheet` — `Sheet` is a bottom-sheet/dialog pattern, not an anchored popover, so a lighter custom container is appropriate here, kept in `ChatPanel.module.css`). Mobile keyboard stability: use the same `visualViewport`-aware approach noted as new plumbing in spec §6 — implement it here, test it via a mocked `window.visualViewport` resize event asserting the composer stays in view.

- [ ] **Step 4: Run, confirm pass + build**
```bash
npm run test -- src/features/chat/ChatBubble.test.tsx src/features/chat/ChatPanel.test.tsx
npm run build
```

- [ ] **Step 5: Commit**
```bash
git add src/features/chat/ChatBubble.tsx src/features/chat/ChatBubble.module.css src/features/chat/ChatBubble.test.tsx \
        src/features/chat/ChatPanel.tsx src/features/chat/ChatPanel.module.css src/features/chat/ChatPanel.test.tsx
git commit -m "feat(chat): add ChatBubble and ChatPanel components"
```

---

## Task 9: Mount in `AppShell`, admin moderation UI, smoke coverage

**Files:**
- Modify: `src/components/layout/AppShell.tsx`
- Create: `src/features/admin/chat-admin-api.ts`
- Create: `src/features/admin/ChatModerationSheet.tsx`, `ChatModerationSheet.test.tsx`
- Modify: `src/pages/pages.smoke.test.tsx`

**Interfaces produced:**
```ts
// chat-admin-api.ts
export async function hideChatMessage(messageId: string, reason: string): Promise<void>;
export function useHideChatMessage();
```

- [ ] **Step 1: Write failing tests**

`ChatModerationSheet.test.tsx` (an admin-only affordance shown per-message inside `ChatPanel` when the viewer is an admin — reuses the `ConfirmSheet` mandatory-reason pattern from `GameMasterRunLog`'s cancel flow):
- Confirm button is `disabled` until a reason is typed; enabled once non-empty; calls `hideChatMessage(messageId, reason)` on confirm.
- A participant (non-admin) viewer never sees the moderation trigger at all (assert `queryByRole('button', { name: /dölj|ta bort/i })` is null when `isAdmin=false`).

`pages.smoke.test.tsx` additions (mirroring the existing Game Master smoke block):
- The authenticated shell renders a normal page (`HomePage`) with the chat bubble present but no panel open by default.
- A `fetchRecentChatMessages` rejection does not replace the host page with an error state.

- [ ] **Step 2: Run, confirm failure**
```bash
npm run test -- src/features/admin/ChatModerationSheet.test.tsx
npm run test -- src/pages/pages.smoke.test.tsx
```

- [ ] **Step 3: Implement.** Mount `<ChatBubble/>` in `AppShell.tsx` as a sibling of `<GameMasterAmbush/>` inside `<main>`.

- [ ] **Step 4: Run full suite + build**
```bash
npm run test
npm run build
```
(Known pre-existing flake in this repo: `AdminRetroactiveReview.test.tsx > requires a reason to reject` was already fixed this session via `delay: null` — if any *new* test in this plan shows the same `disabled` -> `toBeEnabled()` symptom after typing into a freshly-opened `Sheet`/`ConfirmSheet`, apply the identical `userEvent.setup({ delay: null })` fix immediately rather than re-diagnosing from scratch — the root cause (`Sheet`'s `requestAnimationFrame` autofocus racing `userEvent.type()`'s default per-keystroke delay) is already proven and documented in this project's git history.)

- [ ] **Step 5: Commit**
```bash
git add src/components/layout/AppShell.tsx src/features/admin/chat-admin-api.ts \
        src/features/admin/ChatModerationSheet.tsx src/features/admin/ChatModerationSheet.test.tsx \
        src/pages/pages.smoke.test.tsx
git commit -m "feat(chat): mount chat bubble in AppShell, add admin moderation UI"
```

---

## Task 10: Realtime

**Files:**
- Modify: `src/features/chat/useChat.ts`
- Modify: `src/features/chat/useChat.test.ts`

**Interfaces produced:** `useChatMessages` gains an internal `useEffect` subscription; no public signature change.

- [ ] **Step 1: Write failing tests**

- Simulate a Realtime `INSERT` payload arriving via a mocked channel; assert the query cache is invalidated/updated such that a subsequent read reflects the new row.
- Simulate **two** payloads arriving in reverse `seq` order (the higher-`seq` row's event fires first) and assert the final displayed list is still `seq`-ascending — proving the client never trusts arrival order (spec §2.2/§7).
- Assert the channel is created once per mounted challenge id and removed (`supabase.removeChannel`) on unmount — a spy on the mocked client's `removeChannel`.
- Assert the subscription filter is scoped to the open challenge (`filter: challenge_id=eq.<id>`).

- [ ] **Step 2: Run, confirm failure**
```bash
npm run test -- src/features/chat/useChat.test.ts
```

- [ ] **Step 3: Implement** the `useEffect` subscription exactly per spec §7. Add `alter publication supabase_realtime add table public.chat_messages;` if not already confirmed present from Task 2 (cross-check).

- [ ] **Step 4: Run, confirm pass**
```bash
npm run test -- src/features/chat/useChat.test.ts
npm run test
```

- [ ] **Step 5: Commit**
```bash
git add src/features/chat/useChat.ts src/features/chat/useChat.test.ts
git commit -m "feat(chat): enable Supabase Realtime for chat_messages"
```

---

## Task 11: Final integration, docs, release gate

**Files:**
- Create: `docs/CHAT.md`
- Review all Task 1–10 files for scope

- [ ] **Step 1: Document** (in `docs/CHAT.md`): the `seq`-vs-`created_at` ordering rule stated precisely (identity allocation order, not commit order, still the sole authority), the rate limit, moderation model, Realtime setup, and explicit non-goals (spec §16).

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
gh workflow run database-tests.yml --ref feat/shared-chat
```
Require: all prior suites (`0001`–`0020`) pass, `Result: PASS`.

- [ ] **Step 4: Review diff for scope.** Required: no `navigation.ts` change; no Game-Master file touched; no `weight_*` table/reference anywhere; no `service_role` key in any frontend file; no images/reactions/threads/DM/edit/delete affordance anywhere in `ChatPanel`.

- [ ] **Step 5: Commit**
```bash
git add docs/CHAT.md
git commit -m "docs(chat): document ordering, moderation and rollout"
```

- [ ] **Step 6: Report and stop** — branch name, HEAD, migration files, table/RPC list, JS test total, pgTAP total (`0018`–`0020`), GitHub Actions result URL, known risks. **Do not merge, db push, or deploy** — those require explicit approval (§ Rollout).

---

## Rollout (not executed by the implementation agent — recorded here for the approver)

1. Confirm Cloudflare deploy command is still `npx wrangler versions upload --assets=./dist` (paused) before merging.
2. Merge `feat/shared-chat` → `main`.
3. `npx supabase db push --linked --dry-run` — expect **exactly** `20260905140000_chat_schema.sql`, `20260905140100_chat_rpcs.sql`. Stop and report if anything else is proposed.
4. Apply: `npx supabase db push --linked`.
5. `npm run db:types`; review the diff (expect only `chat_messages`/`chat_read_state` tables and the three RPC signatures added, nothing else changed) — commit `src/types/database.ts` if it's the only diff.
6. Re-run all five local gates; confirm `git status` clean.
7. Restore Cloudflare's deploy command to `npx wrangler deploy`; retry the latest `main` build.
8. Live smoke test: post a message as one account, see it appear (Realtime) on a second logged-in session without a manual refresh; unread badge decrements correctly on open; moderate a message as admin, confirm the placeholder appears for a participant viewer; confirm KASSAN/streak/ranking/Straffbanken/training logging are visibly unaffected.
9. Rollback consideration: this plan's migrations are purely additive (two new tables, no altered existing table, no altered existing function) — a rollback is "stop using the feature," not a schema reversal; if a severe issue appears, disabling is done by removing the `<ChatBubble/>` mount (a one-line frontend revert) without touching the database at all, since nothing existing depends on these new tables.
