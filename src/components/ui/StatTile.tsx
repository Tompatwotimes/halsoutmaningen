import type { ReactNode } from 'react';
import styles from './StatTile.module.css';

export interface StatTileProps {
  label: string;
  value: ReactNode;
  /** Small unit or suffix shown next to the value (e.g. "dagar", "%"). */
  unit?: string;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: 'default' | 'completed' | 'missed' | 'pending' | 'accent';
  className?: string;
}

export function StatTile({
  label,
  value,
  unit,
  hint,
  icon,
  tone = 'default',
  className,
}: StatTileProps) {
  return (
    <div
      className={[styles.tile, styles[tone], className]
        .filter(Boolean)
        .join(' ')}
    >
      <div className={styles.labelRow}>
        {icon && (
          <span className={styles.icon} aria-hidden="true">
            {icon}
          </span>
        )}
        <span className={styles.label}>{label}</span>
      </div>
      <div className={styles.valueRow}>
        <span className={`${styles.value} tnum`}>{value}</span>
        {unit && <span className={styles.unit}>{unit}</span>}
      </div>
      {hint != null && <span className={styles.hint}>{hint}</span>}
    </div>
  );
}
