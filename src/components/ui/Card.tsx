import type { HTMLAttributes, ReactNode } from 'react';
import styles from './Card.module.css';

export interface CardProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title?: ReactNode;
  action?: ReactNode;
}

export function Card({
  title,
  action,
  children,
  className,
  ...rest
}: CardProps) {
  return (
    <section
      className={[styles.card, className].filter(Boolean).join(' ')}
      {...rest}
    >
      {(title ?? action) && (
        <header className={styles.header}>
          {title && <span className={styles.title}>{title}</span>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}
