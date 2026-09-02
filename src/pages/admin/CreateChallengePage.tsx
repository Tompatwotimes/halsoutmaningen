import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { addDays } from '@/domain/dates';
import { currentPlainDateInTimeZone } from '@/domain/time';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import {
  ChallengeRuleFields,
  type ChallengeRuleValue,
} from '@/features/admin/ChallengeRuleFields';
import {
  createChallenge,
  useChallengeAdminMutation,
} from '@/features/admin/challenge-admin-api';
import styles from './CreateChallengePage.module.css';

export function CreateChallengePage() {
  const navigate = useNavigate();
  const today = currentPlainDateInTimeZone('Europe/Stockholm');
  const [value, setValue] = useState<ChallengeRuleValue>({
    name: '',
    description: '',
    startDate: addDays(today, 7),
    endDate: addDays(today, 7 + 119),
    timezone: 'Europe/Stockholm',
    requiredMinutes: 30,
    proofRequired: true,
    missedDayCost: 50,
  });
  const [seedPenalties, setSeedPenalties] = useState(true);
  const [tried, setTried] = useState(false);

  const mutation = useChallengeAdminMutation(createChallenge);

  const valid =
    value.name.trim().length >= 1 &&
    value.startDate <= value.endDate &&
    value.requiredMinutes >= 1 &&
    value.missedDayCost >= 0;

  async function submit() {
    setTried(true);
    if (!valid) return;
    try {
      const created = await mutation.mutateAsync({
        name: value.name.trim(),
        description: value.description.trim() || null,
        startDate: value.startDate,
        endDate: value.endDate,
        timezone: value.timezone,
        requiredMinutes: value.requiredMinutes,
        proofRequired: value.proofRequired,
        missedDayCost: value.missedDayCost,
        seedDefaultPenalties: seedPenalties,
      });
      void navigate(`/admin/utmaningar/${created.id}`);
    } catch {
      /* surfaced below */
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="Ny utmaning"
        subtitle="Skapas som utkast. Reglerna kan ändras fritt tills du aktiverar den."
      />
      <p className={styles.back}>
        <Link to="/admin/utmaningar">← Utmaningar</Link>
      </p>

      <Card padding="md">
        <ChallengeRuleFields
          value={value}
          onChange={(patch) => setValue((v) => ({ ...v, ...patch }))}
        />

        <label className={styles.seed}>
          <input
            type="checkbox"
            checked={seedPenalties}
            onChange={(e) => setSeedPenalties(e.target.checked)}
          />
          <span>
            Lägg till standardstraff för Straffbanken (20 → 45-minutaren, 40 →
            60-minutaren, 60 → Dubbelpass)
          </span>
        </label>

        {tried && !valid && (
          <p className={styles.err}>
            Fyll i ett namn och kontrollera datum och siffror.
          </p>
        )}
        {mutation.error && (
          <p className={styles.err}>
            {mutation.error instanceof Error
              ? mutation.error.message
              : 'Kunde inte skapa utmaningen.'}
          </p>
        )}

        <Button
          size="lg"
          fullWidth
          loading={mutation.isPending}
          onClick={() => void submit()}
        >
          Skapa utkast
        </Button>
      </Card>
    </>
  );
}
