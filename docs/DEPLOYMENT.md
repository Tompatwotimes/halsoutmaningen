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

### 1.1 Project connection

| Setting                      | Value                                                     |
| ---------------------------- | --------------------------------------------------------- |
| Product                      | Workers & Pages → **Worker** with a Static Assets binding |
| Git provider                 | GitHub                                                    |
| Repository                   | `Tompatwotimes/halsoutmaningen` (this repo)               |
| Production branch            | `main`                                                    |
| Preview / branch deployments | optional — see §1.5                                       |

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

Set as **build-time** variables on the Worker (Workers & Pages → the Worker →
Settings → **Variables and Secrets** / the `[vars]` block of `wrangler` config,
whichever the deployment uses). They are read by Vite at build time and inlined
into the bundle:

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
