import { useMemo } from 'react';
import { challengeDates, type ChallengeConfig } from '@/domain/challenge';
import { DayState } from '@/domain/dayState';
import { parsePlainDate } from '@/domain/dates';
import { statusMeta } from '@/components/status/statusMeta';
import { CheckIcon, MissedIcon } from '@/components/icons';
import type { ParticipantView } from '@/features/challenge/types';
import styles from './PersonalCalendar.module.css';

const MONTHS_SV = [
  'Januari',
  'Februari',
  'Mars',
  'April',
  'Maj',
  'Juni',
  'Juli',
  'Augusti',
  'September',
  'Oktober',
  'November',
  'December',
];
const WD = ['M', 'T', 'O', 'T', 'F', 'L', 'S'];

interface Props {
  challenge: ChallengeConfig;
  today: string;
  participant: ParticipantView;
  onOpenDay: (date: string) => void;
}

/** Monday-first index (0=Mon … 6=Sun). */
function mondayIndex(plainDate: string): number {
  const { year, month, day } = parsePlainDate(plainDate);
  return (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
}

export function PersonalCalendar({
  challenge,
  today,
  participant,
  onOpenDay,
}: Props) {
  const months = useMemo(() => {
    const groups = new Map<string, string[]>();
    for (const date of challengeDates(challenge)) {
      const { year, month } = parsePlainDate(date);
      const key = `${String(year)}-${String(month)}`;
      const list = groups.get(key) ?? [];
      list.push(date);
      groups.set(key, list);
    }
    return [...groups.entries()].map(([key, dates]) => {
      const parts = key.split('-');
      return { monthNum: Number(parts[1]), dates };
    });
  }, [challenge]);

  return (
    <div className={styles.wrap}>
      {months.map(({ monthNum, dates }) => {
        const first = dates[0];
        const lead = first ? mondayIndex(first) : 0;
        return (
          <div key={monthNum} className={styles.month}>
            <p className={styles.monthName}>{MONTHS_SV[monthNum - 1]}</p>
            <div className={styles.weekdays}>
              {WD.map((d, i) => (
                <span key={i}>{d}</span>
              ))}
            </div>
            <div className={styles.grid}>
              {Array.from({ length: lead }, (_, i) => (
                <span key={`b${String(i)}`} />
              ))}
              {dates.map((date) => {
                const state =
                  participant.statesByDate.get(date) ??
                  DayState.NotParticipating;
                const { day } = parsePlainDate(date);
                const meta = statusMeta(state);
                const isToday = date === today;
                const canOpen = state === DayState.Completed;
                const cls = [
                  styles.day,
                  styles[meta.tone],
                  isToday && styles.today,
                ]
                  .filter(Boolean)
                  .join(' ');
                const inner = (
                  <>
                    <span className={styles.num}>{day}</span>
                    {state === DayState.Completed && (
                      <CheckIcon className={styles.glyph} />
                    )}
                    {state === DayState.Missed && (
                      <MissedIcon className={styles.glyph} />
                    )}
                  </>
                );
                return canOpen ? (
                  <button
                    key={date}
                    type="button"
                    className={cls}
                    onClick={() => onOpenDay(date)}
                    aria-label={`${String(day)}: ${meta.label}`}
                  >
                    {inner}
                  </button>
                ) : (
                  <span
                    key={date}
                    className={cls}
                    aria-label={`${String(day)}: ${meta.label}`}
                  >
                    {inner}
                  </span>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
