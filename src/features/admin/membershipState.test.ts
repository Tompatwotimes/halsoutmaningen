import { describe, expect, it } from 'vitest';
import { ChallengeStatus, type ChallengeConfig } from '@/domain/challenge';
import { membershipDisplayState } from './membershipState';

const challenge: ChallengeConfig = {
  id: 'c1',
  name: 'Testutmaning',
  startDate: '2026-08-01',
  endDate: '2026-11-28',
  timeZone: 'Europe/Stockholm',
  requiredMinutes: 30,
  proofRequired: true,
  missedDayCost: 50,
  status: ChallengeStatus.Active,
};

function membership(
  overrides: Partial<Parameters<typeof membershipDisplayState>[1]> = {},
) {
  return {
    userId: 'u1',
    participationStartDate: '2026-08-01',
    participationEndDate: null as string | null,
    active: true,
    ...overrides,
  };
}

describe('membershipDisplayState', () => {
  it('is active for an open membership during the challenge', () => {
    const result = membershipDisplayState(
      challenge,
      membership(),
      '2026-09-01',
    );
    expect(result.state).toBe('active');
    expect(result.effectiveStart).toBe('2026-08-01');
    expect(result.effectiveEnd).toBe('2026-11-28');
  });

  it('clamps the effective window to the challenge range', () => {
    const result = membershipDisplayState(
      challenge,
      membership({
        participationStartDate: '2026-07-01',
        participationEndDate: '2027-01-01',
      }),
      '2026-09-01',
    );
    expect(result.effectiveStart).toBe('2026-08-01');
    expect(result.effectiveEnd).toBe('2026-11-28');
  });

  it('is not_started before the participation window opens', () => {
    const result = membershipDisplayState(
      challenge,
      membership({ participationStartDate: '2026-09-15' }),
      '2026-09-01',
    );
    expect(result.state).toBe('not_started');
  });

  it('treats the inclusive end date as still eligible, then ended the next day', () => {
    const m = membership({ participationEndDate: '2026-09-15' });
    expect(membershipDisplayState(challenge, m, '2026-09-15').state).toBe(
      'active',
    );
    expect(membershipDisplayState(challenge, m, '2026-09-16').state).toBe(
      'ended',
    );
  });

  it('reports paused for an inactive membership without rewriting the window', () => {
    const result = membershipDisplayState(
      challenge,
      membership({ active: false }),
      '2026-09-01',
    );
    expect(result.state).toBe('paused');
    // active=false must not shrink the evaluated window.
    expect(result.effectiveEnd).toBe('2026-11-28');
  });

  it('flags a membership whose window never intersects the challenge', () => {
    const result = membershipDisplayState(
      challenge,
      membership({
        participationStartDate: '2027-01-01',
        participationEndDate: '2027-02-01',
      }),
      '2026-09-01',
    );
    expect(result.state).toBe('no_overlap');
  });
});
