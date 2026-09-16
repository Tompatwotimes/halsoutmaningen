import { useId } from 'react';
import type { CSSProperties } from 'react';
import styles from './DoublePassStar.module.css';

/**
 * DOUBLE-PASS GOLD STAR (v1.11.0) — Översikt-only prestige marker.
 * Purely decorative: zero gameplay effect (CLAUDE.md §15/§20 equivalent —
 * no points, streak, liability or ranking change). The actual accessible
 * meaning ("Dubbelpass genomfört") is carried by the parent `StatusCell`'s
 * aria-label; this component is `aria-hidden` and renders nothing to
 * assistive tech on its own.
 *
 * Six-layer look, all achieved with a single small inline SVG + CSS
 * (no canvas/rAF/JS timers — GPU-friendly transform/opacity only):
 *  A) metallic multi-stop gold gradient body (dark bronze → bright champagne)
 *  B) darker bronze edge stroke for depth
 *  C) a static specular highlight ellipse (survives reduced-motion)
 *  D) a narrow shimmer band that sweeps the star and rests most of the cycle
 *  E) a small warm outer glow (CSS drop-shadow, static — cheap to paint)
 *  F) intentionally NO micro-sparkle — tried, looked tacky at 24px cell size
 */

const STAR_PATH =
  'M12,2 L14.53,8.52 L21.51,8.91 L16.09,13.33 L17.88,20.09 ' +
  'L12,16.3 L6.12,20.09 L7.91,13.33 L2.49,8.91 L9.47,8.52 Z';

/** ~3.2s shimmer cycle — within the required 2.5–4s range. */
const CYCLE_MS = 3200;

/**
 * Deterministic (non-random) phase offset from a stable seed, so several
 * gold stars visible at once (adjacent double-pass days) desync instead of
 * flashing in unison. A negative `animation-delay` starts the loop already
 * partway through — no JS timers, no per-star randomness at render time.
 */
function phaseOffsetMs(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) {
    h = (h * 31 + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % CYCLE_MS;
}

interface Props {
  /** Stable per-cell key (e.g. `${userId}:${date}`) for shimmer desync. */
  seed?: string | undefined;
  className?: string | undefined;
}

export function DoublePassStar({ seed, className }: Props) {
  const uid = useId();
  const bodyGrad = `hu-dps-body-${uid}`;
  const specGrad = `hu-dps-spec-${uid}`;
  const shimmerGrad = `hu-dps-shimmer-${uid}`;
  const clip = `hu-dps-clip-${uid}`;

  const style: CSSProperties | undefined = seed
    ? ({
        '--hu-star-delay': `-${String(phaseOffsetMs(seed))}ms`,
      } as CSSProperties)
    : undefined;

  return (
    <span
      className={[styles.wrap, className].filter(Boolean).join(' ')}
      aria-hidden="true"
      data-testid="double-pass-star"
      style={style}
    >
      <svg
        viewBox="0 0 24 24"
        className={styles.svg}
        focusable="false"
        aria-hidden="true"
      >
        <defs>
          <linearGradient
            id={bodyGrad}
            x1="2"
            y1="2"
            x2="22"
            y2="22"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" className={styles.stop1} />
            <stop offset="20%" className={styles.stop2} />
            <stop offset="45%" className={styles.stop3} />
            <stop offset="60%" className={styles.stop4} />
            <stop offset="75%" className={styles.stop5} />
            <stop offset="100%" className={styles.stop6} />
          </linearGradient>
          <radialGradient id={specGrad} cx="35%" cy="30%" r="55%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.85" />
            <stop offset="60%" stopColor="#ffffff" stopOpacity="0.16" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </radialGradient>
          <linearGradient id={shimmerGrad} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
            <stop offset="50%" stopColor="#ffffff" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
          <clipPath id={clip}>
            <path d={STAR_PATH} />
          </clipPath>
        </defs>

        <path
          d={STAR_PATH}
          fill={`url(#${bodyGrad})`}
          className={styles.body}
        />

        <ellipse
          cx="9.4"
          cy="7.6"
          rx="3.6"
          ry="2.1"
          transform="rotate(-18 9.4 7.6)"
          fill={`url(#${specGrad})`}
          className={styles.specular}
        />

        <g clipPath={`url(#${clip})`}>
          <rect
            x="-8"
            y="-4"
            width="8"
            height="32"
            fill={`url(#${shimmerGrad})`}
            className={styles.shimmer}
          />
        </g>
      </svg>
    </span>
  );
}
