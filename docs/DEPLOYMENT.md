# Hälsoutmaningen — Hosted deployment

How the production system is wired:

```
Public browser / installed PWA
        │  HTTPS
        ▼
Cloudflare Workers — Static Assets   (static SPA build of this repo)
        │  HTTPS + Supabase JS client (anon key, RLS-enforced)
        ▼
Hosted Supabase project   (Auth · PostgreSQL + RLS · Storage)
        │
        └─ invite-participant Edge Function   (service role, admin-only)
```

The frontend is served by a **Cloudflare Worker with Static Assets**
(`assets` binding), not classic Cloudflare Pages. SPA deep-link routing is a
Worker setting (`assets.not_found_handling`), not a `public/_redirects` file —
see §1.3.

The private Proxmox / ZeroTier VM is a **development environment only**. Nothing
in production depends on it being online.

This document is configuration reference. It contains **no secrets** — every
real value is entered in the Cloudflare and Supabase dashboards (or via the
Supabase CLI) and never committed.

---

## 1. Cloudflare Workers — Static Assets

> **Deployment model (confirmed 2026-09-12, see §1.6 postmortem): the
> Cloudflare Workers Builds git integration's configured PRODUCTION branch is
> `production` — a real git branch in this repo, deliberately kept still.
> Only a push to `production` builds with the project's real `VITE_*`
> production build variables and serves the live public URL. A push to
> `main` (or any other branch) still triggers a Cloudflare build, but as a
> non-production **preview** version (`wrangler versions upload`) built
> WITHOUT those production variables — its own preview URL works, but
> promoting it to production traffic serves a broken build (missing
> `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`, app fails to mount). Never
> manually promote a `main`-origin version. Release to production by
> fast-forwarding `production` to a verified `main` SHA (§1.6) — never a
> force push, never a commit made only on `production`.

### 1.1 Project connection

| Setting                                           | Value                                                                                                                                                                                                                                   |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product                                           | Workers & Pages → **Worker** with a Static Assets binding                                                                                                                                                                               |
| Worker name                                       | `halsoutmaningen` (see `wrangler.jsonc`)                                                                                                                                                                                                |
| Git provider                                      | GitHub, connected (Workers Builds)                                                                                                                                                                                                      |
| Repository                                        | `Tompatwotimes/halsoutmaningen` (this repo)                                                                                                                                                                                             |
| **Production branch (Cloudflare Branch control)** | **`production`** — the only branch whose build carries the project's production `VITE_*` variables and serves the default public URL.                                                                                                   |
| Other branches (`main`, feature branches)         | Still build on push (preview versions + a `<hash>-halsoutmaningen.gbkof.workers.dev` / `main-halsoutmaningen.gbkof.workers.dev`-style alias), but WITHOUT production build variables — never promote these to serve production traffic. |

### 1.2 Build configuration

| Setting                   | Value                |
| ------------------------- | -------------------- |
| Build command             | `npm run build`      |
| Deploy / assets directory | `dist`               |
| Root directory            | `/` (repo root)      |
| Node version              | `24` (from `.nvmrc`) |

Notes:

- `npm run build` runs `tsc -b && vite build`. A type error fails the deploy —
  intentional.
- The build image reads `.nvmrc` automatically. If it rejects Node 24, set
  `NODE_VERSION = 22` (Vite 7 needs ≥ 20.19 / ≥ 22.12) — the app has no
  Node-24-only requirement.
- `npm ci` is used automatically because `package-lock.json` is committed.

### 1.3 SPA routing

Direct navigation / refresh on client routes (`/aktivera`, `/gruppen`,
`/oversikt`, `/profil`, `/admin`, `/admin/deltagare`, …) must return
`index.html` so React Router can handle them.

This is a **Worker Static Assets setting**, configured on the deployment, not a
file in the repo:

```
assets.not_found_handling = "single-page-application"
```

(In `wrangler.toml`/`wrangler.jsonc`: `[assets] not_found_handling = "single-page-application"`;
in the dashboard: the Worker → Settings → Static Assets → **SPA** not-found
handling.) With this set, any path that does not match a built asset is served
`/index.html` with `200`, and hashed files under `/assets/*` are still served
directly.

- **Do not add `public/_redirects`.** A `/*  /index.html  200` rule is
  rejected by the Workers Static Assets deploy with
  `Invalid _redirects configuration: Infinite loop detected`, and it is
  redundant with `not_found_handling` anyway. (`_redirects` was present
  historically for classic Pages; it must stay removed.)
- [`public/_headers`](../public/_headers) is still honored by Workers Static
  Assets — it adds baseline security headers and a one-year immutable cache for
  `/assets/*`. It deliberately does **not** set a `Content-Security-Policy` — a
  correct policy needs the Supabase project origin (API + Storage host) and
  should be added once the production URL and project are final.

### 1.4 Frontend environment variables

These are set directly in the **Cloudflare dashboard**, on the Worker's own
Build configuration (Workers & Pages → `halsoutmaningen` → Settings → Build →
Environment variables) — scoped to the `production` branch specifically (see
§1.6's confirmed model; this is **not** a GitHub Actions secret/variable, and
`deploy-production.yml` is not the active path). They are read by Vite at
build time and inlined into the bundle:

| Name                             | Value                                                                        | Notes                                                      |
| -------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `VITE_SUPABASE_URL`              | `https://offvlyflactysibrssco.supabase.co`                                   | public                                                     |
| `VITE_SUPABASE_ANON_KEY`         | the project **anon / publishable** key                                       | public, RLS-enforced                                       |
| `VITE_PUBLIC_SITE_URL`           | the production URL, e.g. `https://<worker>.workers.dev` or the custom domain | used for auth email redirects                              |
| `VITE_WEB_PUSH_VAPID_PUBLIC_KEY` | the VAPID public key generated for Web Push                                  | optional, public — blank disables the push-subscription UI |

**Never** set `SUPABASE_SERVICE_ROLE_KEY`, a database connection string, or any
JWT secret on the Worker. Only `VITE_`-prefixed public values belong here; they
ship in the client bundle by design.

`VITE_PUBLIC_SITE_URL` is optional for local dev (the app falls back to
`window.location.origin`) but **should be set in production** so invite /
password-reset links always point at the canonical origin.

### 1.5 Preview builds (`main` and other non-production branches)

These are **not optional/hypothetical** — confirmed 2026-09-12: every push to
`main` (or any branch other than `production`) already triggers a Cloudflare
build and a preview version with its own URL
(`https://<version-hash>-halsoutmaningen.gbkof.workers.dev`, plus a stable
`https://main-halsoutmaningen.gbkof.workers.dev` alias for `main`). These
builds do **not** receive the production `VITE_*` variables from §1.4, so
they reliably fail to boot (`Invalid environment configuration`) — that is
expected and fine for a preview build nobody is meant to use as the live
site. **Never manually promote one of these versions to serve production
traffic** (§1.6). If real working preview builds are ever wanted, set the
same variables from §1.4 on the Preview environment too, in the Cloudflare
dashboard, and add `https://*.<worker>.workers.dev` to the Supabase redirect
allow-list — until then, treat every non-`production`-branch build as
disposable/expected-broken and ignore it.

### 1.6 Production release: fast-forward the `production` branch

**Postmortem (2026-09-12).** During the PWA + Push V1 release and its
follow-up correction, `main`-origin Cloudflare Worker versions were manually
promoted to serve production traffic, twice. Both went live with the app
completely broken (React never mounted — `Invalid environment configuration:
VITE_SUPABASE_URL: Required, VITE_SUPABASE_ANON_KEY: Required`), confirmed by
inspecting the shipped bundle directly: no `offvlyflactysibrssco` string
baked in, but the literal string `VITE_SUPABASE_URL` present (Vite's env
substitution had nothing to substitute). Root cause, confirmed against the
live Cloudflare dashboard: **`main` was never the configured production
branch — `production` is.** Cloudflare's Branch control has `production` set
as the one branch whose build receives the project's real `VITE_*`
production build variables and is served at the bare production URL; a
`main` push only ever produced a non-production **preview** version
(`wrangler versions upload` in that build's own deploy-command field, no
build variables) that happened to have a promotable "Deploy" action in the
dashboard — promoting it does not retroactively give it the missing
build-time variables. **Manually promoting a `main`/preview version must
never be done again.** The `docs/DEPLOYMENT.md §1.6` content this replaced
(a `workflow_dispatch`-gated `deploy-production.yml` + a disconnected
Cloudflare git integration) described an earlier, different plan
(commit `df9d363`) whose one-time Cloudflare/GitHub setup was never actually
completed — no `production` GitHub Environment, no `CLOUDFLARE_API_TOKEN`
secret ever existed — so it was never the live mechanism regardless of what
this doc previously claimed.

**The real, confirmed release flow:**

1. Land and verify everything on `main` as normal (PR review, CI, merge).
2. Re-run the full gate suite fresh on merged `main` (test/typecheck/lint/
   format/build, plus the DB/pgTAP suite).
3. Fast-forward `production` to that exact verified `main` SHA — **never a
   force push, never a commit made only on `production`**:
   ```bash
   git fetch origin
   git merge-base --is-ancestor origin/production origin/main \
     && echo "safe: production is a strict ancestor of main" \
     || echo "STOP — production has diverged, investigate before pushing"
   git push origin main:production
   ```
4. Wait for Cloudflare's build on `production` (a GitHub check-run named
   "Workers Builds: halsoutmaningen" appears on that same commit SHA; its
   summary must show a **production** deploy, not `wrangler versions upload`
   with no build variables).
5. **Before considering anything released**, verify a REAL render against
   the production URL (a static `curl` check on `/manifest.webmanifest` or
   `/sw.js` is not sufficient — it does not prove the React app itself
   mounted). At minimum:
   - the shipped `/assets/index-*.js` contains the real project ref
     (`offvlyflactysibrssco`), not the literal string `VITE_SUPABASE_URL`;
   - a headless-browser render of `/logga-in` (no auth needed) shows a
     non-empty `#root` and throws no page errors.

`wrangler.jsonc` at the repo root still captures the Worker config (name
`halsoutmaningen`, `./dist`, SPA `not_found_handling`) for reference, but the
actual production trigger is the Cloudflare Branch control setting described
above, not anything invoked from this repo's GitHub Actions.

`.github/workflows/deploy-production.yml` remains in the repo but is **not**
the active release path — no `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID`
secret or `production` GitHub Environment exists for it to use. Do not run
it expecting it to promote anything; if it is ever wired up in the future,
document that decision here and remove this caveat.

---

## 2. Supabase — Auth configuration

Dashboard → **Authentication**.

### 2.1 URL configuration

| Setting           | Value                                                                                                                                               |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Site URL**      | the production frontend URL (same as `VITE_PUBLIC_SITE_URL`)                                                                                        |
| **Redirect URLs** | `https://<prod-url>/aktivera`, and `https://<prod-url>` — plus `http://10.241.145.116:5173/**` and `http://localhost:5173/**` for local development |

The invite / reset emails redirect to `${SITE_URL}/aktivera`. That exact URL
must be on the allow-list or Supabase drops the redirect.

### 2.2 Providers → Email

| Setting                        | Value   |
| ------------------------------ | ------- |
| Email provider                 | enabled |
| **Allow new users to sign up** | **OFF** |
| Confirm email                  | ON      |

Public signup stays disabled. Accounts are created only by an admin through the
`invite-participant` Edge Function. This mirrors `supabase/config.toml`
(`enable_signup = false`) which governs only the local stack — the hosted
project must be set in the dashboard.

### 2.3 Email templates (optional polish)

The **Invite user** and **Reset password** templates can be given Swedish copy.
The default templates work; only the redirect target matters for correctness.

---

## 3. Supabase — invite-participant Edge Function

Source: [`supabase/functions/invite-participant/`](../supabase/functions/invite-participant/).

### 3.1 Secrets

| Name                        | Who sets it     | Purpose                                                         |
| --------------------------- | --------------- | --------------------------------------------------------------- |
| `SITE_URL`                  | **us**          | public app origin for the `${SITE_URL}/aktivera` email redirect |
| `SUPABASE_URL`              | platform (auto) | —                                                               |
| `SUPABASE_ANON_KEY`         | platform (auto) | caller-scoped client + `is_admin()` check                       |
| `SUPABASE_SERVICE_ROLE_KEY` | platform (auto) | auth-user creation only, never leaves the function              |

Set the one manual secret:

```bash
supabase secrets set SITE_URL=https://<prod-url> --project-ref offvlyflactysibrssco
```

`SITE_URL` must equal the production frontend origin and be on the Auth
redirect allow-list (§2.1).

### 3.2 Deploy

```bash
supabase functions deploy invite-participant --project-ref offvlyflactysibrssco
```

`verify_jwt = false` in `supabase/config.toml` is deliberate and does **not**
weaken the endpoint: the function itself validates the caller's JWT
(`auth.getUser()`) **and** requires the DB predicate `is_admin()`
(`role = 'admin' AND active`) before doing anything. Leaving the platform
pre-check off keeps the CORS preflight (`OPTIONS`, no `Authorization`) working.

See [`INVITE_FLOW.md`](./INVITE_FLOW.md) for the full request flow, the
existing-user vs. new-user matrix, and the retry / idempotency semantics.

### 3.3 Smoke test after deploy

1. Open `https://<prod-url>/aktivera` **directly in a fresh tab** (and reload
   it). It must render the activation page, not a 404 — confirms the Worker's
   `not_found_handling = "single-page-application"` fallback (§1.3). With no
   invite session it shows "Länken fungerar inte", which is the correct state.
2. As an admin, open `/admin/deltagare`, invite a throwaway address you control.
3. Expect status `invited` and an email.
4. Open the email link → lands on `https://<prod-url>/aktivera` → the
   "Välj ett lösenord" form appears → set a password → app loads.
5. Sign out, use **Glömt lösenord?** on `/logga-in` with that address → email →
   `/aktivera` → new password works.

---

## 4. Email / SMTP

Supabase's **default SMTP is rate-limited and intended for development /
testing only** (a few messages per hour, shared reputation, not deliverable at
scale). It is fine for the first internal smoke tests.

For real invitations, configure **custom SMTP** in
Dashboard → Authentication → Emails → SMTP Settings with a transactional
provider (e.g. Resend, Postmark, SES, Brevo). Requirements:

- a verified sending domain (SPF + DKIM) for deliverability;
- provider credentials entered in the Supabase dashboard **only** — never in
  this repo, `.env`, or any doc;
- sensible from-name / from-address (e.g. `Hälsoutmaningen <noreply@…>`).

SMTP provider configuration is entirely dashboard-side and out of source
control.

---

## 5. First public deployment — manual checklist

Ordered. Items marked **(approval)** were explicitly held for you.

1. **(approval)** Create the Cloudflare Worker with Static Assets (§1.1–1.2),
   deploying `dist` from `main`, with `assets.not_found_handling =
"single-page-application"` (§1.3). First build will succeed with placeholder
   env; the app shows the env-validation error screen until step 3.
2. Note the assigned `https://<worker>.workers.dev` URL (or set up the custom
   domain now).
3. Set the three frontend build-time env vars (§1.4) with the real anon key and
   the URL from step 2, then redeploy.
4. **(approval)** Supabase → Auth → set **Site URL** + **Redirect URLs** (§2.1).
5. **(approval)** Supabase → Auth → Providers → Email → confirm
   **Allow new users to sign up = OFF** (§2.2).
6. **(approval)** `supabase secrets set SITE_URL=…` (§3.1).
7. **(approval)** `supabase functions deploy invite-participant` (§3.2).
8. Smoke-test invite + reset with a throwaway address (§3.3).
9. **(approval)** Configure custom SMTP (§4) before inviting real participants.
10. Invite the real participants.

Until steps 6–7 are done, the admin "Bjud in deltagare" form returns a
network / function error — expected. Adding an **existing** account to a
challenge and activating a draft challenge do not depend on the Edge Function.

---

## 6. Supabase — PWA + Web Push notifications

Source: [`supabase/functions/notification-dispatcher/`](../supabase/functions/notification-dispatcher/),
migrations `20260911090000`–`20260911090400`, spec
[`2026-09-11-pwa-push-v1-design.md`](./superpowers/specs/2026-09-11-pwa-push-v1-design.md).

### 6.1 VAPID keypair (generate once)

```bash
npx web-push generate-vapid-keys
```

The **public** key is safe client-side — set it as the GitHub Actions repo
**variable** `VITE_WEB_PUSH_VAPID_PUBLIC_KEY` (§1.4) so the production build
picks it up. The **private** key is a secret: it must only ever reach Supabase
Edge Function secrets (step 6.2), never a frontend env var, never Cloudflare,
never a commit, never a log line or report.

### 6.2 Secrets

| Name                         | Who sets it | Purpose                                                   |
| ---------------------------- | ----------- | --------------------------------------------------------- |
| `WEB_PUSH_VAPID_PUBLIC_KEY`  | **us**      | mirrors the frontend's public key server-side             |
| `WEB_PUSH_VAPID_PRIVATE_KEY` | **us**      | signs outgoing Web Push messages — never exposed          |
| `WEB_PUSH_VAPID_SUBJECT`     | **us**      | `mailto:` or the production HTTPS URL                     |
| `CRON_SECRET`                | **us**      | bearer the scheduled dispatch workflow authenticates with |

```bash
supabase secrets set \
  WEB_PUSH_VAPID_PUBLIC_KEY=<public> \
  WEB_PUSH_VAPID_PRIVATE_KEY=<private> \
  WEB_PUSH_VAPID_SUBJECT=https://<prod-url> \
  CRON_SECRET=<a-random-value> \
  --project-ref offvlyflactysibrssco
```

Set the same `CRON_SECRET` value as the GitHub Actions repo secret
`NOTIFICATION_DISPATCH_CRON_SECRET` used by
[`.github/workflows/notification-dispatch.yml`](../.github/workflows/notification-dispatch.yml) —
two different names in two different systems, same value.

### 6.3 Deploy

```bash
supabase db push --project-ref offvlyflactysibrssco
supabase functions deploy notification-dispatcher --project-ref offvlyflactysibrssco
```

`verify_jwt = false` (`supabase/config.toml`) is deliberate, mirroring
`invite-participant`: the function does its own auth — a `CRON_SECRET` bearer
for `dispatch`, a real validated user session for `self-test`.

### 6.4 Scheduling

Two independent schedules, both timezone-safe (they read each challenge's own
`timezone` column — never a hardcoded Stockholm/UTC offset):

- **Enqueue** — `pg_cron` job `halsoutmaningen-notifications-hourly` (created
  by `20260911090300_notifications_scheduler.sql`) runs `_notification_scheduler_tick()`
  hourly, enqueuing due 19:00/22:00/06:30-local-time rows.
- **Send** — `.github/workflows/notification-dispatch.yml` calls the deployed
  function's `dispatch` action every 5 minutes (GitHub Actions' minimum
  granularity) so enqueued rows do not sit for up to an hour.

Verify after deploy:

```bash
supabase functions list --project-ref offvlyflactysibrssco
psql "<connection-string>" -c "select jobname, schedule, active from cron.job where jobname like 'halsoutmaningen%';"
```

### 6.5 Kill switch

`challenges.push_enabled` (default `true`) is the operational emergency brake
— flip it off for a challenge to stop **new** enqueues immediately and prevent
already-queued rows for that challenge from being claimed/sent
(`_claim_notification_outbox_batch` re-checks it, not only the enqueue path).
It does not touch any other part of the product.

### 6.6 Smoke test after deploy

1. As a signed-in participant on an installed PWA, Profil → Notiser →
   Aktivera → grant permission → confirm `push_subscriptions` gains a row
   (admin-only table — verify via `service_role`, never exposed to the UI).
2. **Skicka testnotis** → expect a real OS push within a few seconds.
3. Toggle `challenges.push_enabled = false` → **Skicka testnotis** must now be
   refused (kill switch also blocks self-test) → set it back to `true`.
4. Confirm the scheduled GitHub Actions run (`notification-dispatch.yml`) is
   green and `notification_outbox` rows move from `sent_at is null` to a
   populated `sent_at` within a few minutes of being enqueued.
