# Hälsoutmaningen — Design System

The visual language for a private, adult training challenge. This document
describes the direction and the reusable system; `src/styles/tokens.css` is the
source of truth for values and every component reads from it.

---

## 1. Direction

**Nordic accountability.** Strava's sense of momentum and WHOOP's data density,
filtered through Scandinavian restraint and the calm of modern fintech. Serious,
not playful. Confident, not loud.

- **Dark-first, and deliberately dark-only.** A near-black foundation
  (`#0b0e13`) with a faint cool cast. One coherent look, tuned once, that reads
  as a native app rather than a themeable web dashboard. A light theme is a
  possible future addition, not a V1 requirement.
- **One accent.** A cool aqua (`--c-accent`, `#4bb3c4`) — "is", water, health.
  It is the brand and the primary-action colour and nothing else. Status colours
  are a separate family so "completed" (green) never competes with the brand.
- **Typography does the work.** Inter, a tight type scale, tabular numerals for
  every metric. Few big numbers — hierarchy comes from weight and spacing, not
  size.
- **Surfaces, not floating cards everywhere.** Elevation is mostly a border plus
  a darker/lighter ground; shadow is reserved for things that truly float
  (sheets, the elevated nav button). Whitespace and grouping carry structure.
- **Restraint list.** No gradients except one brand gradient used sparingly
  (`--gradient-brand`, e.g. the home hero, podium #1). No flames, bolts,
  trophies, cartoon fitness art, decorative blobs, glassmorphism pile-ups, or
  tiny-grey-text everywhere. Motion is quiet and purposeful and respects
  `prefers-reduced-motion`.

---

## 2. Tokens

### Colour — foundation

| Token                                                       | Role                         |
| ----------------------------------------------------------- | ---------------------------- |
| `--c-bg` / `--c-bg-elevated`                                | app background; desktop rail |
| `--c-surface` / `--c-surface-raised` / `--c-surface-sunken` | card grounds by elevation    |
| `--c-surface-hover`                                         | hover ground                 |
| `--c-border` / `--c-border-strong` / `--c-border-faint`     | hairlines by prominence      |
| `--c-text` / `--c-text-muted` / `--c-text-faint`            | text by hierarchy            |

### Colour — brand

`--c-accent`, `--c-accent-hover`, `--c-accent-pressed`, `--c-accent-quiet`
(filled-chip ground), `--c-accent-text` (accent as text on dark, AA), and
`--c-accent-contrast` (text/icon on a solid accent fill).

### Colour — status

Each canonical day state has a `-text`, `-surface` and `-border` token:

| State               | Token base                                      | Feel                                       |
| ------------------- | ----------------------------------------------- | ------------------------------------------ |
| `COMPLETED`         | `--c-completed-*` (green)                       | clearly positive                           |
| `MISSED`            | `--c-missed-*` (warm clay, not fire-engine red) | obvious, not aggressive                    |
| `PENDING`           | `--c-pending-*` (amber)                         | attracts attention; pulses when it's today |
| `FUTURE`            | `--c-future-*`                                  | quiet, neutral                             |
| `NOT_PARTICIPATING` | `--c-absent-*`                                  | barely there                               |

**Colour is never the only signal.** Every state also has a distinct glyph
(`✓`, `✕`, clock, hollow dot, dash) and a text label. See §4.

### Type

`--fs-2xs … --fs-display` (11px → 52px). Body is `--fs-base` (15px). Numeric
display uses `.tnum` (tabular-nums). Tracking tightens as size grows
(`--tracking-tight` on headings, `--tracking-eyebrow` on uppercase labels).
Weights: 400 / 500 / 600 / 700.

### Spacing / radius / elevation / motion

- Spacing: 4px base, `--sp-1 … --sp-10`.
- Radius: `--radius-xs` (6px) → `--radius-xl` (22px) + `--radius-full`.
- Elevation: `--shadow-sm | -md | -lg`, `--shadow-focus`.
- Motion: `--ease-out`, `--ease-in-out`; `--dur-fast` (120ms) / `--dur-base`
  (200ms) / `--dur-slow` (340ms). All transitions collapse under
  `prefers-reduced-motion`.

### Layout

`--app-max-width` (30rem, the mobile content column) / `--app-max-width-wide`
(68rem, desktop). `--bottom-nav-height`, `--touch-target` (2.75rem),
`--safe-top` / `--safe-bottom` for insets.

---

## 3. Components (`src/components`)

| Component                                                        | Notes                                                                                                                   |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `ui/Button`                                                      | `primary \| secondary \| ghost \| danger`, `sm \| md \| lg`, `loading`, `icon`, `fullWidth`. Min height = touch target. |
| `ui/Card`                                                        | `default \| raised \| sunken \| gradient \| bare`, `padding` none→lg, optional uppercase `title` eyebrow + `action`.    |
| `ui/Badge`                                                       | tones `neutral \| accent \| completed \| missed \| pending \| future`, `dot`, `icon`, `sm \| md`.                       |
| `ui/Avatar`                                                      | initials with a stable per-name hue; `xs…xl`; `ring` marks "du".                                                        |
| `ui/ProgressRing`                                                | SVG ring, tone-coloured, centre slot, `aria-label` with %.                                                              |
| `ui/ProgressBar`                                                 | linear, tones, optional ghost track, `role="progressbar"`.                                                              |
| `ui/StatTile`                                                    | eyebrow label + tabular value + unit + hint; tone tints the value only.                                                 |
| `ui/SegmentedControl`                                            | `role="radiogroup"`, generic over a string union.                                                                       |
| `ui/Sheet`                                                       | bottom sheet (mobile) / centred dialog (desktop). Focus trap, Escape, scroll lock, `aria-modal`, restores focus.        |
| `ui/Skeleton` / `SkeletonText`                                   | shimmer; static under reduced motion.                                                                                   |
| `status/StatusCell`                                              | the status square — glyph + tone; `today` emphasis; becomes a button when it opens an entry.                            |
| `status/StatusLegend`                                            | labelled key for the five states.                                                                                       |
| `status/statusMeta`                                              | single map: state → `{ label, short, Icon, tone }`.                                                                     |
| `proof/ProofImage`                                               | fixture-phase placeholder: a deterministic GPS-route trace from a seed. Swap for the signed-URL `<img>` in Fas 6.       |
| `feedback/EmptyState`, `ErrorState`, `AppLoading`, `Spinner`     | first-class states; Swedish copy, optional icon, retry action.                                                          |
| `layout/AppShell`, `TopBar`, `BottomNav`, `SideNav`, `BrandMark` | see §5.                                                                                                                 |

Feature-level compositions live under `src/features/*`: `challenge/LiabilityCard`,
`challenge/EntryDetailSheet`, `group/RecentGrid`, `overview/MatrixGrid`,
`profile/PersonalCalendar`, `ranking/ranking.ts`.

---

## 4. Status system

Canonical states come from `src/domain/dayState.ts` (`DayState`). The UI layer
adds presentation in `statusMeta`:

```
COMPLETED         ✓   green    "Genomförd"   — tap to open the entry + proof
MISSED            ✕   clay     "Missad"
PENDING (today)   ◷   amber    "Kvar idag"   — pulsing ring in today's column
FUTURE            ·   neutral  "Kommande"
NOT_PARTICIPATING —   faint    "Deltog ej"
```

Rules:

- Never render a state from colour alone — glyph + `aria-label` always.
- "Today" is emphasised with an accent outline wherever a grid has columns.
- Future is never styled as missed; not-participating is never styled as missed.

---

## 5. Navigation & shell

- **Mobile:** sticky `TopBar` (brand + avatar → Profil) and a fixed
  `BottomNav` with five destinations — **Hem · Gruppen · [Logga] · Översikt ·
  Ranking** — where _Logga_ is an elevated accent button (the primary action).
  Profil is reached from the avatar; Admin from within Profil (admins only).
- **Desktop (≥60rem):** the bottom bar is replaced by a left `SideNav` rail
  with every destination labelled, plus account + sign-out at the foot. Content
  widens to `--app-max-width-wide` and several screens switch to two columns.
- Navigation is data (`src/config/navigation.ts`) so the shell, both nav
  surfaces and the route table stay in sync.

---

## 6. Responsiveness & accessibility

- Designed at 375 / 390 / 430 / tablet / ~1440. The content column is capped so
  large phones and tablets don't get sparse full-bleed rows.
- The only horizontal scroll is intentional: `RecentGrid` and `MatrixGrid`, each
  an `overflow-x` region with a sticky participant column. The page body never
  scrolls sideways.
- Safe-area insets on the top bar, bottom nav, sheet footer and the sticky
  submit bar.
- Semantic landmarks, visible `:focus-visible` ring everywhere, `role`s on the
  custom controls (segmented control, progress, sheet, status cells), labelled
  icon-only buttons, `prefers-reduced-motion` honoured by every animation.

---

## 7. Data / fixtures boundary

Screens never import fixtures. They call `useChallengeData()`
(`src/features/challenge/useChallengeData.ts`), which today resolves a typed
development dataset (`src/fixtures/*`, all derived through the real domain layer)
and later becomes the Supabase RPC calls that produce the same
`ChallengeDataset` shape. See §9 of the phase report for what still needs wiring.
