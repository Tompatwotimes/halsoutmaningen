import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { isIos, isStandalone } from '@/features/pwa/install';
import { useInstallPrompt } from '@/features/pwa/useInstallPrompt';
import {
  useNotificationPreferences,
  usePushSubscription,
  useSendSelfTestPush,
  useUpdateNotificationPreferences,
} from './usePush';
import type { NotificationPreferences } from './preferences-api';
import styles from './NotificationsCard.module.css';

interface ToggleRowProps {
  label: string;
  desc: string;
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
}

function ToggleRow({
  label,
  desc,
  checked,
  disabled,
  onChange,
}: ToggleRowProps) {
  return (
    <div className={styles.row}>
      <span className={styles.text}>
        <span className={styles.label}>{label}</span>
        <span className={styles.desc}>{desc}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        className={[styles.switch, checked && styles.switchOn]
          .filter(Boolean)
          .join(' ')}
        onClick={onChange}
      >
        <span className={styles.knob} aria-hidden="true" />
      </button>
    </div>
  );
}

const CATEGORY_ROWS: {
  key: keyof NotificationPreferences;
  label: string;
  desc: string;
}[] = [
  {
    key: 'chatReply',
    label: 'Svar i chatten',
    desc: 'När någon svarar på ditt meddelande.',
  },
  {
    key: 'chatLike',
    label: 'Gillningar i chatten',
    desc: 'När någon gillar ditt meddelande.',
  },
  {
    key: 'chatAllMessages',
    label: 'Alla chattmeddelanden',
    desc: 'Ett meddelande varje gång någon skriver i chatten.',
  },
  {
    key: 'straffbanken',
    label: 'Straffbanken',
    desc: 'När du får en ny uppgift.',
  },
  {
    key: 'gameMaster',
    label: 'Game Master',
    desc: 'När Game Master slår till.',
  },
  {
    key: 'trainingReminders',
    label: 'Träningspåminnelser',
    desc: 'Kl. 19 och 22 om du inte loggat dagens träning.',
  },
  {
    key: 'personalStatus',
    label: 'Din status',
    desc: 'Beslut om t.ex. efterregistreringar som rör dig.',
  },
  {
    key: 'dailyGroupSummary',
    label: 'Gruppen',
    desc: 'Första passet för dagen, och en sammanfattning kl. 06:30.',
  },
];

export function NotificationsCard({ challengeId }: { challengeId: string }) {
  const push = usePushSubscription();
  const install = useInstallPrompt();
  const preferences = useNotificationPreferences(challengeId);
  const updatePreferences = useUpdateNotificationPreferences(challengeId);
  const selfTest = useSendSelfTestPush();
  const [error, setError] = useState<string | null>(null);
  const [testMessage, setTestMessage] = useState<string | null>(null);

  const showIosInstructions = isIos() && !isStandalone();
  // iOS never permits requesting Notification permission from a normal
  // Safari tab — only from the installed Home Screen web app. Calling
  // requestPermission() prematurely there can permanently poison the
  // origin's permission state, so the whole activation section (button,
  // self-test, preferences) must stay hidden until installed, regardless of
  // what isPushSupported() reports (support may exist at the API level
  // before it is functionally usable).
  const canManagePush = push.supported && !showIosInstructions;

  return (
    <div className={styles.section}>
      {!install.installed && (
        <div className={styles.install}>
          <span className={styles.installText}>
            Installera Hälsoutmaningen som en app för att kunna få notiser.
          </span>
          {showIosInstructions ? (
            <span className={styles.installText}>
              På iPhone/iPad: tryck på Dela-ikonen i Safari och välj &quot;Lägg
              till på hemskärmen&quot;.
            </span>
          ) : install.canPrompt ? (
            <Button size="sm" onClick={() => void install.promptInstall()}>
              Installera appen
            </Button>
          ) : (
            <span className={styles.installText}>
              Använd webbläsarens meny för att lägga till appen på hemskärmen.
            </span>
          )}
        </div>
      )}

      {!canManagePush ? (
        !showIosInstructions && (
          <p className={styles.installText}>
            Notiser stöds inte i den här webbläsaren ännu.
          </p>
        )
      ) : (
        <>
          <div className={styles.row}>
            <span className={styles.text}>
              <span className={styles.label}>Notiser</span>
              <span className={styles.status}>
                {push.permission === 'granted' && push.isActive
                  ? 'Aktiverade på den här enheten'
                  : push.permission === 'denied'
                    ? 'Blockerade i webbläsaren — ändra i webbläsarens inställningar'
                    : 'Inte aktiverade på den här enheten'}
              </span>
            </span>
            {push.isActive ? (
              <Button
                size="sm"
                variant="secondary"
                loading={push.disable.isPending}
                onClick={() => push.disable.mutate()}
              >
                Stäng av
              </Button>
            ) : (
              <Button
                size="sm"
                loading={push.enable.isPending}
                disabled={push.permission === 'denied'}
                onClick={() => {
                  setError(null);
                  push.enable.mutate(undefined, {
                    onError: (e) =>
                      setError(
                        e instanceof Error
                          ? e.message
                          : 'Kunde inte aktivera notiser.',
                      ),
                  });
                }}
              >
                Aktivera
              </Button>
            )}
          </div>
          {error && <span className={styles.error}>{error}</span>}

          {push.isActive && (
            <>
              <hr className={styles.divider} />
              <Button
                size="sm"
                variant="secondary"
                loading={selfTest.isPending}
                onClick={() => {
                  setTestMessage(null);
                  selfTest.mutate(undefined, {
                    onSuccess: () => setTestMessage('Testnotisen skickades.'),
                    onError: (e) =>
                      setTestMessage(
                        e instanceof Error
                          ? e.message
                          : 'Testnotisen kunde inte skickas.',
                      ),
                  });
                }}
              >
                Skicka testnotis
              </Button>
              {testMessage && (
                <span className={styles.status}>{testMessage}</span>
              )}

              <hr className={styles.divider} />
              {preferences.data &&
                CATEGORY_ROWS.map((row) => (
                  <ToggleRow
                    key={row.key}
                    label={row.label}
                    desc={row.desc}
                    checked={preferences.data[row.key]}
                    disabled={updatePreferences.isPending}
                    onChange={() =>
                      updatePreferences.mutate({
                        [row.key]: !preferences.data[row.key],
                      })
                    }
                  />
                ))}
            </>
          )}
        </>
      )}
    </div>
  );
}
