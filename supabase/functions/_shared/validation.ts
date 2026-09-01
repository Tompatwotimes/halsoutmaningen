import { z } from 'npm:zod@3.24.1';

const PLAIN_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Server-side re-validation of the invite payload. Mirrors
 * `src/features/admin/invite-schema.ts` — the browser is never trusted
 * (CLAUDE.md §17). If you change one, change both.
 */
export const inviteInputSchema = z
  .object({
    action: z.literal('invite').optional(),
    email: z.string().trim().toLowerCase().email(),
    displayName: z.string().trim().min(1).max(80),
    challengeId: z.string().uuid(),
    participationStartDate: z.string().regex(PLAIN_DATE),
    participationEndDate: z.string().regex(PLAIN_DATE).nullable().optional(),
  })
  .refine(
    (v) =>
      v.participationEndDate === null ||
      v.participationEndDate === undefined ||
      v.participationEndDate >= v.participationStartDate,
    { message: 'participationEndDate is before participationStartDate' },
  );

export type InviteInput = z.infer<typeof inviteInputSchema>;

export const accountStatusInputSchema = z.object({
  action: z.literal('account-status'),
  challengeId: z.string().uuid(),
});

export function firstIssueMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Ogiltig indata';
}
