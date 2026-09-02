import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

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
  completionRate: number;
  currentStreak: number;
  longestStreak: number;
  totalValidMinutes: number;
  liabilitySek: number;
  penaltiesEarned: number;
  penaltiesAssigned: number;
  penaltiesReceived: number;
}

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

export function useChallengeResults(challengeId: string | null) {
  return useQuery({
    queryKey: ['admin', 'challenge-results', challengeId],
    queryFn: () => {
      if (challengeId === null) throw new Error('challengeId krävs.');
      return fetchChallengeResults(challengeId);
    },
    enabled: challengeId !== null,
    staleTime: 30_000,
  });
}
