import { DayState } from '@/domain/dayState';
import { StatusCell } from './StatusCell';
import { statusMeta } from './statusMeta';
import styles from './StatusLegend.module.css';

const ORDER: DayState[] = [
  DayState.Completed,
  DayState.Missed,
  DayState.Pending,
  DayState.Future,
  DayState.NotParticipating,
];

export function StatusLegend({
  states = ORDER,
}: {
  states?: DayState[];
}) {
  return (
    <ul className={styles.legend}>
      {states.map((state) => (
        <li key={state} className={styles.item}>
          <StatusCell state={state} size="sm" />
          <span>{statusMeta(state).label}</span>
        </li>
      ))}
    </ul>
  );
}
