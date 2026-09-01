import type { HTMLAttributes, ReactNode } from 'react';
import styles from './Badge.module.css';

type Tone =
  | 'neutral'
  | 'accent'
  | 'completed'
  | 'missed'
  | 'pending'
  | 'future';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  /** Leading dot marker. */
  dot?: boolean;
  icon?: ReactNode;
  size?: 'sm' | 'md';
}

function cx(...parts: (string | false | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

export function Badge({
  tone = 'neutral',
  dot = false,
  icon,
  size = 'md',
  className,
  children,
  ...rest
}: BadgeProps) {
  return (
    <span
      className={cx(styles.badge, styles[tone], styles[size], className)}
      {...rest}
    >
      {dot && <span className={styles.dot} aria-hidden="true" />}
      {icon && (
        <span className={styles.icon} aria-hidden="true">
          {icon}
        </span>
      )}
      {children}
    </span>
  );
}
