import styles from './ChallengeRuleFields.module.css';

export interface ChallengeRuleValue {
  name: string;
  description: string;
  startDate: string;
  endDate: string;
  timezone: string;
  requiredMinutes: number;
  proofRequired: boolean;
  missedDayCost: number;
}

interface Props {
  value: ChallengeRuleValue;
  onChange: (patch: Partial<ChallengeRuleValue>) => void;
  /** Rule fields that are locked (active/started challenge). */
  locked?: boolean;
  /** End date can still be extended even when locked. */
  endDateEditable?: boolean;
}

const TIMEZONES = [
  'Europe/Stockholm',
  'Europe/Oslo',
  'Europe/Helsinki',
  'Europe/London',
  'UTC',
];

export function ChallengeRuleFields({
  value,
  onChange,
  locked = false,
  endDateEditable = false,
}: Props) {
  const ruleDisabled = locked;
  return (
    <div className={styles.fields}>
      <label className={styles.field}>
        <span>Namn</span>
        <input
          type="text"
          value={value.name}
          maxLength={120}
          onChange={(e) => onChange({ name: e.target.value })}
        />
      </label>

      <label className={styles.field}>
        <span>Beskrivning (valfritt)</span>
        <textarea
          value={value.description}
          maxLength={2000}
          rows={2}
          onChange={(e) => onChange({ description: e.target.value })}
        />
      </label>

      <div className={styles.row}>
        <label className={styles.field}>
          <span>Startdatum</span>
          <input
            type="date"
            value={value.startDate}
            disabled={ruleDisabled}
            onChange={(e) => onChange({ startDate: e.target.value })}
          />
        </label>
        <label className={styles.field}>
          <span>Slutdatum</span>
          <input
            type="date"
            value={value.endDate}
            disabled={ruleDisabled && !endDateEditable}
            onChange={(e) => onChange({ endDate: e.target.value })}
          />
        </label>
      </div>

      <label className={styles.field}>
        <span>Tidszon</span>
        <select
          value={value.timezone}
          disabled={ruleDisabled}
          onChange={(e) => onChange({ timezone: e.target.value })}
        >
          {TIMEZONES.map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </select>
      </label>

      <div className={styles.row}>
        <label className={styles.field}>
          <span>Krav per dag (minuter)</span>
          <input
            type="number"
            min={1}
            max={1440}
            value={value.requiredMinutes}
            disabled={ruleDisabled}
            onChange={(e) =>
              onChange({ requiredMinutes: Number(e.target.value) })
            }
          />
        </label>
        <label className={styles.field}>
          <span>Kostnad/missad dag (kr)</span>
          <input
            type="number"
            min={0}
            value={value.missedDayCost}
            disabled={ruleDisabled}
            onChange={(e) =>
              onChange({ missedDayCost: Number(e.target.value) })
            }
          />
        </label>
      </div>

      <label className={styles.checkbox}>
        <input
          type="checkbox"
          checked={value.proofRequired}
          disabled={ruleDisabled}
          onChange={(e) => onChange({ proofRequired: e.target.checked })}
        />
        <span>Bildbevis krävs för en godkänd dag</span>
      </label>

      {locked && (
        <p className={styles.lockNote}>
          Reglerna är låsta eftersom utmaningen är aktiv eller har startat.
          {endDateEditable ? ' Slutdatumet kan bara flyttas framåt.' : ''} Skapa
          en ny utmaning från denna för att ändra reglerna.
        </p>
      )}
    </div>
  );
}
