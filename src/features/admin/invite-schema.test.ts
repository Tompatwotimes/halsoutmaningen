import { describe, expect, it } from 'vitest';
import { parseInviteForm, type InviteFormValues } from './invite-schema';

const CHALLENGE_ID = '11111111-1111-4111-8111-111111111111';

function form(overrides: Partial<InviteFormValues> = {}): InviteFormValues {
  return {
    email: 'ny.deltagare@example.com',
    displayName: 'Ny Deltagare',
    challengeId: CHALLENGE_ID,
    participationStartDate: '2026-08-01',
    participationEndDate: '',
    ...overrides,
  };
}

describe('parseInviteForm', () => {
  it('accepts a valid invite and normalises the email', () => {
    const { data, errors } = parseInviteForm(
      form({ email: '  NY.Deltagare@Example.com ' }),
    );
    expect(errors).toEqual({});
    expect(data).not.toBeNull();
    expect(data?.email).toBe('ny.deltagare@example.com');
  });

  it('turns an empty end date into null (participation runs to challenge end)', () => {
    const { data } = parseInviteForm(form({ participationEndDate: '' }));
    expect(data?.participationEndDate).toBeNull();
  });

  it('keeps a provided inclusive end date', () => {
    const { data } = parseInviteForm(
      form({ participationEndDate: '2026-09-15' }),
    );
    expect(data?.participationEndDate).toBe('2026-09-15');
  });

  it('rejects an invalid email', () => {
    const { data, errors } = parseInviteForm(form({ email: 'not-an-email' }));
    expect(data).toBeNull();
    expect(errors.email).toBeDefined();
  });

  it('rejects a missing display name', () => {
    const { errors } = parseInviteForm(form({ displayName: '   ' }));
    expect(errors.displayName).toBeDefined();
  });

  it('rejects a display name longer than 80 characters', () => {
    const { errors } = parseInviteForm(form({ displayName: 'x'.repeat(81) }));
    expect(errors.displayName).toBeDefined();
  });

  it('rejects a non-uuid challenge id', () => {
    const { errors } = parseInviteForm(form({ challengeId: 'challenge-1' }));
    expect(errors.challengeId).toBeDefined();
  });

  it('rejects an end date before the start date', () => {
    const { data, errors } = parseInviteForm(
      form({
        participationStartDate: '2026-08-20',
        participationEndDate: '2026-08-10',
      }),
    );
    expect(data).toBeNull();
    expect(errors.participationEndDate).toBeDefined();
  });

  it('rejects a malformed date', () => {
    const { errors } = parseInviteForm(
      form({ participationStartDate: '2026-8-1' }),
    );
    expect(errors.participationStartDate).toBeDefined();
  });
});
