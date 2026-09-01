# Hälsoutmaningen — Master Development Instructions

## 1. Project identity

Hälsoutmaningen is a private, mobile-first web application for running social training challenges.

It must be built as a reusable challenge platform, not as an application permanently tied to one specific group, number of participants, date range or training rule.

The first challenge happens to have approximately 21 participants and runs from 2026-08-01 through 2026-11-28, but these are configuration values for the first challenge only.

The application must support future challenges without source-code changes.

The intended product combines:

- daily training accountability
- proof images
- social transparency
- group overview
- recent activity
- personal progress
- streaks
- leaderboard
- missed-day financial liability
- administration
- reusable challenge configuration

This will be used by real people.

Build a maintainable production application, not a disposable prototype.

---

# 2. First challenge configuration

The initial challenge should be configured as:

- Name: Hälsoutmaningen 2026
- Start date: 2026-08-01
- End date: 2026-11-28
- Timezone: Europe/Stockholm
- Required training duration: 30 minutes per eligible challenge day
- Proof image required: yes
- Cost per missed eligible challenge day: 50 SEK

The number of days must be calculated from the configured dates.

For this challenge:

2026-08-01 through 2026-11-28 inclusive = 120 calendar days.

Therefore a participant who participates for all 120 eligible days has:

120 × 50 SEK = 6,000 SEK maximum challenge liability.

These values are data.

Do not hardcode:

- 21 participants
- 120 days
- 30 minutes
- 50 SEK
- 6,000 SEK
- August 1
- November 28

inside application logic or UI components.

---

# 3. Reusable challenges

An administrator must be able to create a new challenge.

At minimum a challenge should have:

- name
- start date
- end date
- timezone
- required training minutes
- proof-required setting
- missed-day cost
- active/status state

The application derives:

- number of challenge days
- participant eligibility
- maximum applicable liability
- matrix columns
- progress percentages
- elapsed days
- remaining days
- missed days
- completed days

from configuration and membership data.

Example future challenge:

```text
Name: Höstutmaningen 2027
Start: 2027-09-01
End: 2027-10-15
Required minutes: 45
Proof required: yes
Missed day cost: 25 SEK
```

The application must support this without code changes.

---

# 4. Dynamic participants

Participant count is dynamic.

Approximately 21 participants are expected initially, but the application must make no assumption about exact participant count.

Administrators must be able to:

- invite/add a participant
- add an existing account to a challenge
- activate a challenge membership
- deactivate a challenge membership
- remove someone from future participation
- restore/reactivate where appropriate
- inspect membership history

Historical challenge data must not normally be destroyed when a participant leaves.

Use challenge membership rather than equating authentication account with participation.

Conceptually:

```text
auth user
   ↓
profile
   ↓
challenge membership
   ↓
challenge
```

Membership should support:

- participation start date
- participation end date
- active/inactive state
- created timestamp

This is critical.

Example:

If Erik joins on challenge day 20, days 1–19 must NOT become missed days.

If Lisa leaves after day 70, days 71 onward must NOT become missed days.

Only eligible participation dates affect challenge results and liability.

---

# 5. Primary product experiences

There are four especially important experiences.

## 5.1 Today

A participant opening the application should immediately understand:

- whether today's training is completed
- how much training is required
- current streak
- current challenge progress
- current liability/debt status
- how the group is doing today

The primary action should be obvious:

`Logga träning`

---

## 5.2 Logging training

Daily logging must be extremely easy from a phone.

Ideal flow:

1. Open app.
2. Tap `Logga träning`.
3. Enter duration.
4. Optionally select/type activity.
5. Optionally write a note.
6. Take or select proof image.
7. Submit.
8. Status updates immediately throughout the application.

Target:

A normal entry should comfortably take less than one minute.

The default date should normally be today.

Historical/backfilled entries may be supported according to challenge/admin rules.

---

## 5.3 Group dashboard

The group dashboard is a core product feature.

Participants should be able to immediately see what the others are doing.

Primary focus:

- today
- yesterday
- approximately the previous 3–5 days

Conceptual view:

```text
                    Idag   Igår   Mån   Sön   Lör
--------------------------------------------------
Anna                 ✅     ✅     ❌     ✅     ✅
Erik                 ⏳     ✅     ✅     ✅     ❌
Johan                ✅     ✅     ✅     ✅     ✅
Lisa                 ⏳     ❌     ✅     ✅     ✅
```

Possible states:

- completed
- missed
- pending today
- future
- not participating

Today's column should be especially prominent.

The dashboard should also make group progress obvious:

```text
17 av 21 har tränat idag
```

But `21` must always be calculated dynamically from participants eligible today.

Useful dashboard information may include:

- completed today
- remaining participants today
- daily completion percentage
- recent training activity
- recent missed days
- group momentum
- participant streaks

---

## 5.4 Full challenge overview

There must also be a complete participant × challenge-day matrix.

Rows:

eligible challenge participants.

Columns:

every calendar challenge day between configured start and end dates.

For the first challenge this happens to be approximately:

21 participants × 120 days.

Future challenges may be shorter, longer, smaller or larger.

The matrix must adapt dynamically.

---

# 6. Social transparency and verification

A major purpose of Hälsoutmaningen is that participants can follow one another and notice obvious cheating or invalid registrations.

V1 does not require automated AI fraud detection.

Instead, authenticated challenge participants should be able to inspect group-visible training entries.

Opening a completed day should be able to show:

- participant
- challenge date
- duration
- activity
- note if present
- proof image
- submission timestamp

This provides social verification.

Participants may never alter another participant's training entry.

Administrators may be given explicit correction/invalidation abilities.

Challenge-impacting admin corrections should be auditable.

Proof access remains private to authorized challenge members, not the public internet.

---

# 7. Challenge day logic

A user should only be evaluated on an eligible challenge date.

An eligible date requires:

- date lies within challenge start/end
- participant membership covers that date

A completed day requires a valid qualifying training submission according to challenge configuration.

For the initial challenge:

```text
duration >= 30 minutes
AND
proof image exists
```

if proof is required.

Possible canonical day states:

## Completed

Participant was eligible and completed challenge requirements.

## Missed

Participant was eligible, the local challenge day is over, and requirements were not completed.

## Pending

Participant is eligible today but has not yet completed the requirements.

## Future

Eligible date has not occurred yet.

## Not participating

The user was not an eligible challenge participant on that date.

Do not treat future dates as missed.

Do not treat non-membership dates as missed.

---

# 8. Time handling

Challenge logic uses local calendar dates.

Each challenge has a timezone.

For the first challenge:

`Europe/Stockholm`

Use explicit timezone handling.

Avoid errors where a submission shortly before/after midnight is assigned to the wrong challenge day because of UTC conversion.

Use timezone-aware timestamps for events and explicit PostgreSQL `date` values for challenge-day semantics where appropriate.

---

# 9. Financial challenge liability

Each challenge may configure a cost per missed eligible day.

For the initial challenge:

`50 SEK`

Important concepts:

- eligible challenge days
- completed days
- missed days
- possible remaining liability
- final debt
- cleared liability

A full first-challenge participant has:

```text
120 eligible days
× 50 SEK
= 6,000 SEK maximum liability
```

A participant who joins later must have a lower applicable maximum based on eligible participation days.

Final debt should conceptually be:

```text
missed eligible days × challenge missed-day cost
```

Future eligible days must not be counted as final missed-day debt before they occur.

Do not accept debt calculations supplied by the frontend as authoritative.

---

# 10. Authentication

The application is private.

Unauthenticated visitors must not have access to challenge content.

Use Supabase Auth.

Initial roles:

## Participant

May:

- view allowed challenge information
- see group dashboard
- inspect permitted proof
- see leaderboard/statistics
- log own training
- update permitted profile data

May not:

- alter another participant
- alter another participant's training
- change challenge configuration
- use admin functions

## Administrator

May additionally:

- create/configure challenges
- manage challenge membership
- add/remove/deactivate participants
- inspect all relevant entries
- make authorized corrections
- administer challenge settings
- view administrative information

Authorization must be enforced in PostgreSQL/RLS and not merely by hiding frontend controls.

---

# 11. Proof images

Training proof images are private application data.

Use Supabase Storage with a private bucket.

Never use globally public proof URLs.

Use authenticated access and/or signed URLs as appropriate.

Store image metadata in PostgreSQL.

Conceptual storage layout:

```text
challenge/{challenge_id}/{user_id}/{challenge_date}/{uuid}.jpg
```

Metadata may include:

- training entry
- storage path
- MIME type
- file size
- upload timestamp
- uploader identity

Do not rely on filenames alone as database state.

Mobile camera/image-picker support is important.

Image upload must feel quick.

---

# 12. Full challenge matrix performance

Never issue one request per cell.

A challenge with 21 participants and 120 days already creates 2,520 logical cells.

Load entries/membership/challenge data efficiently and derive presentation from a small number of queries or purpose-built aggregate views/functions.

Avoid N+1 request patterns.

---

# 13. Mobile design

Mobile is the primary target.

The app should feel like a polished modern application rather than a shrunk desktop dashboard.

Prioritize:

- large touch targets
- clear primary actions
- strong typography
- quick perceived performance
- responsive cards
- good camera/upload UX
- sticky navigation where useful
- proper empty/loading/error states
- accessible controls

For the recent-days dashboard, mobile may use a horizontally scrollable status grid.

For the full challenge matrix consider:

- horizontal scrolling
- sticky names
- sticky date headers
- month grouping
- jump to today
- compact display

Do not force a massive desktop table into a narrow viewport.

---

# 14. UI language and visual direction

Primary UI language:

Swedish.

Technical code and documentation may use English.

Avoid:

- childish fitness graphics
- overly playful gamification
- generic enterprise admin-dashboard appearance
- unnecessary gradients
- clutter
- tiny controls
- excessive modal use

Prefer:

- professional visual identity
- clear status indicators
- clean hierarchy
- modern typography
- subtle animation
- purposeful gamification
- fast interactions

---

# 15. Gamification

Useful concepts include:

- current streak
- longest streak
- completed days
- completion percentage
- missed days
- remaining challenge days
- liability/debt
- leaderboard
- milestones
- recent activity

Do not invent arbitrary points that change or obscure the actual challenge rules unless explicitly requested.

---

# 16. Technology

Preferred stack:

- React
- TypeScript
- Vite
- PWA-capable frontend
- Supabase hosted backend
- PostgreSQL
- Supabase Auth
- Supabase Storage
- Supabase Row Level Security
- Supabase migrations stored in Git
- GitHub
- Cloudflare Pages or equivalent frontend hosting

The Ubuntu Proxmox VM is a development environment only.

Production must continue functioning even if that VM is offline.

Do not introduce another backend service unless technically justified.

---

# 17. Database integrity

The frontend is untrusted.

Never trust browser-supplied values for authoritative fields such as:

- user identity
- participant ownership
- challenge completion
- missed-day status
- debt
- role
- admin status

Use:

- authenticated identity
- database constraints
- RLS
- database functions/views where appropriate
- challenge configuration
- membership state
- canonical training entries

Prefer deriving statistics over maintaining duplicated counters that may drift.

---

# 18. Development rules

Before implementing a major feature:

1. Read this file.
2. Read relevant `/docs` files.
3. Inspect current application/schema.
4. Preserve working functionality.
5. Prefer incremental, testable changes.
6. Never weaken security merely to make development easier.
7. Never commit secrets.
8. Keep database changes in migrations.
9. Run relevant lint/typecheck/tests.
10. Report significant architectural changes.

Never silently alter core challenge behavior.

If requirements conflict, identify the conflict before redefining the domain.

---

# 19. Secrets

Never commit:

- passwords
- service-role keys
- private tokens
- `.env` files containing credentials

Frontend may use browser-safe Supabase public configuration.

Use:

`.env.example`

for required variables.

Never expose the Supabase service-role key to browser code.

---

# 20. Definition of success

A normal participant should be able to:

1. open Hälsoutmaningen on their phone
2. immediately understand today's situation
3. see how everyone else is doing
4. register training and proof quickly
5. immediately see updated group/personal progress

An administrator should be able to:

1. configure a challenge using real start/end dates
2. configure challenge rules
3. add or remove participants
4. understand group status
5. administer exceptions without editing source code

A future challenge should be creatable without modifying application code.