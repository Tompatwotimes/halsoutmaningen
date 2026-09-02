import { useEffect, useMemo, useState } from 'react';
import { formatLongDate } from '@/domain/format';
import { Sheet } from '@/components/ui/Sheet';
import { Button } from '@/components/ui/Button';
import { Avatar } from '@/components/ui/Avatar';
import { Spinner } from '@/components/ui/Spinner';
import { SkullIcon } from '@/components/icons';
import { capitalize, weekdayLong } from '@/features/challenge/labels';
import type { ParticipantView } from '@/features/challenge/types';
import { previewPenaltyTarget } from './straffbank-api';
import { useAssignPenalty } from './useStraffbank';
import type { InventoryItem } from './straffbanken';
import styles from './AssignPenaltySheet.module.css';

interface Props {
  open: boolean;
  onClose: () => void;
  challengeId: string;
  selfUserId: string;
  item: InventoryItem;
  /** Every participant with a membership (self is filtered out here). */
  participants: ParticipantView[];
}

type Step = 'target' | 'confirm' | 'done';

export function AssignPenaltySheet({
  open,
  onClose,
  challengeId,
  selfUserId,
  item,
  participants,
}: Props) {
  const [step, setStep] = useState<Step>('target');
  const [target, setTarget] = useState<ParticipantView | null>(null);
  const [preview, setPreview] = useState<{
    loading: boolean;
    date: string | null;
    reason: string | null;
  }>({ loading: false, date: null, reason: null });
  const assign = useAssignPenalty(challengeId, selfUserId);
  const [landed, setLanded] = useState<string | null>(null);

  const targets = useMemo(
    () =>
      participants
        .filter((p) => p.userId !== selfUserId && p.membership.active)
        .sort((a, b) => a.displayName.localeCompare(b.displayName, 'sv')),
    [participants, selfUserId],
  );

  useEffect(() => {
    if (step !== 'confirm' || !target) return;
    let cancelled = false;
    setPreview({ loading: true, date: null, reason: null });
    void previewPenaltyTarget(item.earnedPenaltyId, target.userId)
      .then((r) => {
        if (cancelled) return;
        setPreview({
          loading: false,
          date: r.ok ? r.targetDate : null,
          reason: r.ok ? null : (r.reason ?? 'Går inte att straffa personen.'),
        });
      })
      .catch(() => {
        if (!cancelled)
          setPreview({
            loading: false,
            date: null,
            reason: 'Kunde inte förhandsgranska. Försök igen.',
          });
      });
    return () => {
      cancelled = true;
    };
  }, [step, target, item.earnedPenaltyId]);

  function reset() {
    setStep('target');
    setTarget(null);
    setLanded(null);
    assign.reset();
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function confirm() {
    if (!target) return;
    try {
      const res = await assign.mutateAsync({
        earnedPenaltyId: item.earnedPenaltyId,
        toUserId: target.userId,
      });
      setLanded(res.targetDate);
      setStep('done');
    } catch {
      /* surfaced via assign.error below */
    }
  }

  return (
    <Sheet
      open={open}
      onClose={handleClose}
      title={step === 'done' ? 'Straff utdelat' : `Jävlas med någon`}
    >
      {step === 'target' && (
        <>
          <p className={styles.lead}>
            <SkullIcon className={styles.leadIcon} aria-hidden="true" />
            Vem ska få <strong>{item.displayName}</strong>?
          </p>
          {targets.length === 0 ? (
            <p className={styles.muted}>Inga aktiva deltagare att välja.</p>
          ) : (
            <ul className={styles.targets}>
              {targets.map((p) => (
                <li key={p.userId}>
                  <button
                    type="button"
                    className={styles.targetRow}
                    onClick={() => {
                      setTarget(p);
                      setStep('confirm');
                    }}
                  >
                    <Avatar name={p.displayName} size="sm" />
                    <span className={styles.targetName}>{p.displayName}</span>
                    <span className={styles.targetStreak}>
                      {p.currentStreak} d streak
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {step === 'confirm' && target && (
        <div className={styles.confirm}>
          <div className={styles.confirmHead}>
            <Avatar name={target.displayName} size="lg" />
            <div>
              <p className={styles.confirmName}>{target.displayName}</p>
              <p className={styles.confirmPenalty}>
                <SkullIcon className={styles.leadIcon} aria-hidden="true" />
                {item.displayName}
              </p>
            </div>
          </div>

          {preview.loading ? (
            <Spinner label="Räknar ut vilken dag…" />
          ) : preview.reason ? (
            <p className={styles.previewError}>{preview.reason}</p>
          ) : preview.date ? (
            <p className={styles.previewDate}>
              Slår till{' '}
              <strong>
                {capitalize(weekdayLong(preview.date))}{' '}
                {formatLongDate(preview.date)}
              </strong>{' '}
              — {target.displayName.split(' ')[0]}s nästa lediga träningsdag.
              Sändaren (du) syns för mottagaren.
            </p>
          ) : null}

          {assign.error && (
            <p className={styles.previewError}>
              {assign.error instanceof Error
                ? assign.error.message
                : 'Kunde inte dela ut straffet.'}
            </p>
          )}

          <div className={styles.confirmActions}>
            <Button
              variant="ghost"
              onClick={() => {
                setStep('target');
                setTarget(null);
              }}
            >
              Byt person
            </Button>
            <Button
              onClick={() => void confirm()}
              loading={assign.isPending}
              disabled={!preview.date || preview.loading}
            >
              Dela ut straffet
            </Button>
          </div>
        </div>
      )}

      {step === 'done' && target && landed && (
        <div className={styles.done}>
          <span className={styles.doneMark} aria-hidden="true">
            <SkullIcon />
          </span>
          <p className={styles.doneTitle}>
            {target.displayName} har fått {item.displayName}
          </p>
          <p className={styles.doneSub}>
            {capitalize(weekdayLong(landed))} {formatLongDate(landed)}. Hen ser
            att det var du.
          </p>
          <Button fullWidth onClick={handleClose}>
            Klart
          </Button>
        </div>
      )}
    </Sheet>
  );
}
