import type { LiabilityBreakdown } from '@/domain/liability';
import { formatSek } from '@/domain/format';
import { Card } from '@/components/ui/Card';
import { ProgressBar } from '@/components/ui/ProgressBar';
import styles from './LiabilityCard.module.css';

interface Props {
  liability: LiabilityBreakdown;
  missedDayCost: number;
  /** Tighter layout for the home screen. */
  compact?: boolean;
}

/**
 * Financial challenge liability, with language that keeps the four amounts
 * distinct (docs/PRODUCT_SPEC.md §16). Future days are "möjlig" exposure,
 * never presented as a debt.
 */
export function LiabilityCard({ liability, missedDayCost, compact }: Props) {
  const { confirmedDebt, clearedAmount, remainingExposure, missedDays } =
    liability;
  const decidedTotal = clearedAmount + confirmedDebt;
  const clearedRatio = decidedTotal === 0 ? 1 : clearedAmount / decidedTotal;

  return (
    <Card title="Ekonomi">
      <div className={styles.headline}>
        <span className={`${styles.debt} tnum`}>
          {formatSek(confirmedDebt)}
        </span>
        <span className={styles.debtLabel}>
          skuld hittills{' '}
          <span className={styles.debtSub}>
            ({missedDays} missade {missedDays === 1 ? 'dag' : 'dagar'} ×{' '}
            {formatSek(missedDayCost)})
          </span>
        </span>
      </div>

      <ProgressBar
        value={clearedRatio}
        tone="completed"
        label="Andel avklarade dagar av hittills avgjorda"
      />
      <p className={styles.barCaption}>
        <span className={styles.cleared}>
          {formatSek(clearedAmount)} säkrat
        </span>
        <span className={styles.dot}>·</span>
        avgjorda dagar hittills
      </p>

      {!compact && (
        <dl className={styles.grid}>
          <div>
            <dt>Möjlig kvarvarande</dt>
            <dd className="tnum">{formatSek(remainingExposure)}</dd>
            <span className={styles.hint}>
              om alla återstående dagar missas
            </span>
          </div>
          <div>
            <dt>Max för din period</dt>
            <dd className="tnum">
              {formatSek(liability.maxApplicableLiability)}
            </dd>
            <span className={styles.hint}>
              {liability.eligibleDays} berättigade dagar
            </span>
          </div>
        </dl>
      )}
    </Card>
  );
}
