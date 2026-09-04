import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { ErrorState } from '@/components/feedback/ErrorState';
import type { GameMasterIntensity } from '@/features/game-master/types';
import {
  useGameMasterSettings,
  useUpdateGameMasterSettings,
} from './game-master-admin-api';
import styles from './GameMasterSettingsPanel.module.css';

/**
 * Game Master admin emergency brake (spec §16).
 *
 * The only controls are the ones the spec allows an admin: enable/disable the
 * subsystem, set intensity, and toggle which content types (private roasts,
 * public roasts, Arkivet) are allowed. There is deliberately NO way to pick a
 * participant, pick a template, or emit/trigger a roast — Game Master chooses
 * its own subjects, timing and text.
 *
 * "Spara" sends the whole form as one audited `update_game_master_settings`
 * RPC call.
 */

interface FormState {
  enabled: boolean;
  privateRoastsEnabled: boolean;
  publicRoastsEnabled: boolean;
  archiveEnabled: boolean;
  intensity: GameMasterIntensity;
}

/** A missing settings row means "defaults" — enabled, everything on, normal. */
const DEFAULTS: FormState = {
  enabled: true,
  privateRoastsEnabled: true,
  publicRoastsEnabled: true,
  archiveEnabled: true,
  intensity: 'normal',
};

const INTENSITY_OPTIONS: readonly {
  value: GameMasterIntensity;
  label: string;
}[] = [
  { value: 'low', label: 'Låg' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'Hög' },
];

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className={styles.toggleRow}>
      <span className={styles.toggleText}>
        <span className={styles.toggleLabel}>{label}</span>
        {description && (
          <span className={styles.toggleDesc}>{description}</span>
        )}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={[styles.switch, checked && styles.switchOn]
          .filter(Boolean)
          .join(' ')}
        onClick={() => onChange(!checked)}
      >
        <span className={styles.knob} aria-hidden="true" />
      </button>
    </div>
  );
}

export interface GameMasterSettingsPanelProps {
  challengeId: string;
}

export function GameMasterSettingsPanel({
  challengeId,
}: GameMasterSettingsPanelProps) {
  const query = useGameMasterSettings(challengeId);
  const update = useUpdateGameMasterSettings();

  const [form, setForm] = useState<FormState>(DEFAULTS);

  // Seed the form once the settings row (or its absence) has loaded.
  useEffect(() => {
    if (query.isSuccess) {
      const s = query.data;
      setForm(
        s
          ? {
              enabled: s.enabled,
              privateRoastsEnabled: s.privateRoastsEnabled,
              publicRoastsEnabled: s.publicRoastsEnabled,
              archiveEnabled: s.archiveEnabled,
              intensity: s.intensity,
            }
          : DEFAULTS,
      );
    }
  }, [query.isSuccess, query.data]);

  function patch(next: Partial<FormState>) {
    setForm((prev) => ({ ...prev, ...next }));
    // Any edit clears the previous save's "Sparat" / error feedback.
    if (update.isSuccess || update.isError) update.reset();
  }

  if (query.isLoading) {
    return (
      <Card title="Game Master">
        <Spinner label="Laddar inställningar…" />
      </Card>
    );
  }

  if (query.isError) {
    return (
      <Card title="Game Master">
        <ErrorState
          title="Inställningarna kunde inte hämtas"
          onRetry={() => void query.refetch()}
        />
      </Card>
    );
  }

  return (
    <div className={styles.wrap}>
      <Card title="Game Master">
        <p className={styles.lead}>
          Game Master är autonomt. Det väljer själv mottagare, tidpunkt och text
          — här styr du bara om det får köra och hur ofta.
        </p>

        <Toggle
          label="Aktiverat"
          description="Nödbroms. Av innebär att inga nya händelser skapas."
          checked={form.enabled}
          onChange={(v) => patch({ enabled: v })}
        />

        <div className={styles.field}>
          <span className={styles.fieldLabel}>Intensitet</span>
          <SegmentedControl
            ariaLabel="Intensitet"
            value={form.intensity}
            onChange={(intensity) => patch({ intensity })}
            options={INTENSITY_OPTIONS}
          />
        </div>
      </Card>

      <Card title="Innehåll">
        <Toggle
          label="Privata roasts"
          description="Händelser som bara mottagaren och administratörer ser."
          checked={form.privateRoastsEnabled}
          onChange={(v) => patch({ privateRoastsEnabled: v })}
        />
        <Toggle
          label="Publika roasts"
          description="Händelser som hela gruppen ser."
          checked={form.publicRoastsEnabled}
          onChange={(v) => patch({ publicRoastsEnabled: v })}
        />
        <Toggle
          label="Arkivet"
          description="Publik historik. Av döljer Arkivet för deltagarna."
          checked={form.archiveEnabled}
          onChange={(v) => patch({ archiveEnabled: v })}
        />
      </Card>

      <div className={styles.saveRow}>
        <Button
          loading={update.isPending}
          onClick={() =>
            update.mutate({
              challengeId,
              enabled: form.enabled,
              privateRoastsEnabled: form.privateRoastsEnabled,
              publicRoastsEnabled: form.publicRoastsEnabled,
              archiveEnabled: form.archiveEnabled,
              intensity: form.intensity,
            })
          }
        >
          Spara
        </Button>
        {update.isSuccess && (
          <span className={styles.saved} role="status">
            Sparat
          </span>
        )}
        {update.isError && (
          <span className={styles.error} role="alert">
            {update.error.message}
          </span>
        )}
      </div>
    </div>
  );
}
