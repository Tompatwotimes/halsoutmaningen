import { z } from 'zod';

const PLAIN_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validation for the "invite participant" admin form. The Edge Function
 * re-validates the same shape independently — the browser is untrusted
 * (CLAUDE.md §17). Keep the two in sync.
 */
export const inviteParticipantSchema = z
  .object({
    email: z.string().trim().toLowerCase().email('Ange en giltig e-postadress'),
    displayName: z
      .string()
      .trim()
      .min(1, 'Ange ett visningsnamn')
      .max(80, 'Högst 80 tecken'),
    challengeId: z.string().uuid('Välj en utmaning'),
    participationStartDate: z.string().regex(PLAIN_DATE, 'Ogiltigt startdatum'),
    participationEndDate: z
      .string()
      .regex(PLAIN_DATE, 'Ogiltigt slutdatum')
      .nullable()
      .default(null),
  })
  .refine(
    (v) =>
      v.participationEndDate === null ||
      v.participationEndDate >= v.participationStartDate,
    {
      message: 'Slutdatum kan inte vara före startdatum',
      path: ['participationEndDate'],
    },
  );

export type InviteParticipantInput = z.infer<typeof inviteParticipantSchema>;

export interface InviteFormValues {
  email: string;
  displayName: string;
  challengeId: string;
  participationStartDate: string;
  participationEndDate: string;
}

export type InviteFieldErrors = Partial<Record<keyof InviteFormValues, string>>;

export interface InviteParseResult {
  data: InviteParticipantInput | null;
  errors: InviteFieldErrors;
}

/** Parse raw form strings; an empty end date becomes `null`. */
export function parseInviteForm(values: InviteFormValues): InviteParseResult {
  const candidate = {
    ...values,
    participationEndDate:
      values.participationEndDate.trim() === ''
        ? null
        : values.participationEndDate.trim(),
  };

  const parsed = inviteParticipantSchema.safeParse(candidate);
  if (parsed.success) {
    return { data: parsed.data, errors: {} };
  }

  const errors: InviteFieldErrors = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path[0];
    if (typeof key === 'string' && !(key in errors)) {
      errors[key as keyof InviteFormValues] = issue.message;
    }
  }
  return { data: null, errors };
}
