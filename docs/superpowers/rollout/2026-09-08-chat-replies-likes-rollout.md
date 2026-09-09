# Rollout runbook — Shared Chat: ❤️ likes + ↩️ replies

**Status:** prepared, NOT executed. Every step below is a human gate.
**Branch:** `feat/chat-replies-likes` → PR into `main`.
**Migration:** `supabase/migrations/20260908120000_chat_replies_likes.sql` (one file).
**Model:** DB-first. The migration is a strict additive superset — OLD frontend +
NEW DB is safe; deploy the DB before the frontend.

Baseline at preparation time:

| ref | SHA |
| --- | --- |
| `origin/main` | `b72af65793c1c11af71e27b40ef32959fdcbb0e3` |
| `origin/production` | `b72af65793c1c11af71e27b40ef32959fdcbb0e3` |
| `feat/chat-replies-likes` HEAD | `280239c` (+ this doc) |
| production migrations applied | 27 (latest `20260907120000`) |

---

## 0. Pre-merge (already true when this doc was written)

- Frontend quality matrix on the branch is green: `npm run typecheck`,
  `npm run lint`, `npm run format:check`, `npm run test` (74 files / 751 tests),
  `npm run build`.
- Database Tests CI (`gh workflow run "Database Tests" --ref feat/chat-replies-likes`)
  green — `supabase/tests/0030_chat_replies_likes.test.sql`, `plan(147)`.
- No change to any Game Master, weight, Straffbanken, ranking, streak, debt or
  core-challenge path.

## 1. Merge the PR into `main`  **(human gate — merge)**

Normal squash-or-merge of `feat/chat-replies-likes → main`. Do NOT touch
`production` yet.

## 2. Fresh baseline check

```bash
git fetch origin
git rev-parse origin/main          # → the merge commit
git rev-parse origin/production    # → still b72af657… (unchanged)
git checkout main && git pull
```

## 3. Post-merge gates on `main`

```bash
npm ci
npm run typecheck && npm run lint && npm run format:check && npm run test && npm run build
```

All green before continuing.

## 4. Dry-run the migration  **(human gate — hosted DB)**

```bash
SUPABASE_ACCESS_TOKEN="$(cat ~/.supabase/access-token)" \
  npx --no-install supabase db push --linked --dry-run
```

The output **must** propose **exactly one** migration:
`20260908120000_chat_replies_likes`. If it proposes anything else → **STOP**,
investigate, do not apply.

## 5. Apply the migration  **(human gate — hosted DB)**

```bash
SUPABASE_ACCESS_TOKEN="$(cat ~/.supabase/access-token)" \
  npx --no-install supabase db push --linked
```

Same approved mechanism used for `20260907120000`.

## 6. Live read-only verification

Using a read-only query tool (`scratchpad/sbq.mjs` or the SQL editor), confirm:

- **migration count is now 28**; `20260908120000` is listed.
- `chat_messages.reply_to_message_id` exists, `is_nullable = YES`.
  - FK `chat_messages_reply_to_fk` present, `ON DELETE SET NULL`.
  - CHECK `chat_messages_reply_not_self` present.
  - Partial index `chat_messages_reply_to_idx` present.
- `chat_message_likes` table exists; PK `(message_id, user_id)`; RLS enabled;
  policy `chat_message_likes_select` uses `public.is_admin()`; **no**
  INSERT/UPDATE/DELETE policy.
  - FK `chat_message_likes_message_fk` `(message_id, challenge_id) → chat_messages(id, challenge_id)` `ON DELETE CASCADE`.
  - FK `user_id → profiles(id)` `ON DELETE CASCADE`.
- `set_chat_message_like(uuid, boolean)` exists; `EXECUTE` granted to
  `authenticated` only (not `anon`, not `public`).
- `post_chat_message` has **exactly one** overload, arity 5
  `(uuid, text, uuid, jsonb, uuid)`. The old 4-arg overload is gone.
- `_create_chat_message(uuid, text, uuid, jsonb, uuid)` exists and is **not**
  granted to `anon` / `authenticated` / `public`.
- `list_chat_messages(uuid, bigint, integer)` return type includes
  `like_count integer`, `liked_by_me boolean`, `reply_preview jsonb`.
- `pg_publication_tables` for `supabase_realtime` still lists **only**
  `chat_activity` among the chat/training tables — **not** `chat_message_likes`,
  `chat_messages`, `training_entries`, `training_proofs`.

## 7. ZERO historical data proof  (mandatory)

```sql
select count(*) from public.chat_message_likes;                              -- → 0
select count(*) from public.chat_messages where reply_to_message_id is not null; -- → 0
```

No backfill, no synthetic rows.

## 8. Old frontend on the new DB  (smoke — the current `production` deploy is still live)

The live frontend is still the pre-feature bundle and now talks to the migrated
DB. Confirm (or reason from §22.1 of the design):

- posting a normal message works — `post_chat_message` 5-arg resolves the old
  2-key / 4-key call shape via PostgREST default-filling.
- image messages, training cards, scroll, unread badge all still work — the old
  `mapChatRow` simply ignores `like_count` / `liked_by_me` / `reply_preview`.

## 9. Regenerate DB types

```bash
cp src/types/database.ts /tmp/database.ts.before
SUPABASE_ACCESS_TOKEN="$(cat ~/.supabase/access-token)" \
  npx --no-install supabase gen types typescript --linked \
  --schema public --schema graphql_public > src/types/database.ts
git diff --stat src/types/database.ts
```

The diff must be **additive** — new `chat_message_likes` types,
`reply_to_message_id`, `set_chat_message_like`, the three new
`list_chat_messages` return fields, the `post_chat_message` 5th arg. If it shows
mass deletions / re-orderings only → restore `/tmp/database.ts.before` and retry
(known CLI footgun).

> The chat adapter (`chat-api.ts`) deliberately casts through
> `supabase as unknown as SupabaseClient` so it already compiles against the
> un-regenerated types; regenerating is a tidy-up, not a blocker, but do it
> before promoting the frontend so `npm run typecheck` reflects the live schema.

## 10. Final gates on `main` with regenerated types

```bash
npm run typecheck && npm run lint && npm run test && npm run build
```

## 11. Commit the generated types

```bash
git add src/types/database.ts
git commit -m "chore: regenerate types after chat replies + likes migration"
git push origin main
```

## 12. Promote to production  **(human gate — production deploy)**

```bash
git checkout production && git pull
git merge --ff-only main
git push origin production
```

Cloudflare Workers Builds deploys the new frontend against the already-migrated
DB. Likes + replies go live here.

## 13. Post-deploy checkpoint

- new bundle served (hashed `index-*.js` changed); runtime Supabase config
  present (verify non-empty — do not print the anon key).
- from a test account: a real ❤️ and a real ↩️ reply work end-to-end and appear
  over Realtime on a second session.
- the unread badge does **not** move when a like lands.
- an admin-hidden message drops its like badge / actions for a non-admin, and a
  reply to it shows `[Borttaget av administratör]` in the quote.
- swipe-to-reply on a phone arms the composer without triggering iOS back-swipe;
  double-tap a photo hearts it and shows no viewer.

## Do NOT, during rollout

- touch David's account; run `purge-david.sql` / `storage-rm.mjs`.
- synthesize likes or replies.
- change the Cloudflare preview environment config (known gap, out of scope).
- implement avatars / @mentions / notifications / Web Push / jury / GM changes.
- `git add -A` — stage explicit paths; leave
  `claude_code_inspection_prompt_chat_weight_gamemaster.txt` untracked and
  locally excluded.

## Rollback

- **Frontend:** `git checkout production && git reset --hard b72af657 && git push --force-with-lease origin production` (redeploys the pre-feature bundle). The migrated DB stays — it is a superset, the old bundle ignores the new columns.
- **DB:** no down-migration. `chat_message_likes` and `reply_to_message_id` are
  additive and inert without the new frontend; leave them. Only if truly
  required, a follow-up migration can `drop table public.chat_message_likes` and
  `alter table public.chat_messages drop column reply_to_message_id` plus restore
  the previous `list_chat_messages` / `post_chat_message` definitions from
  `20260907120000` and earlier.
