# Hälsoutmaningen Game Master V1 — Design Specification

**Date:** 2026-09-04  
**Status:** Approved design  
**Product:** Hälsoutmaningen  
**Scope:** Game Master / Surprise Engine V1, delivered as GM1–GM4

## 1. Product north star

Hälsoutmaningen remains, first and foremost, a clean training challenge:

**träna varje dag → registrera → se gruppen → streak/skuld/ranking → final**

Game Master is seasoning, never the main experience.

The subsystem may create:
- private ambushes
- public roasts
- group events
- rivalry storylines
- machine-verifiable side competitions
- temporary titles
- competition tokens
- historical callbacks
- finale buildup

It may **not** change the core competition.

## 2. Hard invariants

Game Master must never:
- remove or protect a streak
- create or forgive debt
- change KASSAN directly
- grant free days
- mark a challenge day completed
- change ranking logic
- change weight-loss results
- change FM Atlet results
- approve/reject retroactive registration
- alter Straffbanken requirements
- make core training/logging depend on Game Master availability

If Game Master fails for three days, the only symptom must be that **Game Master is quiet for three days**.

Core writes may feed or trigger Game Master only after the core operation has succeeded.

## 3. Tone

The participants are close male friends with an established harsh sense of humor.

Tone:
- dry
- deadpan
- system-like
- observant
- sometimes genuinely acidic
- sparing with emojis
- no desperate meme voice
- no protected-trait humor
- attack performance, ego, ambition, patterns and history

Severity scale:
1. dry observation
2. light jab
3. roast
4. acidic
5. surgical execution

Severity 5 must be rare enough that it lands as “vad fan skrev appen precis?” rather than normal noise.

## 4. Randomness model

The engine is not `Math.random() → roast`.

A pulse:
1. reads authoritative challenge state
2. creates candidate observations
3. scores candidates
4. applies hard eligibility and cooldown filters
5. chooses at most one candidate using weighted randomness
6. applies a separate emission probability
7. may intentionally produce **silence**
8. persists the resulting event if one is emitted

Silence is a valid successful outcome.

### Candidate scoring

Conceptual score 0–100:
- family/base relevance: 20–40
- magnitude: 0–30
- novelty: 0–20
- final relevance: 0–10
- attention balance: -20–+10

Candidate must score at least 35.

Weighted candidate selection uses approximately `score²`.

Suggested emission probability:

`clamp(0.05, 0.60, ((score - 30) / 180) × intensity × escalation)`

Intensity:
- low = 0.65
- normal = 1.00
- high = 1.35

### Final escalation

Let `p` be challenge progress from 0 to 1.

`escalation = 0.7 + p²`

This is a soft continuous curve:
- early: quiet
- middle: normal
- late: noticeably more present
- final week: more public/finale-relevant events

Not every event family must use the full multiplier.

## 5. Hybrid wake-up model

Game Master wakes in two ways.

### Event pulse
After a successful normal app action, the frontend may request a Game Master pulse. The request never supplies a victim, metric or desired content. The server reads current authoritative state itself.

This call is best-effort and failure must not fail the core user action.

### Scheduled pulse
Supabase cron runs hourly. An internal dispatcher evaluates active challenges and runs scheduled pulses in local challenge time around:
- morning window: 08 local
- evening window: 20 local

The hourly dispatcher handles DST correctly by checking each challenge timezone and recording which local window has already run.

No push notifications in V1.

## 6. Cooldowns

At least:
- global any-event cooldown per challenge
- public-event cooldown
- subject-user cooldown
- family cooldown
- template cooldown / once-per-challenge support
- per-user recent-attention penalty

Suggested defaults:
- any event: 4 h
- public event: 36 h
- same subject: 48 h
- same family: 72 h
- severity 5 template: once per subject per challenge
- same exact template: minimum 14 days unless explicitly once-per-challenge

Settings/intensity may scale probabilities, not bypass integrity rules.

## 7. Persistent event model

An emitted surprise is a real database object.

Events freeze:
- rendered title/body
- template used
- subject(s)
- payload values used for rendering
- visibility
- severity
- timestamps
- archive policy

Later data changes must not silently rewrite an old roast.

Per-user event views track:
- first seen
- dismissed

This prevents refresh from generating or replaying the same ambush indefinitely.

## 8. Visibility

Three conceptual audiences:
- **private** — only the subject + admins
- **public** — challenge members + admins
- **group** — future event semantics; for GM1 equivalent to public challenge-wide content

Private ambushes never appear in the public archive.

## 9. Archive

Public archival events become a discrete chronicle called **Arkivet**.

It is not a social feed:
- no likes
- no comments
- no participant posting
- no sixth bottom-navigation tab

Game Master writes the history.

Initial entry point: a discrete card/link from the Group page.

## 10. Narrative memory

Raw challenge data already exists and should remain the source of truth.

Game Master memory stores only facts with future story value, e.g.:
- a long streak that broke
- unusually large debt
- major comeback
- notable previous public roast
- rivalry result
- token win
- title tenure

Memory stores structured facts, not prose.

GM1 uses a small subset of memory; advanced callbacks expand in GM3.

## 11. Challenge lore / competition context

Game Master is explicitly aware of the world of the challenge.

Current 2026 context:
- finale / julbord: 28 November
- missed-day money finances the julbord pot
- two free-julbord winners:
  - FM Atlet winner
  - greatest percentage weight loss
- all participants are men
- FM Atlet combines:
  - bench press
  - chin-ups
  - 10 km run
- scoring:
  `(10 km time in minutes × 5) - bench press kg - (chin-ups × 2)`
- lower result is better

The context must be stored structurally, not scattered as hard-coded copy throughout components.

Game Master may use self-reported minutes for jokes, but not for anything with prize integrity.

## 12. Competition tokens

Implemented in GM2, but architecture must anticipate them.

A Game Master competition may award **one Competition Token**, visually a small pixel/Minecraft-style dumbbell.

Tokens:
- have no effect on the main competition
- do not preserve streak
- do not reduce debt
- do not give free days
- do not change ranking
- are visible to everyone
- have a ledger, not a mutable counter
- show how/when each token was won
- display purpose as **ANVÄNDNING: KLASSIFICERAD**

No token use is implemented in V1.

## 13. Machine-verifiable competitions

GM2 begins with one authoritative primitive:

`first_valid_live_log`

The winner is determined only from a normal live training registration and server-side timestamp.

Explicitly excluded:
- afterregistration
- manual training minutes as winner criterion
- subjective proof quality
- AI judgment

Possible presentations using the same primitive:
- 1v1
- 3–5 participant race
- whole-group race
- rivalry duel
- multi-day elimination

Competitions are announced in advance, normally with at least 8–12 hours notice.

No acceptance is required.
No penalty for ignoring the competition.

If the winner's qualifying training entry is later invalidated:
1. revoke that token
2. recompute the competition
3. award the next legitimate winner if deterministically possible
4. otherwise end with no winner
5. publish a result correction

## 14. Rivalries

Implemented in GM3.

Rivalries are automatically discovered and temporary.

Sources may include:
- nearby ranking
- repeated overtakes
- similar streak
- recurring competitive proximity
- existing Game Master competition history

They die when they become uninteresting.

No manual “make these two rivals” control is required.

## 15. Temporary titles

Implemented in GM3.

Examples:
- KASSÖR
- STREAK-BYRÅKRAT
- TOKENBARON
- 30-MINUTERSPECIALIST
- ÅTERFALLSKLIENT
- SYSTEMETS FAVORITATLET

Titles:
- have no competition effect
- may move owners
- retain history
- max one prominently visible active title per participant

## 16. Admin control

Game Master is autonomous with an admin emergency brake.

Admin may:
- enable/disable Game Master
- enable/disable private roasts
- enable/disable public roasts
- enable/disable archive
- set low/normal/high intensity
- inspect recent events
- inspect recent pulse decisions
- cancel/hide an inappropriate event with mandatory reason
- later toggle competitions/rivalries/titles/finale families

Admin may **not**:
- “Roast Filip now”
- choose a victim
- choose a winning participant
- manually mint tokens through normal UI

All admin mutations are audited.

## 17. UI principles

Preserve the current mobile-first visual system:
- Card
- Button
- Badge
- Sheet
- ConfirmSheet
- PageHeader
- existing Scandinavian premium aesthetic
- existing five-item bottom navigation

GM1 presentation levels:
- micro banner for severity 1–2
- Sheet ambush for severity 3–5
- passive archive entry

Full-screen theatrical events are deferred.

## 18. Template bank

V1 uses hand-written templates, not AI.

Target seed: **96 templates**.

Suggested family distribution:
- missed_day: 14
- streak_long: 12
- streak_broken: 14
- debt_leader: 10
- kassan: 10
- comeback: 10
- ranking_position: 8
- historic_callback: 10
- general_system: 8

About 16/96 may be severity 5. Most severity-5 templates should carry stronger cooldown/once-per-subject rules.

Allowed named placeholders in GM1:
- `{name}`
- `{streak}`
- `{previous_streak}`
- `{missed_days}`
- `{debt_sek}`
- `{kassan_sek}`
- `{rank}`
- `{participant_count}`
- `{days_until_final}`
- `{final_date}`
- `{eligible_days}`
- `{completed_days}`

Unknown placeholders are rejected when templates are created/updated.

Sample voice:

> SYSTEMET HAR NOTERAT EN AVVIKELSE  
> Kravet var 30 minuter. Dygnet innehöll 1 440.

> KASSAN  
> Gruppen har nu gemensamt misslyckats ihop till {kassan_sek} kr. Det börjar likna en finansieringsmodell.

> STATUS  
> {name} har {streak} dagar i rad. Självförtroendet bedöms nu ligga farligt långt före den dokumenterade atletiska förmågan.

> HISTORIK  
> Förra gången {name} nådde hit tog det därefter ungefär ett dygn att återställa ordningen.

## 19. Delivery phases

### GM1 — Foundation + roasts
Build now:
- settings
- templates
- events
- views
- minimal memories
- pulse/run bookkeeping
- scoring/cooldowns/silence
- scheduled + event pulses
- private/public ambush UI
- Arkivet
- admin emergency brake + run/event inspection
- 96 template seed
- finale escalation context

No competitions/tokens/rivalries/titles yet.

### GM2 — Machine-verifiable competitions + tokens
- competitions
- competition participants
- first_valid_live_log resolver
- token ledger
- dumbbell icon
- public token counts/history
- invalidation/recompute

### GM3 — Rivalries + titles + stronger memory
- auto rivalry detection
- temporary titles
- attention balancing
- richer callbacks
- storyline scoring

### GM4 — Finale mode
- final-specific families
- FM Atlet lore
- weight-loss drama
- countdown
- recap/chronicle
- increased public-event weight
- final-day closure

Each phase is a separate plan and must be independently deployable and testable.

## 20. Deployment rule

Whenever a phase adds database migrations:

**Pause Cloudflare first**

Cloudflare Dashboard → Workers & Pages → halsoutmaningen → Settings → Builds → Deploy command

Change:

`npx wrangler deploy`

to:

`npx wrangler versions upload --assets=./dist`

Save.

Then:
1. merge approved branch
2. apply Supabase migrations
3. regenerate `src/types/database.ts`
4. run full gates
5. commit/push generated types
6. change deploy command back to `npx wrangler deploy`
7. save and retry latest main build
8. smoke-test live

Do not deploy frontend that expects a schema that is not yet live.
