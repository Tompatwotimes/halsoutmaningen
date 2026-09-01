import { useState, type SyntheticEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ChallengeConfig } from '@/domain/challenge';
import { maxDate } from '@/domain/dates';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import {
  parseInviteForm,
  type InviteFieldErrors,
  type InviteFormValues,
} from './invite-schema';
import {
  inviteParticipant,
  type InviteParticipantResult,
} from './inviteParticipant';
import styles from './InviteParticipantForm.module.css';

interface Props {
  challenge: ChallengeConfig;
  /** Challenge-local today, for a sensible default start date. */
  today: string;
}

function emptyValues(
  challenge: Props['challenge'],
  today: string,
): InviteFormValues {
  return {
    email: '',
    displayName: '',
    challengeId: challenge.id,
    // Default to "starts today" but never before the challenge opens.
    participationStartDate: maxDate(challenge.startDate, today),
    participationEndDate: '',
  };
}

const SUCCESS_TEXT: Record<InviteParticipantResult['status'], string> = {
  invited: 'Inbjudan skickad. Deltagaren får ett e-postmeddelande.',
  linked: 'Kontot fanns redan och är nu kopplat till utmaningen.',
  membership_updated: 'Deltagarens period uppdaterades.',
  already_member: 'Personen är redan deltagare i utmaningen.',
};

export function InviteParticipantForm({ challenge, today }: Props) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState<InviteFormValues>(() =>
    emptyValues(challenge, today),
  );
  const [fieldErrors, setFieldErrors] = useState<InviteFieldErrors>({});
  const [success, setSuccess] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: inviteParticipant,
    onSuccess: (result) => {
      setSuccess(SUCCESS_TEXT[result.status]);
      setValues(emptyValues(challenge, today));
      setFieldErrors({});
      void queryClient.invalidateQueries({
        queryKey: ['admin', 'participants', challenge.id],
      });
      void queryClient.invalidateQueries({
        queryKey: ['admin', 'account-status', challenge.id],
      });
    },
  });

  function update<K extends keyof InviteFormValues>(
    key: K,
    value: InviteFormValues[K],
  ) {
    setValues((prev) => ({ ...prev, [key]: value }));
    setSuccess(null);
  }

  function handleSubmit(event: SyntheticEvent) {
    event.preventDefault();
    setSuccess(null);

    const { data, errors } = parseInviteForm(values);
    setFieldErrors(errors);
    if (!data) {
      return;
    }
    mutation.mutate(data);
  }

  const submitError = mutation.isError
    ? mutation.error instanceof Error
      ? mutation.error.message
      : 'Inbjudan misslyckades.'
    : null;

  return (
    <Card title="Bjud in deltagare">
      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        <div className={styles.field}>
          <label htmlFor="invite-email">E-post</label>
          <input
            id="invite-email"
            type="email"
            inputMode="email"
            autoComplete="off"
            value={values.email}
            onChange={(e) => update('email', e.target.value)}
            required
          />
          {fieldErrors.email && (
            <p className={styles.error}>{fieldErrors.email}</p>
          )}
        </div>

        <div className={styles.field}>
          <label htmlFor="invite-name">Visningsnamn</label>
          <input
            id="invite-name"
            type="text"
            autoComplete="off"
            value={values.displayName}
            onChange={(e) => update('displayName', e.target.value)}
            required
          />
          {fieldErrors.displayName && (
            <p className={styles.error}>{fieldErrors.displayName}</p>
          )}
        </div>

        <div className={styles.row}>
          <div className={styles.field}>
            <label htmlFor="invite-start">Deltar från</label>
            <input
              id="invite-start"
              type="date"
              min={challenge.startDate}
              max={challenge.endDate}
              value={values.participationStartDate}
              onChange={(e) => update('participationStartDate', e.target.value)}
              required
            />
            {fieldErrors.participationStartDate && (
              <p className={styles.error}>
                {fieldErrors.participationStartDate}
              </p>
            )}
          </div>

          <div className={styles.field}>
            <label htmlFor="invite-end">Deltar till (valfritt)</label>
            <input
              id="invite-end"
              type="date"
              min={values.participationStartDate}
              max={challenge.endDate}
              value={values.participationEndDate}
              onChange={(e) => update('participationEndDate', e.target.value)}
            />
            {fieldErrors.participationEndDate && (
              <p className={styles.error}>{fieldErrors.participationEndDate}</p>
            )}
          </div>
        </div>

        {submitError && (
          <p className={styles.error} role="alert">
            {submitError}
          </p>
        )}
        {success && (
          <p className={styles.success} role="status">
            {success}
          </p>
        )}

        <Button type="submit" fullWidth disabled={mutation.isPending}>
          {mutation.isPending ? 'Skickar…' : 'Skicka inbjudan'}
        </Button>
      </form>
    </Card>
  );
}
