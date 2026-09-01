import { useMemo } from 'react';
import styles from './Avatar.module.css';

export interface AvatarProps {
  name: string;
  src?: string | null;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  /** Adds a subtle ring — used to mark "you". */
  ring?: boolean;
  className?: string;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0];
  if (first === undefined) return '?';
  if (parts.length === 1) return first.slice(0, 2).toUpperCase();
  const last = parts[parts.length - 1] ?? first;
  return `${first[0] ?? ''}${last[0] ?? ''}`.toUpperCase();
}

/** Stable hue from a name so each participant keeps one identity colour. */
function hueFor(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash << 5) - hash + name.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % 360;
}

export function Avatar({
  name,
  src,
  size = 'md',
  ring = false,
  className,
}: AvatarProps) {
  const hue = useMemo(() => hueFor(name), [name]);
  const style = {
    '--avatar-bg': `hsl(${String(hue)} 42% 24%)`,
    '--avatar-fg': `hsl(${String(hue)} 70% 82%)`,
  } as React.CSSProperties;

  return (
    <span
      className={[styles.avatar, styles[size], ring && styles.ring, className]
        .filter(Boolean)
        .join(' ')}
      style={style}
      aria-hidden="true"
    >
      {src ? (
        <img src={src} alt="" className={styles.img} />
      ) : (
        <span className={styles.initials}>{initials(name)}</span>
      )}
    </span>
  );
}
