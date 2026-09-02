import { PenaltyType } from '@/domain/penalties';
import { SkullIcon } from '@/components/icons';
import type { DayRequirement } from '@/features/challenge/types';
import styles from './PenaltyBadge.module.css';

interface Props {
  requirement: Pick<
    DayRequirement,
    'penaltyType' | 'penaltyDisplayName' | 'requiredMinutes'
  >;
  size?: 'sm' | 'md';
}

/**
 * Compact "you have a penalty" marker for grids and cards — `☠ 60 MIN` /
 * `☠ DUBBELPASS`. Renders nothing on a normal day. Uses the missed/clay status
 * family so it reads as friction, not as the brand.
 */
export function PenaltyBadge({ requirement, size = 'md' }: Props) {
  if (requirement.penaltyType === null) return null;

  const text =
    requirement.penaltyType === PenaltyType.DoubleSession
      ? 'Dubbelpass'
      : `${String(requirement.requiredMinutes)} min`;

  return (
    <span
      className={`${styles.badge} ${styles[size]}`}
      title={requirement.penaltyDisplayName ?? undefined}
    >
      <SkullIcon className={styles.icon} aria-hidden="true" />
      <span className={styles.text}>{text}</span>
    </span>
  );
}

/** Tiny corner dot for a status-grid cell that carries a penalty. */
export function PenaltyDot({ className }: { className?: string }) {
  return (
    <span
      className={`${styles.dot}${className ? ` ${className}` : ''}`}
      aria-hidden="true"
    />
  );
}
