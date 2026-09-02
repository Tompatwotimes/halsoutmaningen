# Hälsoutmaningen — Authentication & admin invite flow (Fas 3)

Reference for the authenticated app flow and the privileged participant-invite
architecture. Code is the source of truth; this explains the design and the
failure semantics.

---

## 1. Authenticated app flow

```
Supabase Auth (PKCE, session in localStorage)
        │  getSession() + onAuthStateChange
        ▼
AuthProvider  ──►  useProfile()  ── reads public.profiles for auth.uid()
        │                │           (role + active every load, never client-held)
        │                ▼
   RequireAuth      RequireAdmin
   - no session      - isLoading  → spinner (route withheld)
     → /logga-in     - isError    → ErrorState (access NOT granted)
   - initializing    - !isAdmin   → redirect "/"
     → spinner       - isAdmin    → render
   - profile.active === false → <AccountInactiveNotice/>
```

- **Session restore:** `AuthProvider` calls `supabase.auth.getSession()` on
  mount and subscribes to `onAuthStateChange`. On `SIGNED_IN` / `SIGNED_OUT`
  the whole TanStack Query cache is invalidated; `signOut()` also calls
  `queryClient.clear()` so no per-identity data survives a logout.
- **Role source:** `useProfile()` → `fetchMyProfile()` selects
  `role, active` from `profiles`. `isAdmin` is `role === 'admin' && active`,
  matching the DB `is_admin()` predicate exactly. There is no client-held role.
- **`/aktivera`:** landing page for the Supabase invite / password-reset email.
  `useActivation` runs a small state machine
  (`resolving → ready → submitting → success`, plus `link-error` / `no-session`)
  that turns the redirect into an authenticated session, then the page collects
  a password via `supabase.auth.updateUser({ password })` and enters the app.
  Two redirect shapes reach this route:
  - **admin invite** → implicit-grant hash
    (`#access_token=…&refresh_token=…&type=invite`). The `flowType: 'pkce'`
    client refuses this URL ("Not a valid PKCE flow url"), so `useActivation`
    consumes it explicitly with `supabase.auth.setSession(...)` and strips the
    tokens from the address bar.
  - **password reset** → PKCE `?code=…` (client-initiated
    `resetPasswordForEmail`). `supabase-js` exchanges this itself via
    `detectSessionInUrl`; the page just waits for the session.

  Reaching a session is **not** treated as "account activated" — only a
  successful `updateUser({ password })` is. The route is public and never
  wrapped in `RequireAuth`, and nothing in `AuthProvider` navigates, so the
  session establishing mid-flow never bounces the user off `/aktivera`.

- **`/logga-in`:** password login + a "Glömt lösenord?" action that calls
  `resetPasswordForEmail(redirectTo: /aktivera)` and always shows the same
  neutral confirmation (never reveals whether an address has an account).
- **Deactivated accounts** (`profiles.active = false`) keep all their data but
  see `AccountInactiveNotice` instead of the app. A missing profile row is
  **not** treated as inactive — RLS still constrains everything.

Client guards only hide UI. Every read/write is enforced by PostgreSQL RLS.

---

## 2. Invite architecture

No public sign-up. Accounts are created only by an admin, through the
`invite-participant` Edge Function.

```
Admin UI (ParticipantsPage / InviteParticipantForm)
   │  parseInviteForm()  — Zod validation in the browser
   │  fetch  POST /functions/v1/invite-participant
   │         Authorization: Bearer <admin user JWT>,  apikey: <anon>
   │         { action: "invite", email, displayName, challengeId,
   │           participationStartDate, participationEndDate? }
   ▼
Edge Function  (verify_jwt = false — see below; service-role key only here)
   1. asCaller = anon client + caller's Authorization header
      - asCaller.auth.getUser()      → 401 if the token is invalid
      - asCaller.rpc('is_admin')     → 403 if not an active admin  (DB predicate)
   2. Zod re-validation of the payload (independent of the browser)   → 422
   3. asService.auth.admin.inviteUserByEmail(email, {                 (service role)
        data: { display_name }, redirectTo: `${SITE_URL}/aktivera` })
        • new address    → auth user created, invite email sent
        • already exists  → NO email; resolve the existing user id
   4. asService: upsert profiles {id, display_name} ON CONFLICT DO NOTHING
      (the on_auth_user_created trigger already made it for new users;
       an existing display_name is never overwritten)
   5. asCaller: insert/update public.challenge_memberships
        - goes through the normal challenge_memberships RLS (is_admin())
        - the audit trigger records actor_user_id = the admin
   ▼
   { status, userId, existingUser, displayName, message }
```

Why the membership write runs **as the caller**, not the service role: RLS and
the `challenge_memberships` audit trigger then see the real admin identity
(`auth.uid()`), so `audit_log.actor_user_id` is the admin and not `NULL`. Only
the auth-user creation genuinely needs the service role.

### Admin verification

Server-side, in the function itself (`verify_jwt = false` in `config.toml` so
that CORS preflight works — the in-function gate below is strictly stronger
than the platform's generic JWT pre-check):

1. Missing `Authorization` header → `401`.
2. `asCaller.auth.getUser()` — validates the token, yields the caller id;
   invalid → `401`.
3. `asCaller.rpc('is_admin')` — the `SECURITY DEFINER` predicate
   (`role = 'admin' AND active`) is the authority. Not a claim, not a header.
   Not an admin → `403`.

The browser cannot reach the membership tables or `auth.users` directly for
another user; RLS already blocks that. The function adds the ability to create
an `auth.users` row, nothing more.

### Existing user vs. new user

| Situation                                               | Behaviour                                                                  | Response `status`    |
| ------------------------------------------------------- | -------------------------------------------------------------------------- | -------------------- |
| Email has no account                                    | `inviteUserByEmail` creates the user + sends the invite; membership linked | `invited`            |
| Email already has an account, not yet a member          | No email sent; existing user id resolved; membership linked                | `linked`             |
| Already a member, form values identical                 | No writes                                                                  | `already_member`     |
| Already a member, form changes the window / reactivates | Membership updated (audited)                                               | `membership_updated` |

`inviteUserByEmail` is tried first; an "already registered" error is the signal
to switch to the existing-user path (a paginated `listUsers` lookup — fine for
this scale). This means **the invite email is only ever sent when a brand-new
auth user is created.**

### Failure / retry / idempotency

The function has two side effects: (A) create+invite the auth user, (B) write
the membership. It is designed to be re-run safely:

- **B fails after A succeeded** (e.g. transient DB error). The auth user / invite
  already exists. The admin re-submits the same form: step 3 hits
  "already registered" → resolves the existing user → **no second email** →
  step 5 retries the membership insert. The error response carries
  `recoverable: true` and a message telling the admin to resubmit.
- **Duplicate submit after full success.** Step 3 resolves the existing user,
  step 5 finds the membership unchanged → `already_member`, no writes.
- **A fails** (invite could not be sent). Nothing was written; the admin sees a
  `502` with the reason and can retry.
- **Partial within B** is impossible — the membership insert/update is a single
  atomic statement.

The only non-transactional gap is "auth user created, `profiles` row somehow
missing" — step 4's idempotent upsert closes it, and a retry re-runs it anyway.

### Account-status enrichment (optional)

`{ action: "account-status", challengeId }` returns, for the challenge's
members, only `{ userId, state: 'invited' | 'active', invitedAt, lastSignInAt }`
(state = `active` once `last_sign_in_at` is set). `auth.users` is never exposed
to the browser — the function reads it with the service role and returns a
minimal projection. The admin UI keeps this **off by default** (a checkbox);
until the function is deployed it simply shows "not available yet".

---

## 3. Environment / secrets

**Frontend** (`.env`, git-ignored; `.env.example` is browser-safe only):

```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_PUBLIC_SITE_URL=   # optional; canonical prod origin for auth redirects.
                        # Unset in dev → falls back to window.location.origin.
```

**Edge Function** — set on the hosted project
(`supabase secrets set` / Dashboard → Edge Functions → Secrets):

| Name                        | Who sets it     | Purpose                                                         |
| --------------------------- | --------------- | --------------------------------------------------------------- |
| `SITE_URL`                  | us              | public app origin for the `${SITE_URL}/aktivera` email redirect |
| `SUPABASE_URL`              | platform (auto) | —                                                               |
| `SUPABASE_ANON_KEY`         | platform (auto) | caller-scoped client                                            |
| `SUPABASE_SERVICE_ROLE_KEY` | platform (auto) | auth-user creation only                                         |

> `verify_jwt = false` in `supabase/config.toml` is deliberate (CORS preflight).
> The function performs a full `getUser()` + `is_admin()` check itself, so this
> does not open the endpoint.

The service-role key is **never** in the frontend bundle or any committed file.

**Hosted Auth config** (Dashboard → Authentication → Providers → Email): keep
"Allow new users to sign up" **disabled** (`enable_signup = false`, already in
`supabase/config.toml` for the local stack). Add `${SITE_URL}` and
`${SITE_URL}/aktivera` to the allowed redirect URLs.

Full hosted setup (Cloudflare Pages build config, exact env vars, Auth Site
URL / Redirect URLs, `supabase secrets set` / `functions deploy` commands, SMTP
requirements, first-deploy checklist): see [`DEPLOYMENT.md`](./DEPLOYMENT.md).
