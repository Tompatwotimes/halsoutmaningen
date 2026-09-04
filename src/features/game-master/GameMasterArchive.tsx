import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/feedback/EmptyState';
import { FlagIcon } from '@/components/icons';
import { formatLongDate } from '@/domain/format';
import { capitalize, weekdayLong } from '@/features/challenge/labels';
import { useGameMasterArchive } from './useGameMaster';
import styles from './GameMasterArchive.module.css';

/**
 * Arkivet — the Game Master's public chronicle (spec §9).
 *
 * This is a *chronicle*, deliberately not a social feed: no likes, no comments,
 * no replies, no participant post-composer, no sixth bottom-nav tab. It only
 * lists what the server already froze and published: `fetchGameMasterArchive`
 * returns public + `archive=true` + `status='active'` events, newest first, so
 * this component adds no visibility logic of its own — it renders the hook's
 * result in order.
 *
 * Game Master is optional and isolated (spec §2). `useGameMasterArchive` is
 * `retry:false` + `throwOnError:false`, and a failed read here degrades to a
 * quiet empty state — never a page-level `ErrorState`/`role="alert"`. Arkivet
 * being unavailable is not a page error.
 */

const FAMILY_LABELS: Record<string, string> = {
  missed_day: 'Avvikelse',
  streak_long: 'Status',
  streak_broken: 'Fall',
  debt_leader: 'Ekonomi',
  kassan: 'Kassan',
  comeback: 'Återkomst',
  ranking_position: 'Placering',
  historic_callback: 'Historik',
  general_system: 'System',
};

function familyLabel(family: string): string {
  return FAMILY_LABELS[family] ?? 'System';
}

/**
 * `starts_at` is stamped `now()` in the same transaction that freezes the
 * event, so it is the chronicle date. GM1 pulses fire mid-day or at 08/20
 * challenge-local, none of which cross midnight in UTC, so the calendar date of
 * the ISO timestamp is the challenge-local date. Formatted like the rest of the
 * app (weekday + long date).
 */
function chronicleDate(startsAt: string): string {
  const plain = startsAt.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(plain)) return '';
  return `${capitalize(weekdayLong(plain))} ${formatLongDate(plain)}`;
}

export interface GameMasterArchiveProps {
  challengeId: string | null;
}

export function GameMasterArchive({ challengeId }: GameMasterArchiveProps) {
  const query = useGameMasterArchive(challengeId);

  if (query.isLoading) {
    return (
      <div className={styles.list} aria-busy="true">
        <Skeleton height="7rem" radius="var(--radius-lg)" />
        <Skeleton height="7rem" radius="var(--radius-lg)" />
        <Skeleton height="7rem" radius="var(--radius-lg)" />
      </div>
    );
  }

  if (query.isError) {
    return (
      <EmptyState
        icon={<FlagIcon />}
        title="Arkivet är tomt just nu."
        body="Systemet skriver historien när det har något att säga."
      />
    );
  }

  const events = query.data ?? [];

  if (events.length === 0) {
    return (
      <EmptyState
        icon={<FlagIcon />}
        title="Systemet har inte skrivit något än."
        body="Publika noteringar från Systemet dyker upp här."
      />
    );
  }

  return (
    <ol className={styles.list}>
      {events.map((event) => (
        <li key={event.id} className={styles.entry}>
          <div className={styles.meta}>
            <time className={styles.date}>{chronicleDate(event.startsAt)}</time>
            <Badge tone="neutral" size="sm">
              {familyLabel(event.family)}
            </Badge>
          </div>
          <p className={styles.title}>{event.title}</p>
          <p className={styles.body}>{event.body}</p>
        </li>
      ))}
    </ol>
  );
}
