import { useEffect, useRef } from 'react';
import { DayState } from '@/domain/dayState';
import { formatDayMonth } from '@/domain/format';
import { Avatar } from '@/components/ui/Avatar';
import { StatusCell } from '@/components/status/StatusCell';
import { statusMeta } from '@/components/status/statusMeta';
import type { ParticipantView } from '@/fixtures/dataset';
import { relativeDayLabel, capitalize } from '@/features/challenge/labels';
import styles from './RecentGrid.module.css';

interface Props {
  today: string;
  dates: string[];
  participants: ParticipantView[];
  onOpenEntry: (participant: ParticipantView, date: string) => void;
}

/**
 * The signature recent-days accountability grid: a sticky participant column
 * and horizontally scrollable day columns, anchored on today. Not a styled
 * <table> — a scroll region built for the phone (CLAUDE.md §13, design north
 * star — group dashboard).
 */
export function RecentGrid({ today, dates, participants, onOpenEntry }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [dates.length]);

  return (
    <div className={`${styles.scroll} scroll-x`} ref={scrollRef}>
      <div
        className={styles.inner}
        role="table"
        aria-label="Träningsstatus de senaste dagarna"
      >
        <div className={styles.headRow} role="row">
          <div className={styles.cornerCell} role="columnheader">
            Deltagare
          </div>
          {dates.map((date) => {
            const isToday = date === today;
            return (
              <div
                key={date}
                role="columnheader"
                className={[styles.dayHead, isToday && styles.todayCol]
                  .filter(Boolean)
                  .join(' ')}
              >
                <span className={styles.dayLabel}>
                  {capitalize(relativeDayLabel(date, today))}
                </span>
                <span className={styles.dayDate}>{formatDayMonth(date)}</span>
              </div>
            );
          })}
        </div>

        <ul className={styles.rows} role="rowgroup">
          {participants.map((p) => (
            <li key={p.userId} className={styles.row} role="row">
              <div
                role="rowheader"
                className={[styles.nameCell, p.isSelf && styles.selfName]
                  .filter(Boolean)
                  .join(' ')}
              >
                <Avatar name={p.displayName} size="sm" ring={p.isSelf} />
                <span className={styles.name}>
                  {p.displayName.split(' ')[0]}
                  {p.isSelf && <span className={styles.youTag}>du</span>}
                </span>
              </div>
              {dates.map((date) => {
                const state =
                  p.statesByDate.get(date) ?? DayState.NotParticipating;
                const isToday = date === today;
                const meta = statusMeta(state);
                return (
                  <div
                    key={date}
                    role="cell"
                    className={[styles.cell, isToday && styles.todayCol]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <StatusCell
                      state={state}
                      today={isToday}
                      size="md"
                      onClick={
                        state === DayState.Completed
                          ? () => onOpenEntry(p, date)
                          : undefined
                      }
                      ariaLabel={`${p.displayName}, ${relativeDayLabel(
                        date,
                        today,
                      ).toLowerCase()}: ${meta.label}`}
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
