import type { SVGProps } from 'react';

/** The Hälsoutmaningen mark — a steady heartbeat line, not a gym motif. */
export function BrandMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 64 64" fill="none" aria-hidden="true" {...props}>
      <rect width="64" height="64" rx="15" fill="var(--c-surface-raised)" />
      <path
        d="M13 34h7l4.5 12L33 18l5.5 22 3.5-9 2.5 5H51"
        stroke="var(--c-accent)"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
