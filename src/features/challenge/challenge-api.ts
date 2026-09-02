import { supabase } from '@/lib/supabase';
import { ChallengeStatus, type ChallengeConfig } from '@/domain/challenge';
import { DayState } from '@/domain/dayState';
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
      'id, name, start_date, end_date, timezone, required_minutes, proof_required, missed_day_cost, status',
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
  entryId: string | null;
  durationMinutes: number | null;
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

/**
 * The canonical per-participant, per-day state for an entire challenge in one
 * round trip (`challenge_day_states` RPC — docs/DATABASE.md §4). This is the
 * authoritative source for every status surface; the frontend never
 * recomputes qualification itself (CLAUDE.md §12, §17).
 */
export async function fetchDayStates(
  challengeId: string,
): Promise<DayStateRow[]> {
  const { data, error } = await supabase.rpc('challenge_day_states', {
    p_challenge_id: challengeId,
  });

  if (error) {
    throw new Error(error.message);
  }

  return data.map((row) => ({
    userId: row.user_id,
    challengeDate: row.challenge_date,
    state: toDayState(row.state),
    entryId: row.entry_id,
    durationMinutes: row.duration_minutes,
  }));
}
