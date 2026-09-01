# Hälsoutmaningen — Product Specification

## 1. Product purpose

Hälsoutmaningen is a private social training challenge application.

Its purpose is to make daily accountability easy and enjoyable while giving every challenge member a transparent overview of how the whole group is doing.

The product replaces combinations of:

- spreadsheets
- chat messages
- manually shared photos
- manual debt calculation
- remembering who trained which day

The application should make participation obvious, social and low-friction.

---

# 2. Product model

The application contains reusable challenges.

A challenge has configurable:

- name
- start date
- end date
- timezone
- minimum daily training duration
- proof-image requirement
- cost per missed eligible day
- status

The number of challenge days is automatically calculated.

Participants are connected to challenges through membership records.

Therefore neither participant count nor challenge duration is fixed.

---

# 3. Initial challenge

Initial configuration:

| Setting | Value |
|---|---|
| Name | Hälsoutmaningen 2026 |
| Start | 2026-08-01 |
| End | 2026-11-28 |
| Duration | Automatically calculated: 120 days |
| Required training | 30 minutes/day |
| Proof | Required |
| Missed-day cost | 50 SEK |
| Timezone | Europe/Stockholm |
| Initial participants | Approximately 21, dynamically managed |

A participant eligible for all 120 days therefore has a maximum challenge liability of:

`120 × 50 SEK = 6,000 SEK`

---

# 4. Administrator — challenge creation

An administrator should eventually have a workflow similar to:

```text
Skapa utmaning

Namn:
[ Hälsoutmaningen 2027 ]

Startdatum:
[ 2027-08-01 ]

Slutdatum:
[ 2027-11-30 ]

Minsta träning:
[ 30 ] minuter

Bildbevis:
[ ✓ Krävs ]

Missad dag:
[ 50 ] kr

Tidszon:
[ Europe/Stockholm ]

[ Skapa utmaning ]
```

After selecting dates the interface should display useful derived information.

Example:

```text
122 dagar
Maxbelopp för deltagare som är med hela perioden:
6 100 kr
```

No code deployment should be required.

---

# 5. Participant management

Challenge participation is dynamic.

Admin should be able to:

- add participant
- invite/create account
- connect existing account
- choose participation start date
- end participation
- deactivate membership
- reactivate membership
- inspect historical membership

Hard deletion should not be the default because historical entries may matter.

Examples:

## Full participation

```text
Anna
2026-08-01 → 2026-11-28
```

Anna is evaluated for all 120 days.

## Late join

```text
Erik
2026-08-20 → 2026-11-28
```

Dates before August 20 are `not participating`, not missed.

## Early departure

```text
Lisa
2026-08-01 → 2026-10-15
```

Dates after October 15 do not count as misses.

---

# 6. Main navigation

A reasonable initial mobile navigation:

- Hem
- Logga
- Gruppen
- Översikt
- Ranking
- Profil

Admin receives an additional administration section.

Exact navigation may evolve after UX implementation.

---

# 7. Home screen

The home screen primarily answers:

### Have I trained today?

Prominent state.

### How am I doing?

Show:

- current streak
- completed eligible days
- missed days
- completion percentage
- liability/debt
- challenge progress

### How is the group doing?

Show something like:

```text
17 av 21 har tränat idag
```

with dynamic counts.

Primary CTA:

`Logga träning`

---

# 8. Training logging

V1 entry fields:

- challenge
- challenge date
- duration in minutes
- activity/type, optional
- note, optional
- proof image when required
- submission timestamp
- authenticated participant

Default date:

today in challenge timezone.

Normal mobile flow:

```text
Logga träning

Tid:
[ 45 min ]

Aktivitet:
[ Löpning ]

Kommentar:
[ 8 km lugnt ]

Bildbevis:
[ Ta bild / välj bild ]

[ Registrera ]
```

After successful submission:

- today's state becomes completed
- dashboard updates
- personal stats update
- leaderboard/progress updates where applicable

---

# 9. Group dashboard

This is one of the application's signature features.

The purpose is to make group accountability obvious.

The default dashboard focuses on today and roughly 3–5 previous days.

Example:

```text
                 IDAG   IGÅR   30/8   29/8   28/8
---------------------------------------------------
Anna              ✅     ✅      ✅      ❌      ✅
Erik              ⏳     ✅      ✅      ✅      ✅
Johan             ✅     ✅      ✅      ✅      ✅
Lisa              ⏳     ❌      ✅      ✅      ✅
```

Possible statuses:

- ✅ completed
- ❌ missed
- ⏳ today and still pending
- — not participating
- future dates are never misses

Today should visually dominate the view.

---

# 10. Group dashboard summary

Useful headline:

```text
17 av 21 har tränat idag
```

Additional useful information may include:

```text
81 % klara idag

Återstår:
Erik
Lisa
Martin
Sara
```

Potential later additions:

- latest completed training
- streak milestones
- group completion trend

The UI should avoid becoming noisy.

---

# 11. Inspecting another participant's training

A user should be able to tap a completed dashboard cell.

Example result:

```text
Anna Andersson

31 augusti
Löpning
42 minuter

"Kvällsrunda"

Registrerad:
20:14

[Bildbevis]
```

This is important for social accountability and anti-cheating.

Authorized group members may see challenge-related proof.

They must not gain access to unrelated/private account data.

---

# 12. Anti-cheating model

V1 uses social transparency rather than sophisticated automated detection.

Participants can:

- see whether someone claims completion
- see duration
- see activity
- inspect submitted proof
- see submission timestamp

Participants cannot:

- modify another user's entry
- delete another user's proof
- administratively invalidate entries

Admin may correct/invalidate exceptional entries.

Admin changes affecting results should ideally create an audit record.

Future challenge versions may add reporting/dispute features.

---

# 13. Full challenge matrix

The full overview contains all challenge days.

Columns derive from:

`challenge.start_date → challenge.end_date`

Rows derive from applicable memberships.

Example first challenge:

approximately:

`21 × 120`

But this must never be assumed programmatically.

The matrix provides long-term context while the group dashboard provides immediate recent accountability.

---

# 14. Personal profile/progress

Participant page should show:

- display name
- optional avatar
- current streak
- longest streak
- completed eligible days
- missed eligible days
- completion percentage
- eligible days elapsed
- applicable liability
- final debt so far
- historical training entries
- personal calendar/history

Do not expose email address or unnecessary private account fields to the group.

---

# 15. Challenge day states

## Completed

Participant was eligible and fulfilled challenge requirement.

## Pending

Participant is eligible today but has not completed it yet.

## Missed

Participant was eligible, the day has ended, and qualifying completion does not exist.

## Future

Eligible challenge date has not happened yet.

## Not participating

Date lies outside that participant's membership period.

All screens must use the same canonical interpretation.

---

# 16. Liability

For each eligible challenge day:

- completed → no missed-day debt for that day
- missed → configured cost applies
- future → not final debt yet
- not participating → no debt

Useful UI values:

### Maximum applicable challenge liability

Eligible membership days × missed-day cost.

### Cleared amount

Completed eligible days × missed-day cost.

### Current confirmed debt

Past missed eligible days × missed-day cost.

### Remaining exposure

Future eligible days × missed-day cost.

The exact labels should be user-friendly in Swedish.

---

# 17. Ranking

V1 leaderboard should stay understandable.

Possible ordering:

1. completion percentage or completed eligible days
2. fewer missed days
3. current streak as supporting information

Care is required for late joiners.

Do not unfairly rank someone with fewer eligible days purely because raw completed-day totals differ.

The exact ranking formula should be explicitly defined before becoming competitive truth.

Do not invent arbitrary points without approval.

---

# 18. Proof images

Requirements:

- upload directly from phone
- camera support
- private storage
- authenticated display
- efficient thumbnail/preview behavior
- reasonable size restrictions
- supported image-type validation

Proof images should not have permanent public URLs.

---

# 19. Administration

Admin area should eventually support:

## Challenges

- create
- edit before/where appropriate
- start/end dates
- rule configuration
- status

## Participants

- add
- invite
- membership start/end
- activate/deactivate

## Entries

- inspect
- correct/invalidate exceptional submissions
- review proof

## Statistics

- group status
- missing participants
- challenge progress
- participant performance

## Audit

Important admin modifications should be visible in an audit trail.

---

# 20. Mobile-first UX

Primary usage is expected from phones.

Important requirements:

- fast initial load
- large controls
- photo capture works naturally
- dashboard readable on narrow screens
- clear `Logga träning` action
- responsive status grid
- minimal typing
- strong feedback after saving
- installable/PWA-ready architecture

---

# 21. Desktop

Desktop should take advantage of available space.

In particular:

- recent-days dashboard can show all participants comfortably
- full matrix can show significantly more columns
- admin workflows may use richer tables/forms

Mobile remains the primary design constraint.

---

# 22. Notifications — future

Not required for first usable release but architecture should permit:

- evening reminder when today's training remains incomplete
- streak warning
- milestone notification
- challenge-start/end notifications

Do not block MVP on notifications.

---

# 23. MVP scope

First genuinely usable version should include:

1. authentication
2. challenge configuration/data
3. challenge membership
4. participant management
5. daily logging
6. private proof-image upload
7. correct timezone/day-state calculations
8. today view
9. recent group dashboard
10. inspection of group-visible proof
11. personal stats
12. full challenge matrix
13. liability calculation
14. basic ranking
15. responsive mobile interface
16. admin basics
17. production deployment

---

# 24. Success criteria

A participant should be able to open the app and within seconds know:

- whether they have completed today
- who else has completed today
- who is still missing
- what happened during the last several days

They should be able to log qualifying training with image proof in under one minute.

An administrator should be able to create a future challenge using different dates and participant count without asking a developer to modify source code.