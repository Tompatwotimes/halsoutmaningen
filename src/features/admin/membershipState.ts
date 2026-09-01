/**
 * Human-readable membership status for the admin participant list.
 *
 * Eligibility for challenge evaluation is always the participation date window
 * intersected with the challenge range (docs/IMPLEMENTATION_PLAN.md §1.3). The
 * `active` flag never rewrites history — it only gates whether the person is
 * currently visible / able to log. This helper reflects exactly that split.
 */

import type { ChallengeConfig } from '@/domain/challenge';
import {
  effectiveEligibleEnd,
  effectiveEligibleStart,
  hasEligibleOverlap,
  type MembershipConfig,
} from '@/domain/membership';
import { compareDates } from '@/domain/dates';

export type MembershipDisplayState =
  'not_started' | 'active' | 'paused' | 'ended' | 'no_overlap';

export interface MembershipStateResult {
  state: MembershipDisplayState;
  label: string;
  /** Inclusive plain dates this participant is actually evaluated on. */
  effectiveStart: string;
  effectiveEnd: string;
}

const LABELS: Record<MembershipDisplayState, string> = {
  not_started: 'Börjar senare',
  active: 'Aktiv',
  paused: 'Pausad',
  ended: 'Avslutad',
  no_overlap: 'Utanför utmaningen',
};

export function membershipDisplayState(
  challenge: ChallengeConfig,
  membership: MembershipConfig,
  today: string,
): MembershipStateResult {
  const base = {
    effectiveStart: effectiveEligibleStart(challenge, membership),
    effectiveEnd: effectiveEligibleEnd(challenge, membership),
  };

  if (!hasEligibleOverlap(challenge, membership)) {
    return { state: 'no_overlap', label: LABELS.no_overlap, ...base };
  }

  let state: MembershipDisplayState;
  if (compareDates(today, base.effectiveEnd) > 0) {
    state = 'ended';
  } else if (compareDates(today, base.effectiveStart) < 0) {
    state = membership.active ? 'not_started' : 'paused';
  } else {
    state = membership.active ? 'active' : 'paused';
  }

  return { state, label: LABELS[state], ...base };
}
