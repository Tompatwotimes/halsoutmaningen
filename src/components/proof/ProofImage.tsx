import { useMemo } from 'react';
import { mulberry32 } from '@/fixtures/rng';
import styles from './ProofImage.module.css';

export interface ProofImageProps {
  /** Deterministic seed — same entry always renders the same trace. */
  seed: number;
  activity?: string | null;
  className?: string;
}

/**
 * Placeholder proof visual for the fixture phase: a generated GPS-style route
 * trace. It reads as "someone's workout", not a database record, without
 * shipping fake photographs. Swap for the real signed-URL <img> in Fas 6.
 */
export function ProofImage({ seed, activity, className }: ProofImageProps) {
  const { path, dots } = useMemo(() => buildTrace(seed), [seed]);

  return (
    <div
      className={[styles.frame, className].filter(Boolean).join(' ')}
      role="img"
      aria-label={
        activity ? `Rutt för ${activity.toLowerCase()}` : 'Träningsrutt'
      }
    >
      <svg viewBox="0 0 320 240" className={styles.svg} aria-hidden="true">
        <defs>
          <linearGradient id={`sky-${String(seed)}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#16202b" />
            <stop offset="1" stopColor="#0d151d" />
          </linearGradient>
        </defs>
        <rect width="320" height="240" fill={`url(#sky-${String(seed)})`} />
        {[48, 96, 144, 192].map((y) => (
          <line
            key={y}
            x1="0"
            y1={y}
            x2="320"
            y2={y}
            className={styles.grid}
          />
        ))}
        {[64, 128, 192, 256].map((x) => (
          <line
            key={x}
            x1={x}
            y1="0"
            x2={x}
            y2="240"
            className={styles.grid}
          />
        ))}
        <path d={path} className={styles.routeGlow} />
        <path d={path} className={styles.route} />
        <circle cx={dots.start.x} cy={dots.start.y} r="5" className={styles.start} />
        <circle cx={dots.end.x} cy={dots.end.y} r="5" className={styles.end} />
      </svg>
      <span className={styles.badge}>{activity ?? 'Bildbevis'}</span>
    </div>
  );
}

interface Point {
  x: number;
  y: number;
}

function buildTrace(seed: number): {
  path: string;
  dots: { start: Point; end: Point };
} {
  const rng = mulberry32(seed || 1);
  const count = 6;
  const points: Point[] = Array.from({ length: count }, (_, i) => ({
    x: 28 + (264 / (count - 1)) * i + (rng() - 0.5) * 46,
    y: 40 + rng() * 160,
  }));
  const at = (i: number): Point =>
    points[Math.max(0, Math.min(points.length - 1, i))] ?? { x: 0, y: 0 };

  // Catmull-Rom → cubic Bézier for a smooth trace.
  const start = at(0);
  let d = `M ${start.x.toFixed(1)} ${start.y.toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return { path: d, dots: { start, end: at(points.length - 1) } };
}
