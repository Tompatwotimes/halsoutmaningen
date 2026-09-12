import type { ChallengeConfig } from '@/domain/challenge';
import type { DayState } from '@/domain/dayState';
import type { LiabilityBreakdown } from '@/domain/liability';
import type { MembershipConfig } from '@/domain/membership';
import type { PenaltyType } from '@/domain/penalties';
import type { MembershipStateResult } from '@/features/admin/membershipState';
import type { Role } from '@/features/profile/profile-api';

/**
 * The effective (penalty-aware) training requirement for one challenge day,
 * plus that day's live session totals — straight from `challenge_day_states`.
 * `penalty*` is null on a normal day.
 */
export interface DayRequirement {
  requiredMinutes: number;
  requiredSessions: number;
  minMinutesPerSession: number;
  penaltyType: PenaltyType | null;
  penaltyDisplayName: string | null;
  penaltyFromUserId: string | null;
  /** Sessions logged for the day, any status. */
  sessionCount: number;
  /** Sessions that count toward the requirement. */
  validSessionCount: number;
  totalValidMinutes: number;
}

/**
 * Shared shapes for the real (Supabase-backed) challenge data layer.
 *
 * These used to live next to the fixture builder (`src/fixtures/dataset.ts`);
 * moved out so real screens depend on the domain/API layer, not on fixtures
 * (CLAUDE.md §18, docs/DESIGN_SYSTEM.md §7). The fixture builder now imports
 * from here for the dev-only design-preview harness.
 */

export interface ParticipantView {
  userId: string;
  displayName: string;
  role: Role;
  isSelf: boolean;
  profileActive: boolean;
  membership: MembershipConfig;
  membershipDisplay: MembershipStateResult;
  /**
   * The day-state rows this view was built from, ascending. For the
   * signed-in user (`isSelf`) and for every row of `useChallengeMatrix()`
   * this is the *complete* eligible history. For any other participant
   * inside the base `useChallengeData()` dataset it is deliberately only a
   * recent window (`RECENT_WINDOW_DAYS`, see `useChallengeData.ts`) — egress
   * forensics (2026-09) found every screen fetching the full multi-hundred-KB
   * matrix for every participant on every navigation when almost nothing
   * renders more than "today"/"the last few days" for anyone but the current
   * user. Never assume a date outside that window is present here; a missing
   * date is not evidence of `not_participating`.
   */
  days: { date: string; state: DayState }[];
  /** Day → state map for whatever window `days` covers (see above). */
  statesByDate: Map<string, DayState>;
  /** Canonical state for today, or null when not eligible today. */
  todayState: DayState | null;
  /** Effective requirement for today (penalty-aware), null when not eligible today. */
  todayRequirement: DayRequirement | null;
  /** Per-date effective requirement for whatever window `days` covers (see above). */
  requirementByDate: Map<string, DayRequirement>;
  /** True when eligible today AND membership currently active. */
  activeToday: boolean;
  /** Always server-computed (`challenge_results` RPC) — never derived client-side. */
  currentStreak: number;
  longestStreak: number;
  liability: LiabilityBreakdown;
  /** completed / (completed + missed) — decided days only, 0–1. */
  completionRate: number;
  decidedDays: number;
}

/** A lightweight projection of one of the signed-in user's own training sessions. */
export interface SelfEntry {
  entryId: string;
  date: string;
  /** 1-based session ordinal within the day. */
  sessionSeq: number;
  durationMinutes: number;
  activity: string | null;
  note: string | null;
  hasProof: boolean;
  submittedAt: string;
  status: 'active' | 'invalidated';
}

export interface ChallengeDataset {
  challenge: ChallengeConfig;
  /** Challenge-local "today" (display; every write is re-verified server-side). */
  today: string;
  self: ParticipantView;
  /** All participants with a membership row, ordered by display name. */
  participants: ParticipantView[];
  /** Participants eligible + active today, ordered by display name. */
  rosterToday: ParticipantView[];
  /** The signed-in user's own sessions, most recent day first, seq ascending. */
  selfEntries: SelfEntry[];
  /** The primary session (seq 1) for a date, or null. */
  getSelfEntry: (date: string) => SelfEntry | null;
  /** Every session logged by the signed-in user on a date, seq ascending. */
  getSelfSessions: (date: string) => SelfEntry[];
}
