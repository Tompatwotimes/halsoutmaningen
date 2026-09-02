import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { PenaltyType } from '@/domain/penalties';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { PlusIcon } from '@/components/icons';
import { useChallengePenaltyDefinitions } from './challenge-admin-api';
import styles from './PenaltyDefinitionList.module.css';

interface Props {
  challengeId: string;
  editable: boolean;
}

const TYPE_LABEL: Record<PenaltyType, string> = {
  [PenaltyType.MinimumMinutes]: 'minuter',
  [PenaltyType.DoubleSession]: 'pass',
};

export function PenaltyDefinitionList({ challengeId, editable }: Props) {
  const { data, isLoading } = useChallengePenaltyDefinitions(challengeId);
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({
    unlockStreak: 30,
    penaltyType: PenaltyType.MinimumMinutes as PenaltyType,
    value: 60,
    displayName: '',
  });

  const invalidate = () =>
    void queryClient.invalidateQueries({
      queryKey: ['straffbank', 'definitions', challengeId],
    });

  const seed = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('seed_default_penalty_definitions', {
        p_challenge_id: challengeId,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidate,
  });

  const add = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('challenge_penalty_definitions')
        .insert({
          challenge_id: challengeId,
          unlock_streak: draft.unlockStreak,
          penalty_type: draft.penaltyType,
          value: draft.value,
          display_name:
            draft.displayName.trim() || `Straff ${draft.unlockStreak}`,
          sort_order: (data?.length ?? 0) + 1,
        });
      if (error) throw new Error(translate(error.message));
    },
    onSuccess: () => {
      invalidate();
      setAdding(false);
    },
  });

  const toggle = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await supabase
        .from('challenge_penalty_definitions')
        .update({ active })
        .eq('id', id);
      if (error) throw new Error(translate(error.message));
    },
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('challenge_penalty_definitions')
        .delete()
        .eq('id', id);
      if (error) throw new Error(translate(error.message));
    },
    onSuccess: invalidate,
  });

  if (isLoading) return <Spinner label="Laddar straff…" />;

  const defs = data ?? [];

  return (
    <div className={styles.wrap}>
      {defs.length === 0 ? (
        <p className={styles.empty}>
          Inga straffdefinitioner.
          {editable && (
            <>
              {' '}
              <button
                type="button"
                className={styles.link}
                onClick={() => seed.mutate()}
                disabled={seed.isPending}
              >
                Lägg till standarduppsättningen
              </button>
              .
            </>
          )}
        </p>
      ) : (
        <ul className={styles.list}>
          {defs.map((d) => (
            <li key={d.id} className={styles.item}>
              <span className={styles.streak}>{d.unlockStreak} d</span>
              <span className={styles.body}>
                <span className={styles.name}>{d.displayName}</span>
                <span className={styles.rule}>
                  {d.penaltyType === PenaltyType.DoubleSession
                    ? `${d.value} separata pass`
                    : `minst ${d.value} minuter totalt`}{' '}
                  ({TYPE_LABEL[d.penaltyType]})
                </span>
              </span>
              {d.active ? (
                <Badge tone="completed" size="sm">
                  På
                </Badge>
              ) : (
                <Badge tone="neutral" size="sm">
                  Av
                </Badge>
              )}
              {editable && (
                <span className={styles.rowActions}>
                  <button
                    type="button"
                    className={styles.link}
                    onClick={() =>
                      toggle.mutate({ id: d.id, active: !d.active })
                    }
                  >
                    {d.active ? 'Stäng av' : 'Aktivera'}
                  </button>
                  <button
                    type="button"
                    className={styles.linkDanger}
                    onClick={() => remove.mutate(d.id)}
                  >
                    Ta bort
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {editable && !adding && defs.length > 0 && (
        <Button
          size="sm"
          variant="ghost"
          icon={<PlusIcon />}
          onClick={() => setAdding(true)}
        >
          Lägg till milstolpe
        </Button>
      )}

      {editable && adding && (
        <div className={styles.addForm}>
          <label>
            Streak (dagar)
            <input
              type="number"
              min={1}
              value={draft.unlockStreak}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  unlockStreak: Number(e.target.value),
                }))
              }
            />
          </label>
          <label>
            Typ
            <select
              value={draft.penaltyType}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  penaltyType: e.target.value as PenaltyType,
                  value: e.target.value === PenaltyType.DoubleSession ? 2 : 60,
                }))
              }
            >
              <option value={PenaltyType.MinimumMinutes}>Fler minuter</option>
              <option value={PenaltyType.DoubleSession}>Dubbelpass</option>
            </select>
          </label>
          <label>
            {draft.penaltyType === PenaltyType.DoubleSession
              ? 'Antal pass'
              : 'Minuter'}
            <input
              type="number"
              min={draft.penaltyType === PenaltyType.DoubleSession ? 2 : 1}
              value={draft.value}
              onChange={(e) =>
                setDraft((d) => ({ ...d, value: Number(e.target.value) }))
              }
            />
          </label>
          <label>
            Namn
            <input
              type="text"
              value={draft.displayName}
              maxLength={60}
              placeholder="t.ex. 60-minutaren"
              onChange={(e) =>
                setDraft((d) => ({ ...d, displayName: e.target.value }))
              }
            />
          </label>
          {add.error && (
            <p className={styles.err}>
              {add.error instanceof Error
                ? add.error.message
                : 'Kunde inte spara.'}
            </p>
          )}
          <div className={styles.addActions}>
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
              Avbryt
            </Button>
            <Button
              size="sm"
              loading={add.isPending}
              onClick={() => add.mutate()}
            >
              Lägg till
            </Button>
          </div>
        </div>
      )}

      {!editable && (
        <p className={styles.locked}>
          Straffdefinitionerna är låsta när utmaningen är aktiv eller har
          startat.
        </p>
      )}
    </div>
  );
}

function translate(message: string): string {
  if (message.includes('låsta'))
    return 'Straffdefinitioner är låsta för den här utmaningen.';
  if (message.includes('duplicate') || message.includes('cpd_one_per_streak'))
    return 'Det finns redan en milstolpe för den streaken.';
  return message;
}
