import { describe, expect, it } from 'vitest';
import { buildChallengeResultsCsv } from './challenge-results-csv';
import type { ChallengeResultRow } from './challenge-results-api';

function result(over: Partial<ChallengeResultRow>): ChallengeResultRow {
  return {
    userId: 'u1',
    participationStartDate: '2026-08-01',
    participationEndDate: null,
    membershipActive: true,
    eligibleDays: 120,
    completedDays: 100,
    missedDays: 20,
    pendingDays: 0,
    futureDays: 0,
    completionRate: 0.8333,
    currentStreak: 5,
    longestStreak: 40,
    totalValidMinutes: 3600,
    liabilitySek: 1000,
    penaltiesEarned: 2,
    penaltiesAssigned: 1,
    penaltiesReceived: 3,
    ...over,
  };
}

describe('buildChallengeResultsCsv', () => {
  const nameOf = (id: string) => (id === 'u1' ? 'Anna Berg' : 'Erik');

  it('emits a header row and a data row per participant, sorted by completion', () => {
    const csv = buildChallengeResultsCsv(
      { name: 'Hälsoutmaningen 2026' },
      [
        result({ userId: 'u2', completionRate: 0.5 }),
        result({ userId: 'u1', completionRate: 0.9 }),
      ],
      nameOf,
    );
    const lines = csv.split('\n');
    expect(lines[0]).toBe('# Hälsoutmaningen 2026');
    expect(lines[1]).toContain('deltagare;period_start');
    // higher completion first
    expect(lines[2]?.startsWith('Anna Berg;')).toBe(true);
    expect(lines[3]?.startsWith('Erik;')).toBe(true);
  });

  it('converts the completion rate to a whole percent and never leaks proof data', () => {
    const csv = buildChallengeResultsCsv({ name: 'X' }, [result({})], nameOf);
    expect(csv).toContain(';83;'); // 0.8333 -> 83
    expect(csv).not.toMatch(/storage|proof|signed|token|http/i);
  });

  it('quotes a name containing the delimiter', () => {
    const csv = buildChallengeResultsCsv(
      { name: 'X' },
      [result({ userId: 'weird' })],
      () => 'A; B',
    );
    expect(csv).toContain('"A; B"');
  });
});
