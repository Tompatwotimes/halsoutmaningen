# Hälsoutmaningen — Technical Architecture

## 1. Architecture overview

Use a simple hosted architecture:

```text
Phone / Browser / PWA
          │
          │ HTTPS
          ▼
React + TypeScript
          │
          │ Supabase client
          ▼
┌─────────────────────────┐
│        Supabase         │
│                         │
│ Auth                    │
│ PostgreSQL              │
│ Row Level Security      │
│ Storage                 │
└─────────────────────────┘
```

Frontend production hosting:

Cloudflare Pages or equivalent.

Development:

Ubuntu VM on Proxmox.

The development VM is not production infrastructure.

---

# 2. Frontend

Use:

- React
- TypeScript
- Vite

Recommended supporting tools may include:

- React Router
- TanStack Query
- Zod or equivalent validation
- appropriate PWA tooling

Avoid unnecessarily heavy application frameworks unless requirements justify them.

Responsibilities:

- navigation
- responsive UI
- forms
- authenticated Supabase client
- caching/query state
- image selection
- status presentation
- local UX behavior

Frontend is never the authoritative security layer.

---

# 3. Supabase

Use hosted Supabase for:

- authentication
- PostgreSQL
- storage
- RLS
- SQL functions/views where appropriate

Schema should be reproducible from migrations committed to Git.

Avoid undocumented dashboard-only schema changes.

---

# 4. Core data model

Initial target model should conceptually include the following.

## profiles

Application profile attached to Supabase Auth identity.

Suggested fields:

```text
id uuid primary key
display_name text
avatar_path text nullable
role enum/text
active boolean
created_at timestamptz
updated_at timestamptz
```

`id` should correspond safely to `auth.users.id`.

Role should not be browser-controlled.

---

# 5. challenges

Represents a reusable challenge.

Suggested fields:

```text
id uuid
name text
start_date date
end_date date
timezone text
required_minutes integer
proof_required boolean
missed_day_cost numeric/integer
status
created_by
created_at
updated_at
```

Constraints:

```text
end_date >= start_date
required_minutes > 0
missed_day_cost >= 0
```

Do not store `number_of_days` unless necessary.

It can be derived:

```text
(end_date - start_date) + 1
```

---

# 6. challenge_memberships

Connects participants to challenges.

Suggested fields:

```text
id uuid
challenge_id uuid
user_id uuid
participation_start_date date
participation_end_date date nullable
active boolean
created_at timestamptz
updated_at timestamptz
```

Rules:

Participation dates must intersect challenge range.

Effective eligible start:

```text
max(challenge.start_date, membership.participation_start_date)
```

Effective eligible end:

```text
min(
  challenge.end_date,
  membership.participation_end_date if present
)
```

A user outside this range is `not participating`.

Do not create missed records for non-participating dates.

---

# 7. Training entries

Canonical daily training information.

Suggested initial fields:

```text
id uuid
challenge_id uuid
user_id uuid
challenge_date date
duration_minutes integer
activity text nullable
note text nullable
status text
created_at timestamptz
updated_at timestamptz
```

Possible design:

One canonical training entry per participant/challenge/date for V1.

Unique constraint conceptually:

```text
unique(challenge_id, user_id, challenge_date)
```

This keeps daily completion simple.

If multiple workouts/day are desired later, evolve deliberately rather than accidentally.

Constraints:

```text
duration_minutes > 0
```

Creation must enforce ownership and challenge membership.

---

# 8. Training proof metadata

Suggested table:

`training_proofs`

Fields:

```text
id uuid
training_entry_id uuid
user_id uuid
storage_path text
mime_type text
size_bytes bigint
created_at timestamptz
```

Storage object itself lives in Supabase Storage.

Database row represents metadata/reference.

---

# 9. Admin audit log

Recommended:

`audit_log`

Conceptual fields:

```text
id
actor_user_id
challenge_id
target_user_id nullable
entity_type
entity_id
action
before_data jsonb nullable
after_data jsonb nullable
created_at
```

Especially useful for:

- entry invalidation
- participant membership changes
- challenge-rule changes

---

# 10. Derived challenge dates

Do not manually create hundreds of static React constants.

PostgreSQL can derive challenge dates using a date series.

Conceptually:

```sql
generate_series(
  challenge.start_date,
  challenge.end_date,
  interval '1 day'
)
```

This can support:

- matrix
- per-participant day state
- elapsed/remaining-day calculations

Implementation should balance clarity and query performance.

---

# 11. Canonical day-status calculation

Day status should derive from:

1. challenge configuration
2. challenge date
3. current time in challenge timezone
4. participant membership
5. qualifying training entry
6. required proof state

Conceptual function:

```text
if outside membership:
    NOT_PARTICIPATING

else if qualifying entry:
    COMPLETED

else if date > current challenge date:
    FUTURE

else if date == current challenge date:
    PENDING

else:
    MISSED
```

The interpretation of `qualifying entry` depends on challenge rules.

For first challenge:

```text
duration_minutes >= required_minutes
AND
proof exists when proof_required = true
```

Do not implement different versions of this logic in multiple frontend components.

Prefer one reusable database/domain representation.

---

# 12. Today in challenge timezone

A challenge's current date must be determined relative to its configured timezone.

For initial challenge:

`Europe/Stockholm`.

Server/browser UTC date cannot blindly determine challenge day.

This especially matters near midnight.

---

# 13. Recent group dashboard query

The group dashboard must not make one request per user/day.

It needs enough data to render approximately:

```text
participants × today + previous 3–5 days
```

Prefer one efficient query/view/RPC returning something conceptually like:

```text
user_id
display_name
challenge_date
state
duration
entry_id
```

The frontend can transform this into the dashboard grid.

A second query may fetch details/proof when a specific cell is opened.

Do not download every proof image merely to render the grid.

---

# 14. Full matrix query

Similarly, the full challenge matrix should use a compact source representation.

Potential approaches:

- membership list + qualifying entries + date range, derive states client-side
- SQL view returning user/date/status
- RPC purpose-built for challenge matrix

Choose the simplest performant approach.

Do not perform thousands of HTTP requests.

---

# 15. Statistics

Values such as these should primarily be derived:

- eligible days
- completed days
- missed days
- current streak
- longest streak
- completion percentage
- confirmed debt
- maximum applicable liability

Avoid canonical mutable counters that can become inconsistent.

If performance later requires materialization/caching, add it intentionally.

---

# 16. Liability calculations

For participant `P` and challenge `C`:

```text
eligible_days =
number of challenge dates covered by membership
```

```text
max_applicable_liability =
eligible_days × missed_day_cost
```

```text
confirmed_debt =
past missed eligible days × missed_day_cost
```

```text
cleared_liability =
completed eligible days × missed_day_cost
```

Potential future liability should be distinguished from already-confirmed missed-day debt.

---

# 17. RLS

Row Level Security is mandatory.

Never disable RLS as a shortcut.

Policies should express product authorization.

Participants need controlled ability to:

- read relevant challenge
- read relevant membership/group profile information
- read group-visible training entries
- access permitted proof
- create/update their own allowed training data

Participants must not:

- write another participant's training
- modify challenge rules
- change their own role
- arbitrarily alter memberships

Admins receive explicit additional permissions.

Consider security-definer functions carefully where privileged operations are required.

---

# 18. Storage security

Proof bucket is private.

Do not use public bucket URLs.

Storage policies must restrict:

- uploads
- updates
- deletes
- reads

Suggested path:

```text
challenge/{challenge_id}/{user_id}/{challenge_date}/{uuid}.jpg
```

Upload policy must not simply trust a `user_id` supplied by the client.

Authenticate ownership.

Group-visible reading can be implemented using appropriate authenticated policies or signed URLs.

---

# 19. Image handling

Validate:

- file MIME/type
- file size
- ownership
- associated challenge/member/date

Consider client-side image resizing/compression later to reduce storage/network use.

Do not block MVP with complex image processing if simple upload is adequate.

---

# 20. Authentication flow

Conceptual flow:

```text
Login
  ↓
Supabase Auth
  ↓
session
  ↓
profile
  ↓
active/relevant challenge memberships
  ↓
application
```

Potential future UX can automatically select the currently active challenge.

Architecture should permit multiple historical challenges.

---

# 21. Multiple challenges

A user may eventually have:

- current challenge
- historical challenges
- future challenge

Do not design database relations as if exactly one challenge can ever exist.

The first UI may focus on a single active challenge but the schema should support many.

---

# 22. Admin challenge editing

Be cautious when changing challenge rules after a challenge has started.

For example:

Changing:

```text
required_minutes: 30 → 60
```

could alter historical completion.

Do not casually allow retroactive changes.

Potential strategies:

- lock certain rules after challenge start
- warn administrator
- version rules
- explicitly define retroactive semantics

MVP can initially restrict dangerous edits once participation has begun.

---

# 23. Frontend environment

Expected public configuration:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

Provide:

`.env.example`

Never commit real credentials.

Never expose:

`SUPABASE_SERVICE_ROLE_KEY`

to frontend bundles.

---

# 24. Repository structure

Recommended starting point:

```text
halsoutmaningen/
├── CLAUDE.md
├── README.md
├── .env.example
├── docs/
│   ├── PRODUCT_SPEC.md
│   └── ARCHITECTURE.md
├── public/
├── src/
├── supabase/
│   ├── config.toml
│   └── migrations/
├── package.json
├── tsconfig.json
└── vite.config.ts
```

Additional directories should emerge from actual application needs.

---

# 25. Development workflow

Development takes place over SSH on the private Ubuntu VM.

Conceptual workflow:

```text
git pull
↓
development
↓
lint
↓
typecheck
↓
tests
↓
review
↓
commit
↓
push
```

Database changes:

```text
write migration
↓
review migration
↓
apply to Supabase
↓
commit migration
```

The Git repository is the source of truth for application code and database migration history.

---

# 26. Production

Frontend:

Cloudflare Pages or similar static frontend deployment.

Backend:

Supabase hosted services.

Proxmox VM:

development workstation only.

Loss/reboot of development VM must not take production offline.

---

# 27. Testing priorities

Tests are especially valuable around:

- date-range calculation
- timezone boundaries
- membership eligibility
- completed/pending/missed/future/not-participating states
- late joining
- early departure
- liability calculations
- proof-required rule
- RLS-sensitive workflows

These domain rules matter more than superficial snapshot tests.

---

# 28. Initial implementation order

Recommended:

1. initialize React/TypeScript/Vite
2. establish application shell/design foundation
3. initialize Supabase project structure
4. create migrations for challenges/profiles/memberships
5. implement authentication
6. seed/configure first challenge
7. implement training entries
8. implement private proof upload
9. implement canonical day-state logic
10. implement today/home
11. implement recent group dashboard
12. implement entry/proof detail
13. implement personal statistics
14. implement full challenge matrix
15. implement ranking
16. implement admin participant management
17. implement challenge administration
18. test mobile UX
19. deploy production frontend

Do not attempt to build the entire application in one uncontrolled generation.

Implement vertical slices and verify them.