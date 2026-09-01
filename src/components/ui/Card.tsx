import type { ElementType, HTMLAttributes, ReactNode } from 'react';
import styles from './Card.module.css';

type Variant = 'default' | 'raised' | 'sunken' | 'gradient' | 'bare';
type Padding = 'none' | 'sm' | 'md' | 'lg';

export interface CardProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  /** Small uppercase eyebrow shown at the top of the card. */
  title?: ReactNode;
  /** Element rendered on the right side of the header row. */
  action?: ReactNode;
  variant?: Variant;
  padding?: Padding;
  as?: ElementType;
}

function cx(...parts: (string | false | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

export function Card({
  title,
  action,
  variant = 'default',
  padding = 'md',
  as,
  children,
  className,
  ...rest
}: CardProps) {
  const Component = as ?? 'section';
  return (
    <Component
      className={cx(
        styles.card,
        styles[variant],
        styles[`pad-${padding}`],
        className,
      )}
      {...rest}
    >
      {(title ?? action) && (
        <header className={styles.header}>
          {title && <span className={styles.title}>{title}</span>}
          {action && <div className={styles.action}>{action}</div>}
        </header>
      )}
      {children}
    </Component>
  );
}
