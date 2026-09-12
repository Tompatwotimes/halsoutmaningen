import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database';
import { ChallengeStatus, type ChallengeConfig } from '@/domain/challenge';
import { DayState } from '@/domain/dayState';
import { PenaltyType } from '@/domain/penalties';
import type { MembershipConfig } from '@/domain/membership';

function toStatus(value: string): ChallengeStatus {
  switch (value) {
    case 'active':
      return ChallengeStatus.Active;
    case 'completed':
      return ChallengeStatus.Completed;
    case 'archived':
      return ChallengeStatus.Archived;
    default:
      return ChallengeStatus.Draft;
  }
}

function toChallengeConfig(row: {
  id: string;
  name: string;
  description: string | null;
  start_date: string;
  end_date: string;
  timezone: string;
  required_minutes: number;
  proof_required: boolean;
  missed_day_cost: number;
  status: string;
}): ChallengeConfig {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    startDate: row.start_date,
    endDate: row.end_date,
    timeZone: row.timezone,
    requiredMinutes: row.required_minutes,
    proofRequired: row.proof_required,
    missedDayCost: row.missed_day_cost,
    status: toStatus(row.status),
  };
}

export interface MyMembership {
  challenge: ChallengeConfig;
  membership: MembershipConfig;
}

/**
 * The signed-in user's own memberships, each resolved with its challenge.
 *
 * Two small queries rather than an embed — predictable typing, matching
 * `roster-api.ts`. RLS: a user's own `challenge_memberships` rows are always
 * readable (their existence is what `is_challenge_member()` checks), and each
 * referenced `challenges` row passes the same way.
 */
export async function fetchMyMemberships(
  userId: string,
): Promise<MyMembership[]> {
  const { data: memberships, error: mErr } = await supabase
    .from('challenge_memberships')
    .select(
      'challenge_id, participation_start_date, participation_end_date, active',
    )
    .eq('user_id', userId);

  if (mErr) {
    throw new Error(mErr.message);
  }
  if (memberships.length === 0) {
    return [];
  }

  const { data: challenges, error: cErr } = await supabase
    .from('challenges')
    .select(
      'id, name, description, start_date, end_date, timezone, required_minutes, proof_required, missed_day_cost, status',
    )
    .in(
      'id',
      memberships.map((m) => m.challenge_id),
    );

  if (cErr) {
    throw new Error(cErr.message);
  }

  const byId = new Map(challenges.map((c) => [c.id, c]));

  return memberships
    .map((m) => {
      const challengeRow = byId.get(m.challenge_id);
      if (!challengeRow) return null;
      return {
        challenge: toChallengeConfig(challengeRow),
        membership: {
          userId,
          participationStartDate: m.participation_start_date,
          participationEndDate: m.participation_end_date,
          active: m.active,
        },
      };
    })
    .filter((m): m is MyMembership => m !== null);
}

/**
 * Picks the single challenge the app focuses on for this user: the active
 * one if they have one, otherwise their most recently started membership.
 * Returns null when the user has no membership anywhere — a legitimate state
 * (a brand-new admin account, or someone between challenges), not an error
 * (CLAUDE.md §4 — membership is separate from having an account at all).
 *
 * The architecture supports more than one concurrent/historical membership;
 * a future challenge switcher can render `fetchMyMemberships` directly.
 */
export async function fetchMyPrimaryChallenge(
  userId: string,
): Promise<MyMembership | null> {
  const memberships = await fetchMyMemberships(userId);
  if (memberships.length === 0) return null;

  const active = memberships.find(
    (m) => m.challenge.status === ChallengeStatus.Active,
  );
  if (active) return active;

  return memberships.reduce((latest, m) =>
    m.challenge.startDate > latest.challenge.startDate ? m : latest,
  );
}

export interface DayStateRow {
  userId: string;
  challengeDate: string;
  state: DayState;
  /** Every training session logged for the day, any status. */
  sessionCount: number;
  /** Sessions that contribute toward the (penalty-aware) requirement. */
  validSessionCount: number;
  totalValidMinutes: number;
  /** Effective required total minutes for the day (penalty-aware). */
  requiredMinutes: number;
  requiredSessions: number;
  minMinutesPerSession: number;
  /** The active penalty on this day, or null for a normal day. */
  penaltyType: PenaltyType | null;
  penaltyDisplayName: string | null;
  penaltyFromUserId: string | null;
}

function toDayState(value: string): DayState {
  switch (value) {
    case 'completed':
      return DayState.Completed;
    case 'missed':
      return DayState.Missed;
    case 'pending':
      return DayState.Pending;
    case 'future':
      return DayState.Future;
    default:
      return DayState.NotParticipating;
  }
}

function toPenaltyType(value: string | null): PenaltyType | null {
  if (value === PenaltyType.MinimumMinutes) return PenaltyType.MinimumMinutes;
  if (value === PenaltyType.DoubleSession) return PenaltyType.DoubleSession;
  return null;
}

type DayStateRpcRow =
  Database['public']['Functions']['challenge_day_states']['Returns'][number];

/**
 * PostgREST caps a single response at a fixed row count (`db-max-rows`,
 * 1000 on this project — see supabase/config.toml `[api] max_rows`).
 * `challenge_day_states` returns one row per participant × challenge day, so a
 * normal challenge blows past that: 21 participants × 120 days = 2520 rows. An
 * un-paginated call was silently truncated to the first 1000, and every
 * participant/date pair missing from the response was then rendered as
 * `not_participating` ("—") on Översikt/Gruppen.
 *
 * We page through the whole set with deterministic `Range` windows:
 *
 * - Ordering is applied by PostgREST at the outer query level (`ORDER BY
 *   user_id, challenge_date` wrapped around the function call). `(user_id,
 *   challenge_date)` is unique — one row per member per day — so the paging is
 *   stable and needs no change to the SQL function itself.
 * - `count: 'exact'` returns the full result-set size (`Content-Range` total),
 *   so we page until we have all of it rather than guessing from page length.
 * - The first page's length is taken as the effective server cap and reused as
 *   the step, so paging stays correct even if the cap is ever set below
 *   `DAY_STATES_PAGE_SIZE`.
 */
const DAY_STATES_PAGE_SIZE = 1000;
/** Runaway guard: 1000 participants over a ~370-day challenge still fits. */
const DAY_STATES_MAX_REQUESTS = 500;

interface DayStatesQuery {
  /** Server-side filter via the RPC's own `p_user_id` arg — one participant's rows. */
  userId?: string;
  /** Client-side filter pushed down as a WHERE on the RPC's returned rows — specific dates, every participant. */
  dates?: string[];
}

/**
 * Shared paginated fetch behind every `challenge_day_states` caller below.
 * Egress note (production incident, 2026-09): an *unfiltered* call returns
 * one row per participant × challenge day (e.g. 21 × 120 = 2520) — every
 * screen used to fetch this unconditionally. Only Översikt's full matrix
 * genuinely needs that; every other screen passes `userId` and/or `dates` so
 * PostgREST/Postgres do the filtering and far fewer bytes ever cross the
 * wire. See docs/DATABASE.md §4.
 */
async function fetchDayStatesPaged(
  challengeId: string,
  query: DayStatesQuery = {},
): Promise<DayStateRow[]> {
  const page = (from: number, to: number) => {
    const builder = supabase
      .rpc(
        'challenge_day_states',
        query.userId
          ? { p_challenge_id: challengeId, p_user_id: query.userId }
          : { p_challenge_id: challengeId },
        { count: 'exact' },
      )
      .order('user_id', { ascending: true })
      .order('challenge_date', { ascending: true })
      .range(from, to);
    return query.dates ? builder.in('challenge_date', query.dates) : builder;
  };

  const first = await page(0, DAY_STATES_PAGE_SIZE - 1);
  if (first.error) {
    throw new Error(first.error.message);
  }

  const rows: DayStateRpcRow[] = [...first.data];
  // Whatever the server returned for a full request IS the effective cap, so
  // paging stays correct even if it is ever set below DAY_STATES_PAGE_SIZE.
  const step = rows.length > 0 ? rows.length : DAY_STATES_PAGE_SIZE;
  // `count: 'exact'` gives the full result-set size. If the header is ever
  // absent, fall back to "keep going while the last page came back full" so we
  // never stop short.
  const total = first.count ?? Number.POSITIVE_INFINITY;

  for (let request = 1; ; request++) {
    const more = Number.isFinite(total)
      ? rows.length < total
      : rows.length > 0 && rows.length % step === 0;
    if (!more) break;

    if (request >= DAY_STATES_MAX_REQUESTS) {
      throw new Error(
        `fetchDayStates: challenge_day_states exceeded ${String(DAY_STATES_MAX_REQUESTS)} ` +
          `requests for challenge ${challengeId} (have ${String(rows.length)} of ${String(total)}).`,
      );
    }

    const from = request * step;
    const { data, error } = await page(from, from + step - 1);
    if (error) {
      throw new Error(error.message);
    }
    if (data.length === 0) break;
    rows.push(...data);
  }

  if (Number.isFinite(total) && rows.length !== total) {
    throw new Error(
      `fetchDayStates: got ${String(rows.length)} of ${String(total)} challenge_day_states ` +
        `rows for challenge ${challengeId} — response is incomplete.`,
    );
  }

  return rows.map(toDayStateRow);
}

/**
 * The canonical per-participant, per-day state for an entire challenge
 * (`challenge_day_states` RPC — docs/DATABASE.md §4). This is the
 * authoritative source for every status surface; the frontend never
 * recomputes qualification itself (CLAUDE.md §12, §17).
 *
 * The full, unfiltered matrix. Expensive (one row per participant × day) —
 * reserved for Översikt's complete grid (`useChallengeMatrix`). Every other
 * screen must use `fetchDayStatesForUser` or `fetchDayStatesOnDates` instead.
 */
export function fetchDayStates(challengeId: string): Promise<DayStateRow[]> {
  return fetchDayStatesPaged(challengeId);
}

/**
 * One participant's full day-state history — ~20x smaller than the full
 * matrix (confirmed in production: 89 rows / 34.6 KB vs. 1780 rows / 692 KB
 * for one real challenge). Used for the signed-in user's own data (Home,
 * Profil, Logga) — screens that only ever render the current user's own
 * calendar/streak never need any other participant's day states.
 */
export function fetchDayStatesForUser(
  challengeId: string,
  userId: string,
): Promise<DayStateRow[]> {
  return fetchDayStatesPaged(challengeId, { userId });
}

/**
 * Every participant's state on a specific set of dates — for the "today"
 * column and the recent-days grid (Hem, Gruppen), which only ever render a
 * handful of dates, never the whole challenge history.
 */
export function fetchDayStatesOnDates(
  challengeId: string,
  dates: string[],
): Promise<DayStateRow[]> {
  return fetchDayStatesPaged(challengeId, { dates });
}

function toDayStateRow(row: DayStateRpcRow): DayStateRow {
  return {
    userId: row.user_id,
    challengeDate: row.challenge_date,
    state: toDayState(row.state),
    sessionCount: row.session_count,
    validSessionCount: row.valid_session_count,
    totalValidMinutes: row.total_valid_minutes,
    requiredMinutes: row.required_minutes,
    requiredSessions: row.required_sessions,
    minMinutesPerSession: row.min_minutes_per_session,
    penaltyType: toPenaltyType(row.penalty_type),
    penaltyDisplayName: row.penalty_display_name,
    penaltyFromUserId: row.penalty_from_user_id,
  };
}

export interface ChallengeResultRow {
  userId: string;
  participationStartDate: string;
  participationEndDate: string | null;
  membershipActive: boolean;
  eligibleDays: number;
  completedDays: number;
  missedDays: number;
  pendingDays: number;
  futureDays: number;
  /** Fraction 0–1: completedDays / (completedDays + missedDays). */
  completionRate: number;
  currentStreak: number;
  longestStreak: number;
  totalValidMinutes: number;
  /** missedDays × missedDayCost — server-computed, authoritative debt. */
  liabilitySek: number;
  penaltiesEarned: number;
  penaltiesAssigned: number;
  penaltiesReceived: number;
}

/**
 * One pre-aggregated row per participant (`challenge_results` RPC —
 * docs/DATABASE.md §4): streak, completion rate and liability computed
 * server-side from the full day-state matrix without that matrix ever
 * crossing the network. This is the read model for anything that needs
 * every participant's *summary* stats (Hem, Gruppen, Ranking) — never derive
 * these figures client-side from raw day states (CLAUDE.md §17).
 */
export async function fetchChallengeResults(
  challengeId: string,
): Promise<ChallengeResultRow[]> {
  const { data, error } = await supabase.rpc('challenge_results', {
    p_challenge_id: challengeId,
  });
  if (error) throw new Error(error.message);
  return data.map((r) => ({
    userId: r.user_id,
    participationStartDate: r.participation_start_date,
    participationEndDate: r.participation_end_date,
    membershipActive: r.membership_active,
    eligibleDays: r.eligible_days,
    completedDays: r.completed_days,
    missedDays: r.missed_days,
    pendingDays: r.pending_days,
    futureDays: r.future_days,
    completionRate: r.completion_rate,
    currentStreak: r.current_streak,
    longestStreak: r.longest_streak,
    totalValidMinutes: r.total_valid_minutes,
    liabilitySek: r.liability_sek,
    penaltiesEarned: r.penalties_earned,
    penaltiesAssigned: r.penalties_assigned,
    penaltiesReceived: r.penalties_received,
  }));
}
