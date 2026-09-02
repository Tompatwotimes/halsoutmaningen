# Hälsoutmaningen — Hosted deployment

How the production system is wired:

```
Public browser / installed PWA
        │  HTTPS
        ▼
Cloudflare Pages   (static SPA build of this repo, GitHub-connected)
        │  HTTPS + Supabase JS client (anon key, RLS-enforced)
        ▼
Hosted Supabase project   (Auth · PostgreSQL + RLS · Storage)
        │
        └─ invite-participant Edge Function   (service role, admin-only)
```

The private Proxmox / ZeroTier VM is a **development environment only**. Nothing
in production depends on it being online.

This document is configuration reference. It contains **no secrets** — every
real value is entered in the Cloudflare and Supabase dashboards (or via the
Supabase CLI) and never committed.

---

## 1. Cloudflare Pages

### 1.1 Project connection

| Setting             | Value                                                |
| ------------------- | ---------------------------------------------------- |
| Git provider        | GitHub                                               |
| Repository          | `Tompatwotimes/halsoutmaningen` (this repo)          |
| Production branch   | `main`                                               |
| Preview deployments | any non-production branch / PR (optional — see §1.5) |

### 1.2 Build configuration

| Setting                | Value                |
| ---------------------- | -------------------- |
| Framework preset       | **None** (or "Vite") |
| Build command          | `npm run build`      |
| Build output directory | `dist`               |
| Root directory         | `/` (repo root)      |
| Node version           | `24` (from `.nvmrc`) |

Notes:

- `npm run build` runs `tsc -b && vite build`. A type error fails the deploy —
  intentional.
- Cloudflare Pages reads `.nvmrc` automatically. If the build image rejects
  Node 24, set an environment variable `NODE_VERSION = 22` (Vite 7 needs
  ≥ 20.19 / ≥ 22.12) — the app has no Node-24-only requirement.
- `npm ci` is used automatically because `package-lock.json` is committed.

### 1.3 SPA routing

Direct navigation / refresh on client routes (`/aktivera`, `/gruppen`,
`/oversikt`, `/profil`, `/admin`, `/admin/deltagare`, …) must return
`index.html` so React Router can handle them.

- [`public/_redirects`](../public/_redirects) → `/*  /index.html  200`
  (copied verbatim into `dist/` by Vite). Cloudflare Pages serves a matching
  static asset first and only falls through to this rule for unknown paths, so
  hashed assets under `/assets/*` are unaffected.
- [`public/_headers`](../public/_headers) adds baseline security headers and a
  one-year immutable cache for `/assets/*`. It deliberately does **not** set a
  `Content-Security-Policy` — a correct policy needs the Supabase project
  origin (API + Storage host) and should be added once the production URL and
  project are final.

No `wrangler.toml` is required for a dashboard-connected Pages project.

### 1.4 Frontend environment variables

Set under **Pages → Settings → Environment variables → Production**
(and Preview, if previews are enabled):

| Name                     | Value                                                                       | Notes                         |
| ------------------------ | --------------------------------------------------------------------------- | ----------------------------- |
| `VITE_SUPABASE_URL`      | `https://offvlyflactysibrssco.supabase.co`                                  | public                        |
| `VITE_SUPABASE_ANON_KEY` | the project **anon / publishable** key                                      | public, RLS-enforced          |
| `VITE_PUBLIC_SITE_URL`   | the production URL, e.g. `https://<project>.pages.dev` or the custom domain | used for auth email redirects |

**Never** set `SUPABASE_SERVICE_ROLE_KEY`, a database connection string, or any
JWT secret in Cloudflare Pages. Only `VITE_`-prefixed public values belong
here; they ship in the client bundle by design.

`VITE_PUBLIC_SITE_URL` is optional for local dev (the app falls back to
`window.location.origin`) but **should be set in production** so invite /
password-reset links always point at the canonical origin.

### 1.5 Preview deployments (optional)

If preview deployments are enabled, either:

- set `VITE_PUBLIC_SITE_URL` per-preview to that preview's URL and add each to
  the Supabase redirect allow-list, **or**
- leave `VITE_PUBLIC_SITE_URL` unset for Preview so previews use their own
  origin, and add `https://*.<project>.pages.dev` to the Supabase redirect
  allow-list (wildcard).

The simplest safe option for launch: **disable preview deployments** and only
deploy `main`.

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

1. As an admin, open `/admin/deltagare`, invite a throwaway address you control.
2. Expect status `invited` and an email.
3. Open the email link → lands on `https://<prod-url>/aktivera` → set a password
   → app loads.
4. Sign out, use **Glömt lösenord?** on `/logga-in` with that address → email →
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

1. **(approval)** Create the Cloudflare Pages project (§1.1–1.2), connected to
   `main`. First build will succeed with placeholder env; the app shows the
   env-validation error screen until step 3.
2. Note the assigned `https://<project>.pages.dev` URL (or set up the custom
   domain now).
3. Set the three frontend env vars (§1.4) with the real anon key and the URL
   from step 2, then redeploy.
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
