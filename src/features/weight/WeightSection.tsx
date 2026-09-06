import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { ChevronRightIcon } from '@/components/icons';
import { StartWeightCard } from './StartWeightCard';
import { WeightLogCard } from './WeightLogCard';
import { WeightPrivacyToggle } from './WeightPrivacyToggle';
import { useMyWeightProfile } from './useWeight';
import styles from './WeightSection.module.css';

/**
 * The weight block under Profile. Not a nav destination — training stays the
 * product; this is one section among the existing Profile cards. The public
 * ranking is reached by the link here, the way /arkivet is reached from a card
 * on GroupPage (no bottom-nav slot).
 */
export function WeightSection({
  challengeId,
  userId,
  today,
}: {
  challengeId: string;
  userId: string;
  today: string;
}) {
  const { data } = useMyWeightProfile(challengeId, userId);

  return (
    <div className={styles.section}>
      <h2 className={styles.heading}>Vikt &amp; Viktkampen</h2>

      <StartWeightCard challengeId={challengeId} userId={userId} />
      <WeightLogCard challengeId={challengeId} userId={userId} today={today} />

      <Card title="Sekretess">
        <WeightPrivacyToggle
          challengeId={challengeId}
          isHidden={data?.isWeightHidden ?? false}
        />
      </Card>

      <Link to="/viktkampen" className={styles.rankingLink}>
        <span>Se hela Viktkampen</span>
        <ChevronRightIcon className={styles.chevron} />
      </Link>
    </div>
  );
}
