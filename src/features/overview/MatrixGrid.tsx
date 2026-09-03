import { useEffect, useMemo, useRef, useImperativeHandle } from 'react';
import type { Ref } from 'react';
import type { ChallengeConfig } from '@/domain/challenge';
import { DayState } from '@/domain/dayState';
import { compareDates, enumerateDates, parsePlainDate } from '@/domain/dates';
import { formatPercent } from '@/domain/format';
import { Avatar } from '@/components/ui/Avatar';
import { StatusCell } from '@/components/status/StatusCell';
import { statusMeta } from '@/components/status/statusMeta';
import { weekdayShort, capitalize } from '@/features/challenge/labels';
import type { ParticipantView } from '@/features/challenge/types';
import styles from './MatrixGrid.module.css';

const MONTHS_SV = [
  'jan',
  'feb',
  'mar',
  'apr',
  'maj',
  'jun',
  'jul',
  'aug',
  'sep',
  'okt',
  'nov',
  'dec',
];

export interface MatrixGridHandle {
  scrollToToday: () => void;
}

interface Props {
  challenge: ChallengeConfig;
  today: string;
  participants: ParticipantView[];
  onOpenEntry: (participant: ParticipantView, date: string) => void;
  handleRef?: Ref<MatrixGridHandle>;
}

export function MatrixGrid({
  challenge,
  today,
  participants,
  onOpenEntry,
  handleRef,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // The shared matrix always spans the FULL challenge period — every column
  // from start_date to end_date. Days before a participant's own window render
  // as `not_participating` ("—"), never hidden (CLAUDE.md §5.4).
  const dates = useMemo(
    () => enumerateDates(challenge.startDate, challenge.endDate),
    [challenge.startDate, challenge.endDate],
  );
  const todayIndex = dates.indexOf(today);
  // Where the viewport rests on open and on "Hoppa till idag": today while the
  // challenge is running, otherwise the near end — the start for a not-yet-
  // started challenge, the end for a finished one.
  const focusIndex =
    todayIndex >= 0
      ? todayIndex
      : compareDates(today, challenge.startDate) < 0
        ? 0
        : dates.length - 1;

  const months = useMemo(() => {
    const groups: { key: string; label: string; count: number }[] = [];
    for (const date of dates) {
      const { year, month } = parsePlainDate(date);
      const key = `${String(year)}-${String(month)}`;
      const last = groups[groups.length - 1];
      if (last?.key === key) last.count += 1;
      else
        groups.push({
          key,
          label: `${MONTHS_SV[month - 1] ?? ''} ${String(year).slice(2)}`,
          count: 1,
        });
    }
    return groups;
  }, [dates]);

  const CELL_W = 22; // px, keep in sync with --cell-w
  const focusOffset = (clientWidth: number) =>
    focusIndex * CELL_W - clientWidth / 2 + CELL_W;

  useImperativeHandle(handleRef, () => ({
    scrollToToday: () => {
      const el = scrollRef.current;
      if (!el || focusIndex < 0) return;
      el.scrollTo({ left: focusOffset(el.clientWidth), behavior: 'smooth' });
    },
  }));

  useEffect(() => {
    const el = scrollRef.current;
    if (el && focusIndex >= 0) {
      el.scrollLeft = focusOffset(el.clientWidth);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusIndex]);

  return (
    <div className={`${styles.scroll} scroll-x`} ref={scrollRef}>
      <div className={styles.inner}>
        {/* Month band */}
        <div className={styles.monthRow}>
          <div className={styles.cornerWide} />
          {months.map((m) => (
            <div
              key={m.key}
              className={styles.monthLabel}
              style={{ width: `calc(${String(m.count)} * var(--cell-w))` }}
            >
              {m.label}
            </div>
          ))}
        </div>

        {/* Day numbers */}
        <div className={styles.dayRow}>
          <div className={styles.cornerWide}>Deltagare</div>
          {dates.map((date) => {
            const { day } = parsePlainDate(date);
            const isToday = date === today;
            const wd = weekdayShort(date).charAt(0).toUpperCase();
            const weekend = wd === 'L' || wd === 'S';
            return (
              <div
                key={date}
                className={[
                  styles.dayNum,
                  isToday && styles.todayCol,
                  weekend && styles.weekend,
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <span className={styles.wd}>{wd}</span>
                <span className={styles.dn}>{day}</span>
              </div>
            );
          })}
        </div>

        {/* Rows */}
        <ul className={styles.rows}>
          {participants.map((p) => (
            <li key={p.userId} className={styles.row}>
              <div
                className={[styles.nameCell, p.isSelf && styles.selfName]
                  .filter(Boolean)
                  .join(' ')}
              >
                <Avatar name={p.displayName} size="xs" ring={p.isSelf} />
                <span className={styles.nameText}>
                  <span className={styles.name}>
                    {p.displayName.split(' ')[0]}
                  </span>
                  <span className={styles.pct}>
                    {formatPercent(p.completionRate * 100)}
                  </span>
                </span>
              </div>
              {dates.map((date) => {
                const state =
                  p.statesByDate.get(date) ?? DayState.NotParticipating;
                const isToday = date === today;
                return (
                  <div
                    key={date}
                    className={[styles.cellWrap, isToday && styles.todayCol]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <StatusCell
                      state={state}
                      size="sm"
                      today={isToday}
                      penalised={
                        p.requirementByDate.get(date)?.penaltyType != null
                      }
                      onClick={
                        state === DayState.Completed ||
                        (p.isSelf && state === DayState.Missed)
                          ? () => onOpenEntry(p, date)
                          : undefined
                      }
                      ariaLabel={`${p.displayName}, ${capitalize(
                        weekdayShort(date),
                      )} ${String(parsePlainDate(date).day)}: ${statusMeta(state).label}`}
                    />
                  </div>
                );
              })}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
