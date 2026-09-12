-- ============================================================================
-- Hälsoutmaningen — PWA + Web Push Notifications V1 / 0031  schema + RLS
--
-- Spec: docs/superpowers/specs/2026-09-11-pwa-push-v1-design.md
-- Plan: docs/superpowers/plans/2026-09-11-pwa-push-v1.md (Task 1)
--
-- Depends on 0001–0030. Forward-only, ADDITIVE. Nothing here changes any
-- existing table's behaviour, column or policy. This migration adds:
--
--   challenges.push_enabled          per-challenge kill switch (default true —
--                                     no behaviour change for the running
--                                     challenge until a producer exists)
--   push_subscriptions               one row per browser PushSubscription
--   notification_preferences         per-(user, challenge) category opt-in/out
--   notification_outbox              durable queue, one row per notification
--   notification_deliveries          one row per (outbox row × subscription)
--   _daily_first_completion_claims   atomic "first completed day" claim table
--
-- notification_outbox / notification_deliveries /
-- _daily_first_completion_claims carry no message content beyond short
-- generic copy (never a quoted chat body, never a signed image URL) and are
-- operational tables: admin-only SELECT, no client write path at all — every
-- write is a producer trigger or the dispatcher Edge Function (service role).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. challenges.push_enabled — per-challenge kill switch
-- ----------------------------------------------------------------------------
alter table public.challenges
  add column push_enabled boolean not null default true;

comment on column public.challenges.push_enabled is
  'Kill switch for the whole Web Push subsystem, scoped to this challenge. '
  'When false, no producer trigger and no scheduler tick enqueues a '
  'notification_outbox row for this challenge. Defaults true (no behaviour '
  'change until a producer exists); an admin can flip it off per challenge.';

-- ----------------------------------------------------------------------------
-- 2. push_subscriptions — one row per browser PushSubscription
-- ----------------------------------------------------------------------------
create table public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  endpoint     text not null
                 constraint push_subscriptions_endpoint_len
                 check (char_length(endpoint) between 1 and 2000),
  p256dh       text not null
                 constraint push_subscriptions_p256dh_len
                 check (char_length(p256dh) between 1 and 400),
  auth_key     text not null
                 constraint push_subscriptions_auth_key_len
                 check (char_length(auth_key) between 1 and 200),
  user_agent   text
                 constraint push_subscriptions_user_agent_len
                 check (user_agent is null or char_length(user_agent) <= 400),
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  -- Set once a delivery to this endpoint comes back 404/410 (permanently
  -- gone). A retired subscription is never claimed again but the row is kept
  -- for audit until the browser re-subscribes (a fresh endpoint => a new row).
  retired_at   timestamptz,

  constraint push_subscriptions_endpoint_unique unique (endpoint)
);

comment on table public.push_subscriptions is
  'One row per browser PushSubscription. Written only by '
  'register_push_subscription / unregister_push_subscription (0032). Never '
  'exposes another user''s endpoint/keys — a client only ever reads its own '
  'rows via RLS.';

create index push_subscriptions_user_idx
  on public.push_subscriptions (user_id)
  where retired_at is null;

alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;
grant select on public.push_subscriptions to authenticated;

create policy push_subscriptions_select on public.push_subscriptions
  for select to authenticated
  using (user_id = (select auth.uid()));

comment on policy push_subscriptions_select on public.push_subscriptions is
  'Owner-only. No admin override — a push endpoint/key pair is a device '
  'credential, not social/social-transparency data, and no admin workflow '
  'needs to read another participant''s.';

-- No INSERT / UPDATE / DELETE policy: register_push_subscription /
-- unregister_push_subscription (0032) are the only writers.

-- ----------------------------------------------------------------------------
-- 3. notification_preferences — per (user, challenge) opt-in/out
-- ----------------------------------------------------------------------------
create table public.notification_preferences (
  user_id             uuid not null references public.profiles (id) on delete cascade,
  challenge_id        uuid not null references public.challenges (id) on delete cascade,
  chat_reply          boolean not null default true,
  chat_like           boolean not null default true,
  -- Opt-in, default OFF: "every chat message" is high-volume by nature.
  chat_all_messages   boolean not null default false,
  straffbanken        boolean not null default true,
  game_master         boolean not null default true,
  training_reminders  boolean not null default true,
  personal_status     boolean not null default true,
  daily_group_summary boolean not null default true,
  updated_at          timestamptz not null default now(),
  primary key (user_id, challenge_id)
);

comment on table public.notification_preferences is
  'Per-(user, challenge) notification category toggles. A missing row means '
  'every column''s table default applies (get_notification_preferences, 0032, '
  'materialises the defaults on first read so the client always sees a full '
  'row). Written only by update_notification_preferences (0032).';

alter table public.notification_preferences enable row level security;
revoke all on public.notification_preferences from anon, authenticated;
grant select on public.notification_preferences to authenticated;

create policy notification_preferences_select on public.notification_preferences
  for select to authenticated
  using (user_id = (select auth.uid()));

-- No INSERT / UPDATE / DELETE policy: update_notification_preferences (0032)
-- is the only writer.

-- ----------------------------------------------------------------------------
-- 4. notification_outbox — the durable queue
-- ----------------------------------------------------------------------------
create table public.notification_outbox (
  id            uuid primary key default gen_random_uuid(),
  challenge_id  uuid not null references public.challenges (id) on delete cascade,
  recipient_id  uuid not null references public.profiles (id) on delete cascade,
  category      text not null
                  constraint notification_outbox_category_valid
                  check (category in (
                    'chat_reply', 'chat_like', 'chat_all', 'straffbanken',
                    'game_master', 'training_reminder_19',
                    'training_reminder_22', 'personal_status',
                    'daily_first_completed', 'daily_morning_report'
                  )),
  -- Dedupe key: the natural identity of the underlying event within its
  -- category (a message id, a request id, an ISO date, ...). The unique
  -- index below is the structural anti-duplicate guarantee — every producer
  -- inserts with `on conflict (...) do nothing`.
  natural_key   text not null
                  constraint notification_outbox_natural_key_len
                  check (char_length(natural_key) between 1 and 200),
  title         text not null
                  constraint notification_outbox_title_len
                  check (char_length(title) between 1 and 120),
  body          text not null
                  constraint notification_outbox_body_len
                  check (char_length(body) between 1 and 300),
  -- App-relative deep link only (e.g. "/?chat=1&msg=<uuid>") — never an
  -- absolute URL, never a signed Storage URL.
  url           text not null
                  constraint notification_outbox_url_relative
                  check (url like '/%' and url not like '//%'),
  tag           text not null
                  constraint notification_outbox_tag_len
                  check (char_length(tag) between 1 and 150),
  -- Set only by the three chat producers (reply/like/all). Lets the
  -- dispatcher re-check moderation state at SEND time, not just at enqueue
  -- time — a message hidden between being queued and being sent must not
  -- have its push delivered ("skip its chat push where practical", spec §2).
  -- The push copy itself never quotes a body either way (defense in depth).
  source_message_id uuid references public.chat_messages (id) on delete set null,
  created_at    timestamptz not null default now(),
  -- Scheduling / grace window: the dispatcher never claims a row before this.
  not_before    timestamptz not null default now(),
  claimed_at    timestamptz,
  claimed_by    text,
  sent_at       timestamptz,
  failed_at     timestamptz,
  attempt_count integer not null default 0,
  last_error    text
                  constraint notification_outbox_last_error_len
                  check (last_error is null or char_length(last_error) <= 1000),

  constraint notification_outbox_natural_key_unique
    unique (challenge_id, recipient_id, category, natural_key)
);

comment on table public.notification_outbox is
  'Durable notification queue. Every producer (trigger or scheduler tick) '
  'inserts with `on conflict (challenge_id, recipient_id, category, '
  'natural_key) do nothing` — dedupe is structural, never app-logic. No '
  'client SELECT/INSERT/UPDATE — read and claimed only by the '
  'notification-dispatcher Edge Function via the service role, which bypasses '
  'RLS entirely; admins may inspect via notification_outbox_select for support.';

create index notification_outbox_claim_idx
  on public.notification_outbox (not_before)
  where sent_at is null and failed_at is null;
create index notification_outbox_recipient_idx
  on public.notification_outbox (recipient_id, created_at desc);

alter table public.notification_outbox enable row level security;
revoke all on public.notification_outbox from anon, authenticated;
grant select on public.notification_outbox to authenticated;

create policy notification_outbox_select on public.notification_outbox
  for select to authenticated
  using (public.is_admin());

-- No INSERT / UPDATE / DELETE policy for any app role: producer triggers and
-- the scheduler run SECURITY DEFINER as the table owner; the dispatcher Edge
-- Function uses the service-role key, which bypasses RLS entirely.

-- ----------------------------------------------------------------------------
-- 5. notification_deliveries — one row per (outbox row × subscription)
-- ----------------------------------------------------------------------------
create table public.notification_deliveries (
  id              uuid primary key default gen_random_uuid(),
  outbox_id       uuid not null references public.notification_outbox (id) on delete cascade,
  subscription_id uuid not null references public.push_subscriptions (id) on delete cascade,
  sent_at         timestamptz,
  status_code     integer,
  outcome         text
                    constraint notification_deliveries_outcome_valid
                    check (outcome is null
                           or outcome in ('sent', 'retired', 'retry', 'failed')),
  attempt_count   integer not null default 0,
  created_at      timestamptz not null default now(),

  constraint notification_deliveries_unique unique (outbox_id, subscription_id)
);

comment on table public.notification_deliveries is
  'Per-(outbox row, subscription) delivery attempt. Independent per device so '
  'one user''s stale/broken device never blocks delivery to their other '
  'devices, and does not poison the shared outbox row. Written only by the '
  'notification-dispatcher Edge Function (service role).';

create index notification_deliveries_outbox_idx
  on public.notification_deliveries (outbox_id);

alter table public.notification_deliveries enable row level security;
revoke all on public.notification_deliveries from anon, authenticated;
grant select on public.notification_deliveries to authenticated;

create policy notification_deliveries_select on public.notification_deliveries
  for select to authenticated
  using (public.is_admin());

-- ----------------------------------------------------------------------------
-- 6. _daily_first_completion_claims — atomic "first completed day" claim
-- ----------------------------------------------------------------------------
create table public._daily_first_completion_claims (
  challenge_id   uuid not null references public.challenges (id) on delete cascade,
  challenge_date date not null,
  claimed_by     uuid not null references public.profiles (id) on delete cascade,
  claimed_at     timestamptz not null default now(),
  primary key (challenge_id, challenge_date)
);

comment on table public._daily_first_completion_claims is
  'Internal. One row per (challenge, date): whoever''s completion INSERT wins '
  'the `on conflict do nothing` race is the one and only "first completed '
  'today" claimant for that day (see the trigger in 0033). Never read or '
  'written by any client role.';

alter table public._daily_first_completion_claims enable row level security;
revoke all on public._daily_first_completion_claims from anon, authenticated;
-- No SELECT grant at all — purely internal bookkeeping, nothing to show even
-- an admin.

-- ----------------------------------------------------------------------------
-- 7. _self_test_rate_limit — throttles "Skicka testnotis" to ~once/minute/user
-- ----------------------------------------------------------------------------
create table public._self_test_rate_limit (
  user_id      uuid primary key references public.profiles (id) on delete cascade,
  last_sent_at timestamptz not null default now()
);

comment on table public._self_test_rate_limit is
  'One row per user who has ever sent a self-test push. Claimed atomically by '
  'try_claim_self_test_notification (0032) via an on-conflict-do-update-with-'
  'a-WHERE-clause pattern, so concurrent taps from two devices cannot both '
  'win inside the same 60-second window. Internal — no client access.';

alter table public._self_test_rate_limit enable row level security;
revoke all on public._self_test_rate_limit from anon, authenticated;
-- No SELECT/INSERT/UPDATE grant at all — RPC-only via SECURITY DEFINER.
