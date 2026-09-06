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

> **Deployment model (2026-09-06 onwards): manual promotion only.**
> Pushing / merging to `main` no longer promotes anything to production.
> Production code is promoted by a deliberate GitHub Actions run
> (`.github/workflows/deploy-production.yml`, `workflow_dispatch` only, gated by
> the `production` Environment). This requires the Cloudflare **Workers Builds
> git integration to be disconnected** — see **§1.6**. Until that is done,
> Cloudflare keeps auto-deploying every push to `main` and the gate is not real.

### 1.1 Project connection

| Setting                      | Value                                                     |
| ---------------------------- | --------------------------------------------------------- |
| Product                      | Workers & Pages → **Worker** with a Static Assets binding |
| Worker name                  | `halsoutmaningen` (see `wrangler.jsonc`)                  |
| Git provider                 | GitHub — **being disconnected**, see §1.6                 |
| Repository                   | `Tompatwotimes/halsoutmaningen` (this repo)               |
| Production branch (historic) | `main` — was build **and** auto-deploy                    |
| Preview / branch deployments | off (only `main` was ever deployed)                       |

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

With the manual-promotion model (§1.6) these are set as **GitHub Actions repo
variables/secrets** (Settings → Secrets and variables → Actions) and passed to
`npm run build` by the deploy workflow. They are read by Vite at build time and
inlined into the bundle:

| Name                     | Value                                                                        | Notes                         |
| ------------------------ | ---------------------------------------------------------------------------- | ----------------------------- |
| `VITE_SUPABASE_URL`      | `https://offvlyflactysibrssco.supabase.co`                                   | public                        |
| `VITE_SUPABASE_ANON_KEY` | the project **anon / publishable** key                                       | public, RLS-enforced          |
| `VITE_PUBLIC_SITE_URL`   | the production URL, e.g. `https://<worker>.workers.dev` or the custom domain | used for auth email redirects |

**Never** set `SUPABASE_SERVICE_ROLE_KEY`, a database connection string, or any
JWT secret on the Worker. Only `VITE_`-prefixed public values belong here; they
ship in the client bundle by design.

`VITE_PUBLIC_SITE_URL` is optional for local dev (the app falls back to
`window.location.origin`) but **should be set in production** so invite /
password-reset links always point at the canonical origin.

### 1.5 Preview deployments (optional)

If preview deployments are enabled, either:

- set `VITE_PUBLIC_SITE_URL` per branch-deployment to that deployment's URL and
  add each to the Supabase redirect allow-list, **or**
- leave `VITE_PUBLIC_SITE_URL` unset for branch deployments so they use their
  own origin, and add `https://*.<worker>.workers.dev` to the Supabase redirect
  allow-list (wildcard).

The simplest safe option for launch: **only deploy `main`** and skip branch
deployments.

### 1.6 Manual production promotion gate

**Why this exists.** The Cloudflare **Workers Builds** git integration builds
**and** promotes on every push to the production branch. It has no "build only"
mode for the production branch (that toggle is a _Pages_ feature, not Workers
Builds), and changing the deploy command to `wrangler versions upload` did
**not** stop promotion in practice for this Worker. Result: a merge to `main`
would silently ship un-reviewed application code to real users — during the
Weight Tracking rollout the frontend went live at the PR merge, before the
frontend was meant to be promoted.

**The model now.** Code reaches production only through
[`.github/workflows/deploy-production.yml`](../.github/workflows/deploy-production.yml):

- trigger: **`workflow_dispatch` only** — a maintainer clicks _Run workflow_ and
  picks the ref (defaults to `main`);
- gate: the job runs in the **`production` GitHub Environment**, which has a
  **required reviewer**, so the run pauses for an explicit approval;
- steps: `npm ci` → `npm run build` (with the public `VITE_*` values from repo
  vars/secrets) → `cloudflare/wrangler-action@v3` `deploy` using
  `wrangler.jsonc`.

Pushing to `main` still runs normal CI (`database-tests.yml` on PRs, review),
but **nothing that touches production**.

`wrangler.jsonc` at the repo root captures the Worker config (name
`halsoutmaningen`, `./dist`, SPA `not_found_handling`) so a deploy is
reproducible and reviewable rather than living only in the dashboard.

**One-time setup — this cannot be done from the repo. A human must:**

| #   | Where                                                                            | Exact action                                                                                                                                                                                                                                                                                                                                                            |
| --- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Cloudflare dashboard**                                                         | Workers &amp; Pages → **`halsoutmaningen`** → **Settings** → **Build** → **Git integration** → **Disconnect** the connected GitHub repository. (Equivalently: **Settings → Build → Branch control** and remove `main` as the production branch, then disconnect — the reliable action is the full disconnect.) After this, Cloudflare stops building/deploying on push. |
| 2   | **Cloudflare dashboard**                                                         | My Profile → **API Tokens** → **Create Token** → template **"Edit Cloudflare Workers"**, scoped to this account only, nothing else. Copy the value once.                                                                                                                                                                                                                |
| 3   | **GitHub repo** → Settings → Secrets and variables → **Actions** → **Secrets**   | `CLOUDFLARE_API_TOKEN` = the token from step 2. `CLOUDFLARE_ACCOUNT_ID` = the account id (Cloudflare dashboard URL segment, or `wrangler whoami`). `VITE_SUPABASE_ANON_KEY` = the project anon/publishable key.                                                                                                                                                         |
| 4   | **GitHub repo** → Settings → Secrets and variables → **Actions** → **Variables** | `VITE_SUPABASE_URL` = `https://offvlyflactysibrssco.supabase.co`. `VITE_PUBLIC_SITE_URL` = the production URL.                                                                                                                                                                                                                                                          |
| 5   | **GitHub repo** → Settings → **Environments** → **New environment** `production` | Add at least one **Required reviewer**. (Optional: restrict deployment branches to `main`.)                                                                                                                                                                                                                                                                             |

**Verify the gate holds:**

1. Push any harmless commit to `main` (or merge a PR). Wait a few minutes.
   - Cloudflare: Workers &amp; Pages → `halsoutmaningen` → **Deployments** shows
     **no new deployment**, and → **Builds** shows **no new build** (the
     integration is disconnected).
   - `curl -sI https://<prod-url>/` and diff the served
     `/assets/index-*.js` filename against the previous value — unchanged.
2. Run **Actions → Deploy to production → Run workflow** on `main`. It should
   **pause** on the `production` environment waiting for review. Approve it.
   Only then does `/assets/index-*.js` change and the new code go live.
3. `npx wrangler deployments list` (with the API token) shows the promotion is
   attributed to the GitHub Actions run, not a "Workers Builds" source.

Until steps 1–5 are done this workflow is inert and Cloudflare still
auto-deploys `main`.

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
