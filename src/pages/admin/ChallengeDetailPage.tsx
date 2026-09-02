import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ChallengeStatus,
  challengeDurationDays,
  challengeProgress,
  fullPeriodMaxLiability,
} from '@/domain/challenge';
import { currentPlainDateInTimeZone } from '@/domain/time';
import { formatDayMonth, formatSek } from '@/domain/format';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { ConfirmSheet } from '@/components/ui/ConfirmSheet';
import { ErrorState } from '@/components/feedback/ErrorState';
import { DownloadIcon, CopyIcon } from '@/components/icons';
import {
  ChallengeRuleFields,
  type ChallengeRuleValue,
} from '@/features/admin/ChallengeRuleFields';
import { ChallengeResults } from '@/features/admin/ChallengeResults';
import { PenaltyDefinitionList } from '@/features/admin/PenaltyDefinitionList';
import { useChallenge } from '@/features/admin/challenge-admin-api';
import {
  archiveChallenge,
  completeChallenge,
  reopenChallenge,
  setChallengeStatus,
  updateChallenge,
  useChallengeAdminMutation,
} from '@/features/admin/challenge-admin-api';
import { DuplicateChallengeSheet } from '@/features/admin/DuplicateChallengeSheet';
import { useParticipants } from '@/features/admin/participants-api';
import { useChallengeResults } from '@/features/admin/challenge-results-api';
import {
  buildChallengeResultsCsv,
  downloadCsv,
} from '@/features/admin/challenge-results-csv';
import styles from './ChallengeDetailPage.module.css';

export function ChallengeDetailPage() {
  const { challengeId = '' } = useParams();
  const navigate = useNavigate();
  const {
    data: challenge,
    isLoading,
    isError,
    refetch,
  } = useChallenge(challengeId);
  const roster = useParticipants(challengeId);
  const resultsQuery = useChallengeResults(challengeId);

  const [form, setForm] = useState<ChallengeRuleValue | null>(null);
  const [confirm, setConfirm] = useState<
    'activate' | 'complete' | 'archive' | 'reopen' | 'delete' | null
  >(null);
  const [showDuplicate, setShowDuplicate] = useState(false);

  const save = useChallengeAdminMutation(updateChallenge);
  const lifecycle = useChallengeAdminMutation(
    async (args: { action: string }) => {
      switch (args.action) {
        case 'activate':
          return setChallengeStatus(challengeId, 'active');
        case 'archive':
          return archiveChallenge(challengeId);
        case 'complete':
          return completeChallenge(challengeId);
        case 'reopen':
          return reopenChallenge(challengeId);
        default:
          return Promise.resolve();
      }
    },
  );
  const del = useChallengeAdminMutation(async () => {
    const { supabase } = await import('@/lib/supabase');
    const { error } = await supabase
      .from('challenges')
      .delete()
      .eq('id', challengeId);
    if (error) throw new Error(error.message);
  });

  const nameOf = useMemo(() => {
    const m = new Map(
      (roster.data ?? []).map((p) => [p.userId, p.displayName]),
    );
    return (id: string) => m.get(id) ?? 'Deltagare';
  }, [roster.data]);

  if (isLoading) return <Spinner label="Laddar utmaningen…" />;
  if (isError || !challenge)
    return <ErrorState onRetry={() => void refetch()} />;

  const isDraft = challenge.status === ChallengeStatus.Draft;
  const isActive = challenge.status === ChallengeStatus.Active;
  const isFinished =
    challenge.status === ChallengeStatus.Completed ||
    challenge.status === ChallengeStatus.Archived;
  const today = currentPlainDateInTimeZone(challenge.timeZone);
  const started = today >= challenge.startDate;
  const locked = !isDraft || started;
  const progress = challengeProgress(challenge, today);
  const activeParticipants = (roster.data ?? []).filter(
    (p) => p.membershipActive,
  ).length;

  const current: ChallengeRuleValue = form ?? {
    name: challenge.name,
    description: challenge.description ?? '',
    startDate: challenge.startDate,
    endDate: challenge.endDate,
    timezone: challenge.timeZone,
    requiredMinutes: challenge.requiredMinutes,
    proofRequired: challenge.proofRequired,
    missedDayCost: challenge.missedDayCost,
  };
  const dirty = form !== null;

  async function handleSave() {
    try {
      await save.mutateAsync({
        id: challengeId,
        name: current.name.trim(),
        description: current.description.trim() || null,
        startDate: current.startDate,
        endDate: current.endDate,
        requiredMinutes: current.requiredMinutes,
        proofRequired: current.proofRequired,
        missedDayCost: current.missedDayCost,
      });
      setForm(null);
    } catch {
      /* surfaced */
    }
  }

  function exportCsv(ch: typeof challenge) {
    if (!ch) return;
    const rows = resultsQuery.data ?? [];
    downloadCsv(
      `${ch.name.replace(/[^\w]+/g, '_')}_resultat.csv`,
      buildChallengeResultsCsv(ch, rows, nameOf),
    );
  }

  const statusLabel = {
    draft: 'Utkast',
    active: 'Aktiv',
    completed: 'Avslutad',
    archived: 'Arkiverad',
  }[challenge.status];

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title={challenge.name}
        action={<Badge size="sm">{statusLabel}</Badge>}
      />
      <p className={styles.back}>
        <Link to="/admin/utmaningar">← Utmaningar</Link>
      </p>

      {/* Derived facts */}
      <Card padding="md" className={styles.facts}>
        <Fact
          label="Period"
          value={`${formatDayMonth(challenge.startDate)} – ${formatDayMonth(challenge.endDate)}`}
        />
        <Fact label="Dagar" value={String(challengeDurationDays(challenge))} />
        <Fact
          label="Dag nu"
          value={
            isFinished
              ? '–'
              : `${String(Math.max(progress.elapsedDays, 0))} / ${String(progress.totalDays)}`
          }
        />
        <Fact label="Aktiva deltagare" value={String(activeParticipants)} />
        <Fact
          label="Max ansvar"
          value={formatSek(fullPeriodMaxLiability(challenge))}
        />
        <Fact
          label="Kvar"
          value={isFinished ? '–' : `${String(progress.remainingDays)} d`}
        />
      </Card>

      {/* Rules */}
      <Card title="Regler" padding="md">
        <ChallengeRuleFields
          value={current}
          onChange={(patch) => setForm({ ...current, ...patch })}
          locked={locked}
          endDateEditable={isActive}
        />
        {(isDraft || (isActive && dirty)) && (
          <div className={styles.saveRow}>
            <Button
              onClick={() => void handleSave()}
              loading={save.isPending}
              disabled={!dirty}
            >
              Spara ändringar
            </Button>
            {dirty && (
              <Button variant="ghost" onClick={() => setForm(null)}>
                Ångra
              </Button>
            )}
          </div>
        )}
        {save.error && (
          <p className={styles.err}>
            {save.error instanceof Error
              ? save.error.message
              : 'Kunde inte spara.'}
          </p>
        )}
      </Card>

      {/* Penalty definitions */}
      <Card title="Straffbanken — milstolpar" padding="md">
        <PenaltyDefinitionList challengeId={challengeId} editable={isDraft} />
      </Card>

      {/* Lifecycle */}
      <Card title="Livscykel" padding="md">
        <div className={styles.lifecycle}>
          <Link to={`/admin/deltagare`} className={styles.lcLink}>
            Hantera deltagare →
          </Link>
          {isDraft && (
            <Button variant="secondary" onClick={() => setConfirm('activate')}>
              Aktivera utmaningen
            </Button>
          )}
          {isActive && (
            <Button variant="secondary" onClick={() => setConfirm('complete')}>
              Avsluta utmaningen
            </Button>
          )}
          {isFinished && (
            <>
              <Button variant="secondary" onClick={() => setConfirm('reopen')}>
                Återöppna för rättning
              </Button>
              {challenge.status === ChallengeStatus.Completed && (
                <Button variant="ghost" onClick={() => setConfirm('archive')}>
                  Arkivera
                </Button>
              )}
            </>
          )}
          <Button
            variant="ghost"
            icon={<CopyIcon />}
            onClick={() => setShowDuplicate(true)}
          >
            Skapa ny från denna
          </Button>
          {isDraft && (
            <Button variant="danger" onClick={() => setConfirm('delete')}>
              Ta bort utkastet
            </Button>
          )}
        </div>
        {lifecycle.error && (
          <p className={styles.err}>
            {lifecycle.error instanceof Error
              ? lifecycle.error.message
              : 'Åtgärden misslyckades.'}
          </p>
        )}
      </Card>

      {/* Results + export */}
      {(isActive || isFinished) && (
        <Card
          title={isFinished ? 'Slutresultat' : 'Resultat hittills'}
          padding="md"
          action={
            <Button
              size="sm"
              variant="ghost"
              icon={<DownloadIcon />}
              onClick={() => exportCsv(challenge)}
              disabled={!resultsQuery.data}
            >
              CSV
            </Button>
          }
        >
          <ChallengeResults
            challengeId={challengeId}
            nameOf={nameOf}
            final={isFinished}
          />
        </Card>
      )}

      {/* Confirms */}
      <ConfirmSheet
        open={confirm === 'activate'}
        onClose={() => setConfirm(null)}
        title="Aktivera utmaningen?"
        body={
          <>
            Gör <strong>{challenge.name}</strong> loggbar för deltagarna.{' '}
            {started
              ? 'Reglerna är redan låsta eftersom startdatumet har passerat.'
              : 'Reglerna låses nu och kan bara ändras genom att skapa en ny utmaning från denna.'}
          </>
        }
        confirmLabel="Ja, aktivera"
        loading={lifecycle.isPending}
        onConfirm={() =>
          lifecycle.mutate(
            { action: 'activate' },
            { onSuccess: () => setConfirm(null) },
          )
        }
      />
      <ConfirmSheet
        open={confirm === 'complete'}
        onClose={() => setConfirm(null)}
        title="Avsluta utmaningen?"
        body={
          <>
            Deltagare kan inte längre logga träning eller dela ut straff.
            Oanvända straff i Straffbanken går ut. Slutresultatet blir synligt.
            Du kan återöppna för administrativa rättningar.
          </>
        }
        confirmLabel="Ja, avsluta"
        loading={lifecycle.isPending}
        onConfirm={() =>
          lifecycle.mutate(
            { action: 'complete' },
            { onSuccess: () => setConfirm(null) },
          )
        }
      />
      <ConfirmSheet
        open={confirm === 'archive'}
        onClose={() => setConfirm(null)}
        title="Arkivera utmaningen?"
        body="Historiken bevaras och är fortfarande läsbar. Arkivering döljer utmaningen från de aktiva listorna."
        confirmLabel="Arkivera"
        loading={lifecycle.isPending}
        onConfirm={() =>
          lifecycle.mutate(
            { action: 'archive' },
            { onSuccess: () => setConfirm(null) },
          )
        }
      />
      <ConfirmSheet
        open={confirm === 'reopen'}
        onClose={() => setConfirm(null)}
        title="Återöppna utmaningen?"
        body="Sätter status till aktiv igen så att du kan göra administrativa rättningar. Straff som redan gått ut kommer inte tillbaka."
        confirmLabel="Återöppna"
        loading={lifecycle.isPending}
        onConfirm={() =>
          lifecycle.mutate(
            { action: 'reopen' },
            { onSuccess: () => setConfirm(null) },
          )
        }
      />
      <ConfirmSheet
        open={confirm === 'delete'}
        onClose={() => setConfirm(null)}
        title="Ta bort utkastet?"
        body={
          <>
            <strong>{challenge.name}</strong> tas bort permanent. Bara utkast
            utan historik kan tas bort.
          </>
        }
        confirmLabel="Ta bort"
        danger
        loading={del.isPending}
        error={del.error instanceof Error ? del.error.message : null}
        onConfirm={() =>
          del.mutate(undefined, {
            onSuccess: () => void navigate('/admin/utmaningar'),
          })
        }
      />

      {showDuplicate && (
        <DuplicateChallengeSheet
          open
          onClose={() => setShowDuplicate(false)}
          source={challenge}
          onCreated={(id) => {
            setShowDuplicate(false);
            void navigate(`/admin/utmaningar/${id}`);
          }}
        />
      )}
    </>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.fact}>
      <span className={styles.factLabel}>{label}</span>
      <span className={styles.factValue}>{value}</span>
    </div>
  );
}
