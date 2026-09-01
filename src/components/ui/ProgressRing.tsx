import type { ReactNode } from 'react';
import styles from './ProgressRing.module.css';

export interface ProgressRingProps {
  /** 0–1. */
  value: number;
  size?: number;
  stroke?: number;
  tone?: 'accent' | 'completed' | 'pending' | 'missed';
  /** Content rendered in the centre. */
  children?: ReactNode;
  /** Accessible description of what the ring represents. */
  label?: string;
  className?: string;
}

const TONE_VAR: Record<NonNullable<ProgressRingProps['tone']>, string> = {
  accent: 'var(--c-accent)',
  completed: 'var(--c-completed)',
  pending: 'var(--c-pending)',
  missed: 'var(--c-missed)',
};

export function ProgressRing({
  value,
  size = 132,
  stroke = 10,
  tone = 'accent',
  children,
  label,
  className,
}: ProgressRingProps) {
  const clamped = Math.max(0, Math.min(1, value));
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const dash = circumference * clamped;

  return (
    <div
      className={[styles.wrap, className].filter(Boolean).join(' ')}
      style={{ width: size, height: size }}
      role="img"
      aria-label={
        label ? `${label}: ${String(Math.round(clamped * 100))} %` : undefined
      }
    >
      <svg
        className={styles.svg}
        viewBox={`0 0 ${String(size)} ${String(size)}`}
        aria-hidden="true"
      >
        <circle
          className={styles.track}
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
        />
        <circle
          className={styles.indicator}
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          strokeDasharray={`${String(dash)} ${String(circumference)}`}
          style={{ stroke: TONE_VAR[tone] }}
        />
      </svg>
      {children != null && <div className={styles.center}>{children}</div>}
    </div>
  );
}
