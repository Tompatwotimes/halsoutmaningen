import { useMemo, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/feedback/ErrorState';
import { ConfirmSheet } from '@/components/ui/ConfirmSheet';
import { useParticipants } from '@/features/admin/participants-api';
import {
  useAdminWeightProfiles,
  useDiscloseWeightWinner,
  useFinalizeWeightCompetition,
  useSetOfficialFinalWeight,
} from './weight-admin-api';
import styles from './WeightFinalPanel.module.css';

/**
 * Admin official final weigh-in (spec §6.5), route /admin/viktkampen.
 *
 * Per-participant official-final input → mandatory-reason ConfirmSheet (same
 * shape as GameMasterRunLog's cancel flow). "Fastställ vinnare" runs
 * finalize_weight_competition — which never consults is_weight_hidden, so a
 * hidden participant can win. "Publicera vinnare" (shown only after finalize)
 * runs disclose_weight_winner — the ONLY path that reveals a hidden winner's
 * name + percentage.
 *
 * There is deliberately NO control here to set is_weight_hidden for a
 * participant, nor to open a hidden participant's weight history/chart — an
 * admin's ordinary full read is all they get, and it is not surfaced in this
 * panel.
 */
export function WeightFinalPanel({ challengeId }: { challengeId: string }) {
  const roster = useParticipants(challengeId);
  const profiles = useAdminWeightProfiles(challengeId);
  const setFinal = useSetOfficialFinalWeight(challengeId);
  const finalize = useFinalizeWeightCompetition(challengeId);
  const disclose = useDiscloseWeightWinner(challengeId);

  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState<{
    userId: string;
    name: string;
    weightKg: number;
    correcting: boolean;
  } | null>(null);
  const [reason, setReason] = useState('');

  const profileByUser = useMemo(
    () => new Map((profiles.data ?? []).map((p) => [p.userId, p])),
    [profiles.data],
  );
  const nameByUser = useMemo(
    () => new Map((roster.data ?? []).map((m) => [m.userId, m.displayName])),
    [roster.data],
  );
  const winner = finalize.data;

  if (roster.isLoading || profiles.isLoading) {
    return (
      <Card title="Officiell slutvägning">
        <Skeleton height="8rem" radius="var(--radius-md)" />
      </Card>
    );
  }
  if (roster.isError || profiles.isError) {
    return (
      <Card title="Officiell slutvägning">
        <ErrorState message="Deltagarlistan kunde inte hämtas." />
      </Card>
    );
  }

  return (
    <Card title="Officiell slutvägning">
      <ul className={styles.list}>
        {(roster.data ?? []).map((m) => {
          const wp = profileByUser.get(m.userId);
          const draft = drafts[m.userId] ?? '';
          const parsed = Number(draft.replace(',', '.'));
          const valid =
            draft.trim() !== '' &&
            Number.isFinite(parsed) &&
            parsed > 0 &&
            parsed <= 400;
          const correcting = wp?.officialFinalWeightKg != null;
          return (
            <li key={m.userId} className={styles.row}>
              <span className={styles.name}>
                {m.displayName}
                {wp?.isWeightHidden && (
                  <span className={styles.hidden}> (dold)</span>
                )}
              </span>
              <span className={styles.meta}>
                Start {wp?.startWeightKg ?? '—'} · Slut{' '}
                {wp?.officialFinalWeightKg ?? '—'}
              </span>
              <span className={styles.entry}>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  min="1"
                  max="400"
                  aria-label={`Officiell slutvikt för ${m.displayName}`}
                  placeholder="kg"
                  value={draft}
                  onChange={(e) =>
                    setDrafts((d) => ({ ...d, [m.userId]: e.target.value }))
                  }
                  className={styles.input}
                />
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!valid}
                  onClick={() => {
                    setReason('');
                    setConfirm({
                      userId: m.userId,
                      name: m.displayName,
                      weightKg: parsed,
                      correcting,
                    });
                  }}
                >
                  {correcting ? 'Rätta' : 'Registrera'}
                </Button>
              </span>
            </li>
          );
        })}
      </ul>

      <div className={styles.finalizeRow}>
        <Button
          variant="primary"
          loading={finalize.isPending}
          onClick={() => finalize.mutate()}
        >
          Fastställ vinnare
        </Button>
      </div>

      {winner?.winnerUserId != null && (
        <div className={styles.winner} data-testid="weight-winner">
          <p className={styles.winnerLabel}>Beräknad vinnare</p>
          <p className={styles.winnerName}>
            {nameByUser.get(winner.winnerUserId) ?? '—'}
          </p>
          <p className={styles.winnerPct}>{winner.winnerPercentageChange} %</p>
          <Button
            variant="secondary"
            size="sm"
            loading={disclose.isPending}
            onClick={() => disclose.mutate()}
          >
            Publicera vinnare
          </Button>
        </div>
      )}

      <ConfirmSheet
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={
          confirm
            ? `${confirm.correcting ? 'Rätta' : 'Registrera'} slutvikt — ${confirm.name}`
            : ''
        }
        body={`${confirm?.weightKg ?? ''} kg registreras som officiell slutvikt. Åtgärden loggas.`}
        confirmLabel={confirm?.correcting ? 'Rätta' : 'Registrera'}
        loading={setFinal.isPending}
        error={setFinal.error instanceof Error ? setFinal.error.message : null}
        disabled={reason.trim().length < 3}
        onConfirm={() => {
          if (!confirm) return;
          setFinal.mutate(
            {
              userId: confirm.userId,
              weightKg: confirm.weightKg,
              reason: reason.trim(),
            },
            { onSuccess: () => setConfirm(null) },
          );
        }}
      >
        <label className={styles.field}>
          <span>Anledning (obligatorisk)</span>
          <textarea
            value={reason}
            rows={2}
            maxLength={1000}
            onChange={(e) => setReason(e.target.value)}
            placeholder="T.ex. Officiell invägning i finalen."
          />
        </label>
      </ConfirmSheet>
    </Card>
  );
}
