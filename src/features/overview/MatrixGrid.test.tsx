import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRef } from 'react';
import { ChallengeStatus, type ChallengeConfig } from '@/domain/challenge';
import { evaluateParticipant, summarizeLiability } from '@/domain/liability';
import { currentStreak, longestStreak } from '@/domain/streaks';
import { computeDailyRequirement } from '@/domain/penalties';
import { membershipDisplayState } from '@/features/admin/membershipState';
import type { ParticipantView } from '@/features/challenge/types';
import { MatrixGrid, type MatrixGridHandle } from './MatrixGrid';

/**
 * The shared Översikt matrix must span the FULL challenge period
 * (start_date → end_date), even when every membership begins later — those
 * leading days render as "Deltog inte", never hidden (CLAUDE.md §5.4).
 */

const SEP_CHALLENGE: ChallengeConfig = {
  id: 'c1',
  name: 'Hälsoutmaningen 2026',
  description: null,
  startDate: '2026-09-01',
  endDate: '2026-11-28',
  timeZone: 'Europe/Stockholm',
  requiredMinutes: 30,
  proofRequired: true,
  missedDayCost: 50,
  status: ChallengeStatus.Active,
};

// 2026-09-01 .. 2026-11-28 inclusive.
const TOTAL_DAYS = 89;

function makeParticipant(
  challenge: ChallengeConfig,
  today: string,
  opts: { userId: string; displayName: string; participationStartDate: string },
): ParticipantView {
  const membership = {
    userId: opts.userId,
    participationStartDate: opts.participationStartDate,
    participationEndDate: null,
    active: true,
  };
  const evaluation = evaluateParticipant({
    challenge,
    membership,
    currentDate: today,
    sessionsByDate: new Map(),
  });
  const statesByDate = new Map(
    evaluation.days.map((d) => [d.date, d.state] as const),
  );
  const req = computeDailyRequirement(challenge, null);
  return {
    userId: opts.userId,
    displayName: opts.displayName,
    role: 'participant',
    isSelf: false,
    profileActive: true,
    membership,
    membershipDisplay: membershipDisplayState(challenge, membership, today),
    days: evaluation.days,
    statesByDate,
    requirementByDate: new Map(
      evaluation.days.map((d) => [
        d.date,
        {
          requiredMinutes: req.requiredTotalMinutes,
          requiredSessions: req.requiredSessions,
          minMinutesPerSession: req.minMinutesPerSession,
          penaltyType: null,
          penaltyDisplayName: null,
          penaltyFromUserId: null,
          sessionCount: 0,
          validSessionCount: 0,
          totalValidMinutes: 0,
        },
      ]),
    ),
    todayState: null,
    todayRequirement: null,
    activeToday: false,
    currentStreak: currentStreak(evaluation.states),
    longestStreak: longestStreak(evaluation.states),
    liability: summarizeLiability(evaluation.states, challenge.missedDayCost),
    completionRate: 0,
    decidedDays: 0,
  };
}

describe('MatrixGrid — full challenge period', () => {
  let scrollToSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    scrollToSpy = vi.fn();
    // jsdom has no layout; give the scroller a width and a working scrollTo.
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      value: 320,
    });
    HTMLElement.prototype.scrollTo = scrollToSpy;
  });

  const roster = () => [
    makeParticipant(SEP_CHALLENGE, '2026-09-15', {
      userId: 'u-anna',
      displayName: 'Anna Andersson',
      participationStartDate: '2026-09-03',
    }),
    makeParticipant(SEP_CHALLENGE, '2026-09-15', {
      userId: 'u-erik',
      displayName: 'Erik Eriksson',
      participationStartDate: '2026-09-03',
    }),
  ];

  it('renders every column from start_date to end_date', () => {
    render(
      <MatrixGrid
        challenge={SEP_CHALLENGE}
        today="2026-09-15"
        participants={roster()}
        onOpenEntry={vi.fn()}
      />,
    );
    // One status cell per challenge day, per participant.
    expect(screen.getAllByLabelText(/^Anna Andersson,/)).toHaveLength(
      TOTAL_DAYS,
    );
  });

  it('shows Sep 1 and Sep 2 as "Deltog inte" when all memberships start Sep 3', () => {
    render(
      <MatrixGrid
        challenge={SEP_CHALLENGE}
        today="2026-09-15"
        participants={roster()}
        onOpenEntry={vi.fn()}
      />,
    );
    // 2026-09-01 is a Tuesday, 2026-09-02 a Wednesday.
    expect(
      screen.getByLabelText('Anna Andersson, Tis 1: Deltog inte'),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText('Anna Andersson, Ons 2: Deltog inte'),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText('Erik Eriksson, Tis 1: Deltog inte'),
    ).toBeInTheDocument();
  });

  it('keeps the final challenge day (Nov 28) reachable', () => {
    render(
      <MatrixGrid
        challenge={SEP_CHALLENGE}
        today="2026-09-15"
        participants={roster()}
        onOpenEntry={vi.fn()}
      />,
    );
    // 2026-11-28 is a Saturday → "Kommande dag" (future).
    expect(
      screen.getByLabelText('Anna Andersson, Lör 28: Kommande dag'),
    ).toBeInTheDocument();
  });

  it('scrolls to today when today is inside the challenge', () => {
    const ref = createRef<MatrixGridHandle>();
    render(
      <MatrixGrid
        challenge={SEP_CHALLENGE}
        today="2026-09-15"
        participants={roster()}
        onOpenEntry={vi.fn()}
        handleRef={ref}
      />,
    );
    ref.current?.scrollToToday();
    // Day index 14 (Sep 15), 22px cells, 320px viewport → 14*22 - 160 + 22.
    expect(scrollToSpy).toHaveBeenCalledWith(
      expect.objectContaining({ left: 14 * 22 - 138 }),
    );
  });

  it('rests near the start when today is before the challenge', () => {
    const ref = createRef<MatrixGridHandle>();
    render(
      <MatrixGrid
        challenge={SEP_CHALLENGE}
        today="2026-08-01"
        participants={[
          makeParticipant(SEP_CHALLENGE, '2026-08-01', {
            userId: 'u-anna',
            displayName: 'Anna Andersson',
            participationStartDate: '2026-09-03',
          }),
        ]}
        onOpenEntry={vi.fn()}
        handleRef={ref}
      />,
    );
    ref.current?.scrollToToday();
    // focusIndex 0 → 0*22 - 160 + 22.
    expect(scrollToSpy).toHaveBeenCalledWith(
      expect.objectContaining({ left: 22 - 160 }),
    );
  });

  it('rests near the end when the challenge is already over', () => {
    const ref = createRef<MatrixGridHandle>();
    render(
      <MatrixGrid
        challenge={SEP_CHALLENGE}
        today="2027-01-01"
        participants={[
          makeParticipant(SEP_CHALLENGE, '2027-01-01', {
            userId: 'u-anna',
            displayName: 'Anna Andersson',
            participationStartDate: '2026-09-03',
          }),
        ]}
        onOpenEntry={vi.fn()}
        handleRef={ref}
      />,
    );
    ref.current?.scrollToToday();
    // focusIndex = last column (88) → 88*22 - 160 + 22.
    expect(scrollToSpy).toHaveBeenCalledWith(
      expect.objectContaining({ left: 88 * 22 - 138 }),
    );
  });
});
