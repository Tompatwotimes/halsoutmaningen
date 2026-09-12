# Hälsoutmaningen — PWA + Web Push Notifications V1 Design Specification

**Date:** 2026-09-11
**Status:** Design/spec — implementation proceeds immediately after this document (see companion plan)
**Product:** Hälsoutmaningen
**Scope:** Installable PWA shell + VAPID Web Push notifications, v1
**Depends on:** `challenge_day_states`/`challenge_current_date` (daily requirement engine), `post_chat_message`/`set_chat_message_like` (chat), `_run_game_master_pulse` (Game Master), `assign_penalty` (Straffbanken), `approve_retroactive_registration` (retroactive registration) — all **read-only / additive-hook** dependencies, nothing here redefines their behavior.
**Depended on by:** nothing yet.

---

## 0. Global principles (restated, binding)

- The core challenge is sacred. Nothing here changes completed/missed day state, training debt/liability, KASSAN, streaks, ranking, Straffbanken, or retroactive-registration behavior. This feature only **observes** those systems and enqueues notifications.
- Every write goes through a `SECURITY DEFINER` RPC (`set search_path = ''`, schema-qualified, `revoke ... from public, anon`, `grant execute ... to authenticated` only where a client calls directly) — the house convention.
- Never trust the frontend for anything authoritative (subscription ownership, preference ownership, delivery state).
- Additive-only migrations: new tables/columns/functions/indexes/triggers/cron/RLS. No destructive change to any existing table, policy, or function signature (GM's `_run_game_master_pulse` INSERT gains one new decision, not a rewrite).
- Never put a signed proof/chat-image URL in a push payload. Never increase Storage egress. Never touch image processing, signed-URL TTL, or the lightbox.
- VAPID private key lives only in Supabase hosted secrets. Never logged, never committed, never in a frontend bundle.

---

## 1. Product scope (v1, locked)

### 1.1 Notification categories

| Category | Trigger | Recipient | Deep link |
|---|---|---|---|
| Reply | someone replies to your chat message | the replied-to sender | chat, jump to message |
| Like | someone likes your chat message | the message sender | chat, jump to message |
| All-chat (opt-in) | any new chat message | everyone who opted in | chat, jump to message |
| Straffbanken | a penalty is assigned to you | the affected participant | Straffbanken |
| Game Master | a GM event fires that already carries `push_enabled` | the GM event's target/audience | chat (GM event materializes as a chat message) |
| Training reminder 19:00 | you have not completed today and today is not over | you, if not yet completed | Today / logging |
| Training reminder 22:00 | you still have not completed today | you, if not yet completed | Today / logging |
| Important personal status | e.g. your retroactive registration is approved/rejected, an admin correction affects you | you | relevant page |
| Daily group — first completed day | the first participant of the day completes their training (event-driven) | everyone (opted in) except the completer | group dashboard |
| Daily group — 06:30 morning report | timezone-aware daily summary of yesterday | everyone (opted in) | group dashboard |

### 1.2 Anti-spam / dedupe rules (locked)

- One outbox row per (category, recipient, natural key) — a unique partial index prevents double-enqueueing the same logical event.
- Training reminders never fire once the user has already completed today (checked twice: once at enqueue time, once again at send time via `challenge_day_states`).
- "First completed day" fires **at most once per challenge per day** — a `unique (challenge_id, challenge_date)` claim row makes the first successful claim atomic; only the winner enqueues the notification. Excludes retroactive/backfilled/admin-corrected entries (see §3.4) — only a live same-day `training_entries` insert with `challenge_date = challenge_current_date(challenge_id)` at insert time can win the claim.
- All-chat notifications are opt-in (default OFF) and never fire for the message's own author.
- Reply/like notifications never fire for self-reply/self-like (already structurally impossible — RPCs use `auth.uid()` for the actor and compare against the target row's owner).
- A push is collapsed with `Notification.tag` per category+natural-key so re-showing the same logical event never stacks duplicate OS notifications.
- Every challenge has a kill switch (`challenges.push_enabled`, default true) — when false, the scheduler/producers skip enqueueing for that challenge entirely. Existing challenge rows default true (backward compatible, no behavior change for the running challenge until explicitly wanted).
- A user with no active `push_subscriptions` row simply never gets an outbox row claimed for them (the dispatcher's join naturally filters this) — no wasted work.

### 1.3 iOS/Android install UX

- Standard `manifest.webmanifest` (already present, extended with real PNG icons incl. maskable) + a minimal service worker registered from `src/main.tsx`.
- Android/desktop Chrome: capture `beforeinstallprompt`, expose an explicit "Installera appen" affordance (not auto-prompted) in Profile → Notiser.
- iOS Safari has no `beforeinstallprompt`. Detect iOS + not-standalone and show static "Lägg till på hemskärmen" instructions (Dela → Lägg till på hemskärmen). iOS also requires the PWA be installed (standalone) before `Notification`/Push APIs work at all — the UI must explain this ordering.
- Permission request happens **only** on an explicit user tap of an "Aktivera notiser" control — never automatically on load (browsers increasingly block/annoy auto-prompts, and this matches the product's respectful tone).

### 1.4 Frontend surface

- Profile → **Notiser** card (new, sibling to the existing Utseende card): per-category toggles, install affordance, permission state, "skicka testnotis" self-test button (calls the dispatcher's self-test path), and a clear explanation of what each category means.
- Deep links reuse the existing chat jump-to-message mechanism (`?msg=<id>` style already used for reply-preview navigation) — no new jump logic invented.
- Logout clears the local push subscription registration path (unsubscribes the browser `PushSubscription` and calls the unregister RPC) so a shared/borrowed device does not keep receiving another user's notifications.

---

## 2. Data model (new, additive)

```sql
alter table public.challenges
  add column push_enabled boolean not null default true;

create table public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  endpoint     text not null,
  p256dh       text not null,
  auth_key     text not null,
  user_agent   text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  -- Set on a permanent delivery failure (404/410); retired subscriptions are
  -- never claimed again but kept for audit until the user re-subscribes.
  retired_at   timestamptz,
  unique (endpoint)
);

create table public.notification_preferences (
  user_id                uuid not null references public.profiles (id) on delete cascade,
  challenge_id           uuid not null references public.challenges (id) on delete cascade,
  chat_reply             boolean not null default true,
  chat_like              boolean not null default true,
  chat_all_messages      boolean not null default false,
  straffbanken           boolean not null default true,
  game_master            boolean not null default true,
  training_reminders     boolean not null default true,
  personal_status        boolean not null default true,
  daily_group_summary    boolean not null default true,
  updated_at             timestamptz not null default now(),
  primary key (user_id, challenge_id)
);

create table public.notification_outbox (
  id             uuid primary key default gen_random_uuid(),
  challenge_id   uuid not null references public.challenges (id) on delete cascade,
  recipient_id   uuid not null references public.profiles (id) on delete cascade,
  category       text not null check (category in (
                   'chat_reply', 'chat_like', 'chat_all', 'straffbanken',
                   'game_master', 'training_reminder_19', 'training_reminder_22',
                   'personal_status', 'daily_first_completed', 'daily_morning_report'
                 )),
  -- Dedupe key: unique per (challenge, recipient, category, natural_key).
  natural_key    text not null,
  title          text not null,
  body           text not null,
  url            text not null,          -- deep link, app-relative path only
  tag            text not null,          -- Notification.tag collapsing key
  created_at     timestamptz not null default now(),
  not_before     timestamptz not null default now(),  -- scheduling / grace window
  claimed_at     timestamptz,
  claimed_by     text,                    -- dispatcher run id, diagnostic only
  sent_at        timestamptz,
  failed_at      timestamptz,
  attempt_count  integer not null default 0,
  last_error     text,
  unique (challenge_id, recipient_id, category, natural_key)
);

create table public.notification_deliveries (
  id                  uuid primary key default gen_random_uuid(),
  outbox_id           uuid not null references public.notification_outbox (id) on delete cascade,
  subscription_id     uuid not null references public.push_subscriptions (id) on delete cascade,
  sent_at             timestamptz,
  status_code         integer,
  outcome             text check (outcome in ('sent', 'retired', 'retry', 'failed')),
  attempt_count       integer not null default 0,
  created_at          timestamptz not null default now(),
  unique (outbox_id, subscription_id)
);
```

Notes:
- `notification_outbox` is the durable queue. Producers (RPC triggers, the scheduler) only ever `insert ... on conflict (challenge_id, recipient_id, category, natural_key) do nothing` — dedupe is structural, not app-logic.
- `notification_deliveries` is per-(outbox row × subscription) so a user with two devices gets two independent delivery attempts/retries without one blocking the other, and a permanently-failing device doesn't poison the outbox row for their other device.
- No signed URLs, no proof/chat image data, no free-text chat body beyond a short truncated preview (locked: category-appropriate generic copy, e.g. "Ny gillning på ditt meddelande" — never quote the message body verbatim, to avoid a stale/hidden-message leak).

RLS: `push_subscriptions` and `notification_preferences` — owner-only select/insert/update via RPC (no direct table policy for write; select restricted to `user_id = auth.uid()`). `notification_outbox`/`notification_deliveries` have **no** client-facing SELECT policy at all (service-role/Edge Function only) — nothing here is app-readable; they are operational tables only the dispatcher touches (matches `game_master_runs`' invisibility pattern).

---

## 3. Producer hooks (additive triggers/RPC extensions)

### 3.1 Chat reply/like

- `AFTER INSERT` trigger on `chat_messages` (mirrors `tg_training_entry_chat_card`): when `reply_to_message_id is not null`, enqueue `chat_reply` for the parent message's `sender_user_id` (skip if null/self/GM).
- `AFTER INSERT OR UPDATE` trigger on `chat_message_likes` (fires from inside `set_chat_message_like`'s state transition): enqueue `chat_like` for the message owner when a like becomes newly active (`v_changed` transition to liked=true), skip self-like/GM message.
- `AFTER INSERT` trigger on `chat_messages` for `chat_all`: for every OTHER active member with `chat_all_messages = true` in `notification_preferences`, enqueue one row (natural_key = the message id — one notification per message per opted-in recipient, deduped structurally).

### 3.2 Straffbanken

`assign_penalty` (`20260902090400_penalty_engine.sql`) gains one additional `insert into notification_outbox` for the affected participant after the existing `earned_penalties`/`penalty_assignments` write — same transaction, so a penalty and its notification are enqueued atomically or not at all.

### 3.3 Game Master

`_run_game_master_pulse`'s existing `insert into game_master_events (...)` gains a `push_enabled` boolean column (new, additive, defaults per-template — set from `game_master_templates` metadata already present, or `true` if unspecified). A new `AFTER INSERT` trigger on `game_master_events` enqueues `game_master` category rows for the event's audience (public event → all active members; targeted event → the named participant) only when `push_enabled`. GM's own cooldown/scoring logic is untouched.

### 3.4 Training first-completion + reminders

- `AFTER INSERT` trigger on `training_entries`, gated to fire only when `new.challenge_date = public.challenge_current_date(new.challenge_id)` at insert time (this is the structural exclusion for retroactive/backfill/admin-correction paths: `approve_retroactive_registration` inserts with the **historical** `challenge_date`, which is never today, so this condition is false there by construction — no extra flag needed, verified against §"approve_retroactive_registration" body which passes `v_req.challenge_date`).
- On such an insert, attempt `insert into public._daily_first_completion_claims (challenge_id, challenge_date) values (...) on conflict do nothing returning 1` — win → enqueue `daily_first_completed` for every other active opted-in member.
- Reminders (19:00/22:00) and the 06:30 morning report are **not** trigger-driven — they're produced by a scheduler function (§4) that reads `challenge_day_states` directly, so they always reflect current truth regardless of write order.

### 3.5 Personal status

`approve_retroactive_registration` / `reject_retroactive_registration` gain one `insert into notification_outbox` each (category `personal_status`, natural_key = the request id) for the requester.

---

## 4. Scheduler (`public._notification_scheduler_tick()`)

Runs hourly via `pg_cron` (same guarded `do $$ ... exception when others ...$$` registration pattern as `_game_master_tick_all`), and is also callable directly by the dispatcher self-test path.

For each **active, push-enabled** challenge, using `challenge_current_date`/`now() at time zone challenge.timezone`:

- **19:00 / 22:00 local reminder**: only fires in the hour window `[19:00, 19:59]` / `[22:00, 22:59]` local time (grace window absorbs cron jitter and DST — checked by local wall-clock hour, not UTC offset math, so a DST transition day still lands in the right local hour). For each eligible member whose `challenge_day_states` row for today is `pending` (not yet completed, day not over) and who has `training_reminders = true`, enqueue with `natural_key = today::text`.
- **06:30 morning report**: fires in the window `[06:30, 07:29]` local time. For each opted-in member, enqueue one `daily_morning_report` row summarizing **yesterday** (`challenge_date = yesterday`), `natural_key = yesterday::text`. Content: group completion count for yesterday (`N av M tränade igår`) — computed via `challenge_day_states`, never a duplicated counter.

The unique index on `notification_outbox` makes the hourly tick idempotent even if it runs twice in the same hour (a repeat tick inside the same window is a structural no-op via `on conflict do nothing`).

---

## 5. Dispatcher (Supabase Edge Function `notification-dispatcher`)

- Deno, same conventions as `invite-participant` (`npm:` specifiers, `_shared/cors.ts`, JSON response helper).
- `npm:web-push@3` for VAPID-signed payload encryption/delivery (well-established library; avoids hand-rolling ECDH/AES-GCM).
- Reads `WEB_PUSH_VAPID_PUBLIC_KEY` / `WEB_PUSH_VAPID_PRIVATE_KEY` / `WEB_PUSH_VAPID_SUBJECT` from Supabase secrets (service-role client).
- Claim loop: `select ... from notification_outbox where sent_at is null and failed_at is null and not_before <= now() for update skip locked limit 50`, batched; for each claimed row, fan out to every non-retired `push_subscriptions` row for `recipient_id`, insert/update the matching `notification_deliveries` row.
- Per-delivery outcome:
  - `201/2xx` → `outcome='sent'`.
  - `404/410` → `outcome='retired'`, set `push_subscriptions.retired_at`.
  - `429/5xx` → `outcome='retry'`, bounded to 5 attempts with exponential backoff via `not_before` bump on the **outbox** row (only if at least one delivery still needs retry); beyond 5 attempts → `failed_at`.
  - other 4xx → `outcome='failed'` for that delivery only (bad key etc.), does not retry.
- Outbox row is marked `sent_at = now()` once every delivery for it has reached a terminal state (`sent`/`retired`/`failed`) with at least one `sent`, or `failed_at = now()` if all deliveries terminally failed/retired with none sent.
- A second action, `self-test`, lets an authenticated caller send themselves one real push through the same code path (used by the Profile → Notiser "skicka testnotis" button) — bypasses the outbox, still goes through the same VAPID send + delivery bookkeeping shape for a synthetic one-off outbox row.
- Scheduled invocation: `pg_cron`'s `_notification_scheduler_tick()` only **enqueues**; a separate lightweight cron entry (or the same hourly tick, via `pg_net`/HTTP call if available, else a GitHub Actions scheduled workflow calling the function URL with the service role key as a repo secret) invokes the dispatcher itself to **send** on a tighter cadence (every 1–2 minutes) so enqueued rows don't sit for up to an hour. Given `pg_net` availability is unconfirmed on this project's plan, the safe default is a scheduled GitHub Actions workflow (`.github/workflows/notification-dispatch.yml`, `workflow_dispatch` + `schedule: */2 * * * *` is not allowed by GitHub's 5-minute minimum, so `*/5 * * * *`) calling the Edge Function with a `CRON_SECRET` bearer matched inside the function — this keeps the sensitive VAPID key server-side while giving a real, working scheduler without requiring `pg_net`.

---

## 6. Frontend

- `src/sw.ts` (compiled/copied to `/sw.js` at build, or hand-written plain JS in `public/sw.js` — a minimal SW does not need bundling) — no caching (`fetch` handler absent, deliberately non-PWA-offline for v1: this is a notification/installability shell, not an offline-first app, avoiding stale-content risk on a rapidly-iterating app). Handles `push` (show `Notification` from the JSON payload, using `tag` for collapsing) and `notificationclick` (focus/open the deep-link `url`).
- `src/features/push/` — subscribe/unsubscribe helpers (`PushManager.subscribe` with the VAPID public key fetched from a public config endpoint or baked into `import.meta.env.VITE_WEB_PUSH_VAPID_PUBLIC_KEY`, which is safe to expose — it's the public VAPID key by design), RPCs `register_push_subscription`/`unregister_push_subscription`, `get_notification_preferences`/`update_notification_preferences`.
- `src/features/pwa/` — `beforeinstallprompt` capture hook, iOS detection + instructions component.
- Profile → Notiser card wired into `ProfilePage.tsx`, theme-aware (tokens only, no hardcoded colors — same discipline as the rest of the redesign).
- Logout flow (wherever the existing sign-out action lives) calls `unregister_push_subscription` + `PushSubscription.unsubscribe()` before clearing the session.

---

## 7. Testing

- pgTAP (`supabase/tests/0031_notifications_schema_rls.test.sql`, `0032_notifications_producers.test.sql`, `0033_notifications_scheduler.test.sql`) run via the existing `database-tests.yml` CI (no local Docker needed — matches how every prior DB feature in this repo was validated pre-merge).
- DST safety: a test that pins a challenge timezone and asserts the scheduler's local-hour window logic (not UTC arithmetic) picks the correct hour across a spring-forward/fall-back date.
- Concurrency: a test that fires two concurrent `training_entries` inserts for the same (challenge, date) from two different users and asserts exactly one `daily_first_completed` outbox row exists.
- Frontend Vitest: push subscribe/unsubscribe hooks, preferences UI, iOS-instructions component, service-worker payload-shape unit test (pure function extracted from `sw.js` for testability), deep-link URL builder.
- Edge Function: a Deno test for the claim/retry/retirement state machine using a fake `web-push` transport.

---

## 8. Rollout order

1. Migrations (schema + RLS + producer triggers + scheduler + cron registration).
2. `supabase secrets set` — VAPID keypair (generated once, printed nowhere in reports).
3. Deploy `notification-dispatcher` Edge Function.
4. Frontend release (manifest icons, service worker, push UI) via the existing gated `deploy-production.yml` workflow.
5. GitHub Actions scheduled dispatch workflow + its `CRON_SECRET`/function-URL repo secrets.
6. Production smoke: confirm migrations applied, function responds, scheduler enqueues on manual trigger — explicitly not claiming real end-device push delivery unless actually observed.
