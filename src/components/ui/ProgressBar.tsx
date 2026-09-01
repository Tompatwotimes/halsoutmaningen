import styles from './ProgressBar.module.css';

export interface ProgressBarProps {
  /** 0–1. */
  value: number;
  tone?: 'accent' | 'completed' | 'pending' | 'missed' | 'neutral';
  /** Optional second value drawn as a fainter segment behind `value`. */
  trackValue?: number;
  size?: 'sm' | 'md';
  label?: string;
  className?: string;
}

const TONE_VAR: Record<NonNullable<ProgressBarProps['tone']>, string> = {
  accent: 'var(--c-accent)',
  completed: 'var(--c-completed)',
  pending: 'var(--c-pending)',
  missed: 'var(--c-missed)',
  neutral: 'var(--c-text-faint)',
};

export function ProgressBar({
  value,
  tone = 'accent',
  trackValue,
  size = 'md',
  label,
  className,
}: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(1, value));
  const track =
    trackValue == null ? null : Math.max(0, Math.min(1, trackValue));

  return (
    <div
      className={[styles.bar, styles[size], className]
        .filter(Boolean)
        .join(' ')}
      role="progressbar"
      aria-valuenow={Math.round(clamped * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      {track != null && (
        <span
          className={styles.ghost}
          style={{ width: `${String(track * 100)}%` }}
        />
      )}
      <span
        className={styles.fill}
        style={{
          width: `${String(clamped * 100)}%`,
          background: TONE_VAR[tone],
        }}
      />
    </div>
  );
}
