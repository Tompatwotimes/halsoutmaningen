import type { ChallengeConfig } from '@/domain/challenge';
import { formatLongDate, formatMinutes } from '@/domain/format';
import { Sheet } from '@/components/ui/Sheet';
import { Badge } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import { SkeletonText } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/feedback/EmptyState';
import { ErrorState } from '@/components/feedback/ErrorState';
import { SignedProofImage } from '@/components/proof/SignedProofImage';
import { CheckIcon, ClockIcon, ImageOffIcon } from '@/components/icons';
import { useEntryDetail } from './useEntryDetail';
import { weekdayLong, capitalize } from './labels';
import styles from './EntryDetailSheet.module.css';

interface Props {
  open: boolean;
  onClose: () => void;
  challenge: ChallengeConfig;
  participantName: string;
  isSelf: boolean;
  userId: string;
  date: string;
}

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString('sv-SE', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Entry + proof detail for one (participant, date) cell — always fetched on
 * demand when opened, for self and others alike (Part 8 of the real-data
 * phase). Nothing here is preloaded for a whole grid.
 */
export function EntryDetailSheet({
  open,
  onClose,
  challenge,
  participantName,
  isSelf,
  userId,
  date,
}: Props) {
  const { data, isLoading, isError, refetch } = useEntryDetail(
    challenge.id,
    userId,
    date,
    open,
  );

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

      {isLoading && <SkeletonText lines={4} />}

      {isError && (
        <ErrorState
          title="Kunde inte hämta passet"
          onRetry={() => void refetch()}
        />
      )}

      {!isLoading && !isError && !data && (
        <EmptyState
          icon={<ImageOffIcon />}
          title="Ingen registrering"
          body={`${isSelf ? 'Du har' : `${participantName} har`} inget pass registrerat den här dagen.`}
        />
      )}

      {!isLoading && !isError && data && (
        <>
          <div className={styles.metrics}>
            <div className={styles.metric}>
              <span className={styles.metricLabel}>Tid</span>
              <span className={`${styles.metricValue} tnum`}>
                {formatMinutes(data.durationMinutes)}
              </span>
              {data.durationMinutes >= challenge.requiredMinutes && (
                <Badge tone="completed" size="sm" icon={<CheckIcon />}>
                  Kravet uppfyllt
                </Badge>
              )}
            </div>
            <div className={styles.metric}>
              <span className={styles.metricLabel}>Aktivitet</span>
              <span className={styles.metricValue}>{data.activity ?? '—'}</span>
              <span className={styles.metricSub}>
                Minst {formatMinutes(challenge.requiredMinutes)} krävs
              </span>
            </div>
          </div>

          {data.note && <p className={styles.note}>”{data.note}”</p>}

          {data.proofSignedUrl ? (
            <SignedProofImage
              src={data.proofSignedUrl}
              alt={
                data.activity
                  ? `Bildbevis för ${data.activity.toLowerCase()}`
                  : 'Bildbevis'
              }
            />
          ) : (
            <EmptyState
              icon={<ImageOffIcon />}
              title="Inget bildbevis"
              body="Passet registrerades utan bild."
            />
          )}

          <p className={styles.submitted}>
            <ClockIcon className={styles.clock} />
            Registrerad kl. {timeOf(data.submittedAt)}
          </p>
        </>
      )}
    </Sheet>
  );
}
