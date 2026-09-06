import { useSetWeightHidden } from './useWeight';
import styles from './WeightPrivacyToggle.module.css';

/**
 * "Dölj min vikt" switch. Reuses the `role="switch"` markup shape from
 * GameMasterSettingsPanel's private Toggle (not exported reusably — plan Task
 * 9 says duplicate the minimal markup rather than generalize it). Works before
 * any start weight exists — `set_weight_hidden` creates the profile row.
 */
export function WeightPrivacyToggle({
  challengeId,
  isHidden,
}: {
  challengeId: string;
  isHidden: boolean;
}) {
  const { mutate, isPending } = useSetWeightHidden();

  return (
    <div className={styles.row}>
      <span className={styles.text}>
        <span className={styles.label}>Dölj min vikt</span>
        <span className={styles.desc}>
          Startvikt, viktlogg, förändring, kurva och placering döljs för andra
          deltagare. Du och administratören ser fortfarande allt.
        </span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={isHidden}
        aria-label="Dölj min vikt"
        disabled={isPending}
        className={[styles.switch, isHidden && styles.switchOn]
          .filter(Boolean)
          .join(' ')}
        onClick={() => mutate({ challengeId, hidden: !isHidden })}
      >
        <span className={styles.knob} aria-hidden="true" />
      </button>
    </div>
  );
}
