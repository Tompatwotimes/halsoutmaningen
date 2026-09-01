import { describe, expect, it } from 'vitest';
import { DayState } from '@/domain/dayState';
import { buildChallengeDataset } from './dataset';
import { FIXTURE_TODAY } from './challenge';

describe('buildChallengeDataset', () => {
  const data = buildChallengeDataset();

  it('has a self participant and orders participants by name', () => {
    expect(data.self.isSelf).toBe(true);
    const names = data.participants.map((p) => p.displayName);
    expect([...names].sort((a, b) => a.localeCompare(b, 'sv'))).toEqual(names);
  });

  it('excludes paused memberships from today’s roster but keeps them overall', () => {
    const david = data.participants.find((p) =>
      p.displayName.startsWith('David'),
    );
    expect(david?.membership.active).toBe(false);
    expect(data.rosterToday).not.toContain(david);
    expect(data.participants).toContain(david);
  });

  it('evaluates a late joiner only from their participation start', () => {
    const erik = data.participants.find((p) =>
      p.displayName.startsWith('Erik'),
    );
    // Pre-membership days are not eligible days at all — consumers render
    // them as "not participating" via the `?? NotParticipating` fallback.
    expect(erik?.statesByDate.has('2026-08-05')).toBe(false);
    expect(erik?.days[0]?.date).toBe('2026-08-20');
    expect(erik?.statesByDate.get('2026-08-25')).toBeDefined();
    expect(erik?.liability.completedDays).toBeGreaterThan(0);
  });

  it('derives liability consistently with completed/missed day counts', () => {
    for (const p of data.participants) {
      expect(p.liability.confirmedDebt).toBe(
        p.liability.missedDays * data.challenge.missedDayCost,
      );
      expect(p.decidedDays).toBe(
        p.liability.completedDays + p.liability.missedDays,
      );
    }
  });

  it('never marks a future day as missed', () => {
    for (const p of data.participants) {
      for (const { date, state } of p.days) {
        if (date > FIXTURE_TODAY) {
          expect(
            state === DayState.Future || state === DayState.NotParticipating,
          ).toBe(true);
        }
      }
    }
  });
});
