import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ChallengeConfig } from '@/domain/challenge';
import { addDays, isPlainDate } from '@/domain/dates';
import { formatDayMonth } from '@/domain/format';
import { Sheet } from '@/components/ui/Sheet';
import { Button } from '@/components/ui/Button';
import {
  correctChallengeStartDate,
  describeStartDateBlock,
  previewStartDateCorrection,
  useChallengeAdminMutation,
} from './challenge-admin-api';
import styles from './CorrectStartDateSheet.module.css';

interface Props {
  open: boolean;
  onClose: () => void;
  challenge: ChallengeConfig;
  onCorrected: () => void;
}

/**
 * A deliberately narrow admin action: move an ACTIVE challenge's start_date
 * forward to fix a configuration mistake — never a general rule edit. The
 * server re-validates atomically; this preview is advisory, not authoritative
 * (CLAUDE.md §9, §17).
 */
export function CorrectStartDateSheet({
  open,
  onClose,
  challenge,
  onCorrected,
}: Props) {
  const [newStartDate, setNewStartDate] = useState(
    addDays(challenge.startDate, 1),
  );
  const [reason, setReason] = useState('');

  const previewEnabled =
    isPlainDate(newStartDate) && newStartDate !== challenge.startDate;
  const preview = useQuery({
    queryKey: [
      'admin',
      'challenge',
      challenge.id,
      'start-date-preview',
      newStartDate,
    ],
    queryFn: () => previewStartDateCorrection(challenge.id, newStartDate),
    enabled: previewEnabled,
    staleTime: 0,
  });

  const mutation = useChallengeAdminMutation(correctChallengeStartDate);

  const removedRangeLabel = useMemo(() => {
    if (!preview.data?.ok || !preview.data.removedRangeStart) return null;
    const start = formatDayMonth(preview.data.removedRangeStart);
    const end = preview.data.removedRangeEnd
      ? formatDayMonth(preview.data.removedRangeEnd)
      : start;
    return `${start}–${end}`;
  }, [preview.data]);

  async function submit() {
    if (!preview.data?.ok) return;
    try {
      await mutation.mutateAsync({
        challengeId: challenge.id,
        newStartDate,
        reason: reason.trim() || null,
      });
      onCorrected();
    } catch {
      /* surfaced */
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Rätta utmaningsdatum">
      <p className={styles.lead}>
        Flyttar bara utmaningens startdatum <strong>framåt</strong> — för att
        rätta ett felkonfigurerat datum på en redan aktiv utmaning. Övriga
        regler ändras inte. Ingenting raderas; historik som skulle bli
        inkonsekvent blockerar rättningen istället.
      </p>

      <div className={styles.row}>
        <div className={styles.field}>
          <span>Nuvarande start</span>
          <strong>{formatDayMonth(challenge.startDate)}</strong>
        </div>
        <label className={styles.field}>
          <span>Nytt startdatum</span>
          <input
            type="date"
            min={addDays(challenge.startDate, 1)}
            max={challenge.endDate}
            value={newStartDate}
            onChange={(e) => setNewStartDate(e.target.value)}
          />
        </label>
      </div>

      <label className={styles.field}>
        <span>Anledning (valfritt)</span>
        <textarea
          value={reason}
          maxLength={2000}
          rows={2}
          onChange={(e) => setReason(e.target.value)}
          placeholder="T.ex. felaktigt startdatum vid aktivering"
        />
      </label>

      {previewEnabled && preview.isFetching && (
        <p className={styles.checking}>Kontrollerar…</p>
      )}
      {previewEnabled && preview.data?.ok && removedRangeLabel && (
        <p className={styles.ok}>
          Perioden {removedRangeLabel} tas bort från utmaningen. Ingen
          registrerad träningshistorik påverkas.
        </p>
      )}
      {previewEnabled && preview.data && !preview.data.ok && (
        <p className={styles.err}>
          {describeStartDateBlock(preview.data, formatDayMonth)}
        </p>
      )}
      {preview.isError && (
        <p className={styles.err}>
          {preview.error instanceof Error
            ? preview.error.message
            : 'Kunde inte förhandsgranska rättningen.'}
        </p>
      )}

      {mutation.error && (
        <p className={styles.err}>
          {mutation.error instanceof Error
            ? mutation.error.message
            : 'Rättningen misslyckades.'}
        </p>
      )}

      <div className={styles.actions}>
        <Button variant="ghost" onClick={onClose}>
          Avbryt
        </Button>
        <Button
          variant="danger"
          loading={mutation.isPending}
          disabled={!previewEnabled || preview.data?.ok !== true}
          onClick={() => void submit()}
        >
          Bekräfta rättning
        </Button>
      </div>
    </Sheet>
  );
}
