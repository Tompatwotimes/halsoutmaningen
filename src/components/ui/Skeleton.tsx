import styles from './Skeleton.module.css';

export interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  radius?: string;
  className?: string;
}

export function Skeleton({ width, height, radius, className }: SkeletonProps) {
  return (
    <span
      className={[styles.skeleton, className].filter(Boolean).join(' ')}
      style={{
        width,
        height,
        borderRadius: radius,
      }}
      aria-hidden="true"
    />
  );
}

/** A full-width text-line skeleton stack. */
export function SkeletonText({ lines = 3 }: { lines?: number }) {
  return (
    <span className={styles.textStack} aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <span
          key={i}
          className={styles.skeleton}
          style={{ width: i === lines - 1 ? '60%' : '100%', height: '0.85rem' }}
        />
      ))}
    </span>
  );
}
