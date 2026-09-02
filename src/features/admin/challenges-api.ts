import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { ChallengeStatus, type ChallengeConfig } from '@/domain/challenge';

const CHALLENGE_COLUMNS =
  'id, name, description, start_date, end_date, timezone, required_minutes, proof_required, missed_day_cost, status';

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

/** All challenges visible to the caller. Admins see every row (RLS). */
export async function fetchChallenges(): Promise<ChallengeConfig[]> {
  const { data, error } = await supabase
    .from('challenges')
    .select(CHALLENGE_COLUMNS)
    .order('start_date', { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return data.map((row) => ({
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
  }));
}

export function useChallenges() {
  return useQuery({
    queryKey: ['admin', 'challenges'],
    queryFn: fetchChallenges,
    staleTime: 60_000,
  });
}
