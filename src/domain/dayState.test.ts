import { describe, expect, it } from 'vitest';
import { computeDayState, DayState, isQualifyingEntry } from './dayState';
import {
  firstChallenge,
  makeMembership,
  qualifyingEntry,
} from '@/test/fixtures';

const membership = makeMembership();

function stateOn(
  date: string,
  currentDate: string,
  entry: Parameters<typeof computeDayState>[0]['entry'] = null,
) {
  return computeDayState({
    challenge: firstChallenge,
    membership,
    date,
    currentDate,
    entry,
  });
}

describe('isQualifyingEntry', () => {
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

describe('computeDayState canonical ordering', () => {
  it('NOT_PARTICIPATING outside the membership window, even with an entry', () => {
    const late = makeMembership({ participationStartDate: '2026-08-20' });
    expect(
      computeDayState({
        challenge: firstChallenge,
        membership: late,
        date: '2026-08-10',
        currentDate: '2026-09-01',
        entry: qualifyingEntry(),
      }),
    ).toBe(DayState.NotParticipating);
  });

  it('COMPLETED when a qualifying entry exists (even for today)', () => {
    expect(stateOn('2026-09-01', '2026-09-01', qualifyingEntry())).toBe(
      DayState.Completed,
    );
  });

  it('FUTURE for a date after today with no entry', () => {
    expect(stateOn('2026-09-05', '2026-09-01')).toBe(DayState.Future);
  });

  it('PENDING for today with no qualifying entry', () => {
    expect(stateOn('2026-09-01', '2026-09-01')).toBe(DayState.Pending);
    expect(
      stateOn(
        '2026-09-01',
        '2026-09-01',
        qualifyingEntry({ durationMinutes: 10 }),
      ),
    ).toBe(DayState.Pending);
  });

  it('MISSED for a past eligible day with no qualifying entry', () => {
    expect(stateOn('2026-08-15', '2026-09-01')).toBe(DayState.Missed);
    expect(
      stateOn('2026-08-15', '2026-09-01', qualifyingEntry({ hasProof: false })),
    ).toBe(DayState.Missed);
  });

  it('never treats a future date as missed', () => {
    expect(stateOn('2026-11-28', '2026-08-01')).toBe(DayState.Future);
  });
});
