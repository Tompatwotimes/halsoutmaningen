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

/**
 * The canonical per-participant, per-day state for an entire challenge
 * (`challenge_day_states` RPC — docs/DATABASE.md §4). This is the
 * authoritative source for every status surface; the frontend never
 * recomputes qualification itself (CLAUDE.md §12, §17).
 *
 * Fetched in deterministic pages (no per-cell or per-participant requests) so
 * it is correct for any realistic participant count and challenge length.
 */
export async function fetchDayStates(
  challengeId: string,
): Promise<DayStateRow[]> {
  const page = (from: number, to: number) =>
    supabase
      .rpc(
        'challenge_day_states',
        { p_challenge_id: challengeId },
        { count: 'exact' },
      )
      .order('user_id', { ascending: true })
      .order('challenge_date', { ascending: true })
      .range(from, to);

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
