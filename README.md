# Hälsoutmaningen

Private, mobile-first web app for running social training challenges. Reusable
challenge platform — participant count, dates, rules and costs are all
configuration, never hardcoded.

See [`CLAUDE.md`](./CLAUDE.md) (governing instructions),
[`docs/PRODUCT_SPEC.md`](./docs/PRODUCT_SPEC.md),
[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md),
[`docs/IMPLEMENTATION_PLAN.md`](./docs/IMPLEMENTATION_PLAN.md) and
[`docs/DATABASE.md`](./docs/DATABASE.md).

## Stack

| Layer      | Choice                                          |
| ---------- | ----------------------------------------------- |
| Frontend   | React 19 + TypeScript + Vite 7                  |
| Routing    | React Router 7                                  |
| Data       | TanStack Query 5                                |
| Validation | Zod                                             |
| Backend    | Supabase (Auth, PostgreSQL, RLS, Storage)       |
| Styling    | CSS Modules + design tokens (no CSS framework)  |
| Testing    | Vitest + Testing Library                        |
| Hosting    | Cloudflare Pages (frontend), Supabase (backend) |

## Getting started

```bash
npm install
cp .env.example .env      # fill in Supabase URL + anon key
npm run dev
```

The app requires `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`; it fails
fast at startup if they are missing. `VITE_PUBLIC_SITE_URL` is optional (used
for auth email redirect links) and should be left blank in local development.

Hosted deployment (Cloudflare Pages + Supabase Auth / Edge Function setup) is
documented in [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md).

## Scripts

| Command                 | Purpose                           |
| ----------------------- | --------------------------------- |
| `npm run dev`           | Vite dev server                   |
| `npm run build`         | Typecheck + production build      |
| `npm run typecheck`     | `tsc` project references, no emit |
| `npm run lint`          | ESLint (type-aware, strict)       |
| `npm run format`        | Prettier write                    |
| `npm run test`          | Vitest run                        |
| `npm run test:coverage` | Vitest with V8 coverage           |
| `npm run check`         | typecheck + lint + test + build   |

## Supabase / database

Schema is reproduced from migrations in [`supabase/migrations`](./supabase/migrations)
— the Git repo is the source of truth. Do not make dashboard-only schema
changes. See [`docs/DATABASE.md`](./docs/DATABASE.md) for the full design.

Development runs against the **hosted** Supabase project (the dev VM does not
run the local Docker stack). The Supabase CLI is a dev dependency:

```bash
npx supabase login
npx supabase link --project-ref <ref>
npx supabase migration list          # local vs remote
npx supabase migration new <name>    # new migration
npx supabase db push                 # apply pending migrations to the linked project
npm run db:types                     # regenerate src/types/database.ts (after push)
```

**A migration is reviewed before it is applied to the hosted project.**
pgTAP tests live in [`supabase/tests`](./supabase/tests) and run in CI / against
a preview branch (not on the VM).

## Project structure

```
src/
  app/          App wiring: providers, routes, error boundary
  components/   Reusable UI + layout (CSS Modules)
  config/       Static app config (navigation)
  domain/       Pure challenge logic — dates, day-state, liability, streaks
  features/     Feature slices (auth, profile, …)
  lib/          Env validation, Supabase client
  pages/        Route screens
  test/         Test fixtures
supabase/       config.toml + migrations + seed
docs/           Specs and the implementation plan
```

## Security notes

- The frontend is never the authoritative security layer. Authorization is
  enforced in PostgreSQL RLS.
- Only browser-safe public Supabase config lives in `.env`. The service-role
  key must never enter this repo or the client bundle.
- Proof images live in a private Storage bucket — no public URLs.
