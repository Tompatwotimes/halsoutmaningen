import { useState } from 'react';
import { getPushDiagnostics, type PushDiagnostics } from './capability';
import styles from './DiagnosticsPanel.module.css';

/**
 * Admin-only, discreet, expandable panel of raw Web Push capability
 * booleans — so a real device (an iPhone, most importantly) can report
 * exactly what it exposes without remote debugging. Every field here is a
 * capability/state flag; NEVER an endpoint, key, token, or other secret.
 */
export function DiagnosticsPanel() {
  const [open, setOpen] = useState(false);
  const [diagnostics, setDiagnostics] = useState<PushDiagnostics | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleToggle() {
    const next = !open;
    setOpen(next);
    if (next && !diagnostics) {
      setLoading(true);
      const result = await getPushDiagnostics();
      setDiagnostics(result);
      setLoading(false);
    }
  }

  return (
    <div className={styles.wrap}>
      <button
        type="button"
        className={styles.toggle}
        onClick={() => void handleToggle()}
      >
        {open ? 'Dölj diagnostik' : 'Visa diagnostik (admin)'}
      </button>
      {open && (
        <div className={styles.panel}>
          {loading && <p className={styles.muted}>Kontrollerar…</p>}
          {diagnostics && (
            <dl className={styles.list}>
              {Object.entries(diagnostics).map(([key, value]) => (
                <div key={key} className={styles.item}>
                  <dt className={styles.key}>{key}</dt>
                  <dd className={styles.value}>{String(value)}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}
    </div>
  );
}
