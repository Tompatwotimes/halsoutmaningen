import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { AuditRow } from './audit-humanize';

export interface AuditFilters {
  challengeId?: string | null;
  /** actor OR target */
  userId?: string | null;
  category?: 'all' | 'challenge' | 'membership' | 'training' | 'penalty';
  fromDate?: string | null;
}

const CATEGORY_ENTITY: Record<string, string[]> = {
  challenge: ['challenge'],
  membership: ['challenge_membership'],
  training: ['training_entry', 'training_proof'],
  penalty: [
    'challenge_penalty_definition',
    'earned_penalty',
    'penalty_assignment',
  ],
};

function toRow(r: {
  id: string;
  actor_user_id: string | null;
  challenge_id: string | null;
  target_user_id: string | null;
  entity_type: string;
  entity_id: string | null;
  action: string;
  before_data: unknown;
  after_data: unknown;
  note: string | null;
  created_at: string;
}): AuditRow {
  return {
    id: r.id,
    actorUserId: r.actor_user_id,
    challengeId: r.challenge_id,
    targetUserId: r.target_user_id,
    entityType: r.entity_type,
    entityId: r.entity_id,
    action: r.action,
    beforeData:
      r.before_data && typeof r.before_data === 'object'
        ? (r.before_data as Record<string, unknown>)
        : null,
    afterData:
      r.after_data && typeof r.after_data === 'object'
        ? (r.after_data as Record<string, unknown>)
        : null,
    note: r.note,
    createdAt: r.created_at,
  };
}

export async function fetchAuditLog(
  filters: AuditFilters,
  limit = 200,
): Promise<AuditRow[]> {
  let query = supabase
    .from('audit_log')
    .select(
      'id, actor_user_id, challenge_id, target_user_id, entity_type, entity_id, action, before_data, after_data, note, created_at',
    )
    .order('created_at', { ascending: false })
    .limit(limit);

  if (filters.challengeId) {
    query = query.eq('challenge_id', filters.challengeId);
  }
  if (filters.fromDate) {
    query = query.gte('created_at', `${filters.fromDate}T00:00:00Z`);
  }
  if (filters.category && filters.category !== 'all') {
    query = query.in('entity_type', CATEGORY_ENTITY[filters.category] ?? []);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  let rows = data.map(toRow);
  if (filters.userId) {
    rows = rows.filter(
      (r) =>
        r.actorUserId === filters.userId || r.targetUserId === filters.userId,
    );
  }
  return rows;
}

export function useAuditLog(filters: AuditFilters) {
  return useQuery({
    queryKey: ['admin', 'audit', filters],
    queryFn: () => fetchAuditLog(filters),
    staleTime: 10_000,
  });
}
