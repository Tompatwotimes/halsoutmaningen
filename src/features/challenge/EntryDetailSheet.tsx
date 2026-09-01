import type { ChallengeConfig } from '@/domain/challenge';
import { formatLongDate, formatMinutes } from '@/domain/format';
import { Sheet } from '@/components/ui/Sheet';
import { Badge } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import { EmptyState } from '@/components/feedback/EmptyState';
import { ProofImage } from '@/components/proof/ProofImage';
import { CheckIcon, ClockIcon, ImageOffIcon } from '@/components/icons';
import type { EntryFixture } from '@/fixtures/entries';
import { weekdayLong, capitalize } from './labels';
import styles from './EntryDetailSheet.module.css';

interface Props {
  open: boolean;
  onClose: () => void;
  challenge: ChallengeConfig;
  participantName: string;
  isSelf: boolean;
  date: string;
  entry: EntryFixture | null;
}

function timeOf(iso: string): string {
  const match = /T(\d{2}:\d{2})/.exec(iso);
  return match?.[1] ?? '';
}

export function EntryDetailSheet({
  open,
  onClose,
  challenge,
  participantName,
  isSelf,
  date,
  entry,
}: Props) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      hideHeader
      ariaLabel={`Träningspass för ${participantName}`}
    >
      <div className={styles.head}>
        <Avatar name={participantName} size="lg" ring={isSelf} />
        <div>
          <p className={styles.name}>
            {participantName}
            {isSelf && <span className={styles.you}> · du</span>}
          </p>
          <p className={styles.date}>
            {capitalize(weekdayLong(date))} {formatLongDate(date)}
          </p>
        </div>
      </div>

      {entry ? (
        <>
          <div className={styles.metrics}>
            <div className={styles.metric}>
              <span className={styles.metricLabel}>Tid</span>
              <span className={`${styles.metricValue} tnum`}>
                {formatMinutes(entry.durationMinutes)}
              </span>
              <Badge
                tone="completed"
                size="sm"
                icon={<CheckIcon />}
              >
                Kravet uppfyllt
              </Badge>
            </div>
            <div className={styles.metric}>
              <span className={styles.metricLabel}>Aktivitet</span>
              <span className={styles.metricValue}>{entry.activity}</span>
              <span className={styles.metricSub}>
                Minst {formatMinutes(challenge.requiredMinutes)} krävs
              </span>
            </div>
          </div>

          {entry.note && <p className={styles.note}>”{entry.note}”</p>}

          {entry.hasProof ? (
            <ProofImage seed={entry.proofSeed} activity={entry.activity} />
          ) : (
            <EmptyState
              icon={<ImageOffIcon />}
              title="Inget bildbevis"
              body="Passet registrerades utan bild."
            />
          )}

          <p className={styles.submitted}>
            <ClockIcon className={styles.clock} />
            Registrerad kl. {timeOf(entry.submittedAt)}
          </p>
        </>
      ) : (
        <EmptyState
          icon={<ImageOffIcon />}
          title="Ingen registrering"
          body={`${isSelf ? 'Du har' : `${participantName} har`} inget pass registrerat den här dagen.`}
        />
      )}
    </Sheet>
  );
}
