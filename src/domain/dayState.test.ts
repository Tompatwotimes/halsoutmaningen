import { describe, expect, it } from 'vitest';
import {
  computeDayState,
  DayState,
  evaluateDayState,
  isQualifyingDay,
  isQualifyingEntry,
} from './dayState';
import { PenaltyType, type ActivePenalty } from './penalties';
import {
  firstChallenge,
  makeMembership,
  qualifyingEntry,
} from '@/test/fixtures';

const membership = makeMembership();

function stateOn(
  date: string,
  currentDate: string,
  sessions: Parameters<typeof computeDayState>[0]['sessions'] = [],
  penalty: ActivePenalty | null = null,
) {
  return computeDayState({
    challenge: firstChallenge,
    membership,
    date,
    currentDate,
    sessions,
    penalty,
  });
}

describe('isQualifyingEntry (single session, base rule)', () => {
  it('requires the configured minimum duration', () => {
    expect(
      isQualifyingEntry(
        firstChallenge,
        qualifyingEntry({ durationMinutes: 29 }),
      ),
    ).toBe(false);
    expect(
      isQualifyingEntry(
        firstChallenge,
        qualifyingEntry({ durationMinutes: 30 }),
      ),
    ).toBe(true);
  });

  it('requires proof when the challenge requires proof', () => {
    expect(
      isQualifyingEntry(firstChallenge, qualifyingEntry({ hasProof: false })),
    ).toBe(false);
  });

  it('ignores proof when the challenge does not require it', () => {
    const noProof = { ...firstChallenge, proofRequired: false };
    expect(
      isQualifyingEntry(noProof, qualifyingEntry({ hasProof: false })),
    ).toBe(true);
  });

  it('does not count an invalidated entry', () => {
    expect(
      isQualifyingEntry(firstChallenge, qualifyingEntry({ invalidated: true })),
    ).toBe(false);
  });
});

describe('isQualifyingDay (multiple sessions sum toward the base)', () => {
  it('two short valid sessions can add up to the base minimum', () => {
    expect(
      isQualifyingDay(firstChallenge, [
        qualifyingEntry({ durationMinutes: 20 }),
        qualifyingEntry({ durationMinutes: 15 }),
      ]),
    ).toBe(true);
  });

  it('a single short session is still not enough', () => {
    expect(
      isQualifyingDay(firstChallenge, [
        qualifyingEntry({ durationMinutes: 20 }),
      ]),
    ).toBe(false);
  });

  it('an unproven session does not contribute when proof is required', () => {
    expect(
      isQualifyingDay(firstChallenge, [
        qualifyingEntry({ durationMinutes: 20 }),
        qualifyingEntry({ durationMinutes: 20, hasProof: false }),
      ]),
    ).toBe(false);
  });
});

describe('computeDayState canonical ordering', () => {
  it('NOT_PARTICIPATING outside the membership window, even with an entry', () => {
    const late = makeMembership({ participationStartDate: '2026-08-20' });
    expect(
      computeDayState({
        challenge: firstChallenge,
        membership: late,
        date: '2026-08-10',
        currentDate: '2026-09-01',
        sessions: [qualifyingEntry()],
      }),
    ).toBe(DayState.NotParticipating);
  });

  it('COMPLETED when a qualifying entry exists (even for today)', () => {
    expect(stateOn('2026-09-01', '2026-09-01', [qualifyingEntry()])).toBe(
      DayState.Completed,
    );
  });

  it('FUTURE for a date after today with no entry', () => {
    expect(stateOn('2026-09-05', '2026-09-01')).toBe(DayState.Future);
  });

  it('PENDING for today with no qualifying entry', () => {
    expect(stateOn('2026-09-01', '2026-09-01')).toBe(DayState.Pending);
    expect(
      stateOn('2026-09-01', '2026-09-01', [
        qualifyingEntry({ durationMinutes: 10 }),
      ]),
    ).toBe(DayState.Pending);
  });

  it('MISSED for a past eligible day with no qualifying entry', () => {
    expect(stateOn('2026-08-15', '2026-09-01')).toBe(DayState.Missed);
    expect(
      stateOn('2026-08-15', '2026-09-01', [
        qualifyingEntry({ hasProof: false }),
      ]),
    ).toBe(DayState.Missed);
  });

  it('never treats a future date as missed', () => {
    expect(stateOn('2026-11-28', '2026-08-01')).toBe(DayState.Future);
  });
});

describe('computeDayState with an active penalty', () => {
  const min60: ActivePenalty = {
    type: PenaltyType.MinimumMinutes,
    value: 60,
    displayName: '60-minutaren',
  };
  const double: ActivePenalty = {
    type: PenaltyType.DoubleSession,
    value: 2,
    displayName: 'Dubbelpass',
  };

  it('a normally-sufficient 35 min day is MISSED under the 60-minute penalty', () => {
    expect(
      stateOn(
        '2026-08-15',
        '2026-09-01',
        [qualifyingEntry({ durationMinutes: 35 })],
        min60,
      ),
    ).toBe(DayState.Missed);
  });

  it('60 valid minutes satisfies the 60-minute penalty', () => {
    expect(
      stateOn(
        '2026-08-15',
        '2026-09-01',
        [qualifyingEntry({ durationMinutes: 60 })],
        min60,
      ),
    ).toBe(DayState.Completed);
  });

  it('two sessions summing to 60 satisfy the 60-minute penalty', () => {
    expect(
      stateOn(
        '2026-08-15',
        '2026-09-01',
        [
          qualifyingEntry({ durationMinutes: 30 }),
          qualifyingEntry({ durationMinutes: 30 }),
        ],
        min60,
      ),
    ).toBe(DayState.Completed);
  });

  it('one 60-minute session does NOT satisfy Dubbelpass', () => {
    expect(
      stateOn(
        '2026-08-15',
        '2026-09-01',
        [qualifyingEntry({ durationMinutes: 60 })],
        double,
      ),
    ).toBe(DayState.Missed);
  });

  it('two base-length sessions each with proof satisfy Dubbelpass', () => {
    const result = evaluateDayState({
      challenge: firstChallenge,
      membership,
      date: '2026-08-15',
      currentDate: '2026-09-01',
      sessions: [
        qualifyingEntry({ durationMinutes: 30 }),
        qualifyingEntry({ durationMinutes: 32 }),
      ],
      penalty: double,
    });
    expect(result.state).toBe(DayState.Completed);
    expect(result.requirement.requiredSessions).toBe(2);
    expect(result.contributingSessions).toBe(2);
  });

  it('Dubbelpass with one un-proven session is MISSED', () => {
    expect(
      stateOn(
        '2026-08-15',
        '2026-09-01',
        [
          qualifyingEntry({ durationMinutes: 40 }),
          qualifyingEntry({ durationMinutes: 40, hasProof: false }),
        ],
        double,
      ),
    ).toBe(DayState.Missed);
  });
});
