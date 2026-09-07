import { formatLongDate, formatMinutes } from '@/domain/format';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import { SignedProofImage } from '@/components/proof/SignedProofImage';
import { CheckIcon } from '@/components/icons';
import { useTrainingCardProofUrls } from './useChat';
import type { TrainingCardData } from './types';
import styles from './TrainingCard.module.css';

/**
 * An automatic activity card for a real training entry, shown inline in the
 * shared chat. It is NOT a free-text message — every field is resolved live
 * from the training entry by `list_chat_messages`, so an invalidated entry's
 * card renders "Passet har underkänts" with no extra message. The proof images
 * are the SAME already-compressed objects in the private `proofs` bucket — this
 * card mints a short-lived signed URL per image, it never re-uploads.
 */
export function TrainingCard({
  card,
  senderName,
  time,
}: {
  card: TrainingCardData;
  /** Already resolved to "Du" for the viewer's own card. */
  senderName: string;
  /** `HH:MM`, same clock the other message rows show. */
  time: string;
}) {
  const invalidated = card.entryStatus === 'invalidated';
  const proofs = useTrainingCardProofUrls(card.entryId, card.proofs);

  return (
    <div
      className={[styles.card, invalidated && styles.invalidated]
        .filter(Boolean)
        .join(' ')}
      data-testid="training-card"
    >
      <div className={styles.head}>
        <span className={styles.badge} aria-hidden="true">
          <CheckIcon />
        </span>
        <span className={styles.title}>{senderName} loggade ett pass</span>
        <time className={styles.time}>{time}</time>
      </div>

      <p className={styles.summary}>
        <span className={styles.activity}>{card.activity ?? 'Träning'}</span>
        <span className={styles.dot} aria-hidden="true">
          ·
        </span>
        <span className="tnum">{formatMinutes(card.durationMinutes)}</span>
      </p>
      <p className={styles.when}>
        {formatLongDate(card.challengeDate)}, {time}
      </p>

      {invalidated && (
        <Badge tone="missed" size="sm">
          Passet har underkänts
        </Badge>
      )}

      {card.proofs.length > 0 && (
        <div
          className={styles.proofs}
          data-count={Math.min(card.proofs.length, 2)}
          data-testid="training-card-proofs"
        >
          {card.proofs.map((p, i) => {
            const resolved = proofs.data?.find(
              (d) => d.position === p.position,
            );
            const url = proofs.isLoading ? undefined : (resolved?.url ?? null);
            if (url === undefined) {
              return (
                <Skeleton
                  key={p.path}
                  height="10rem"
                  radius="var(--radius-md)"
                />
              );
            }
            if (url === null) {
              return (
                <div
                  key={p.path}
                  className={styles.brokenProof}
                  aria-label="Bilden kunde inte laddas"
                />
              );
            }
            return (
              <SignedProofImage
                key={p.path}
                src={url}
                alt={`Bildbevis ${i + 1}`}
              />
            );
          })}
        </div>
      )}

      {card.note !== null && card.note.trim() !== '' && (
        <p className={styles.note}>”{card.note}”</p>
      )}
    </div>
  );
}
