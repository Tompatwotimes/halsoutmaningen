import { useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Sheet';
import { useAuth } from '@/features/auth/useAuth';
import { useChallengeData } from '@/features/challenge/useChallengeData';
import { presentationForSeverity } from './game-master';
import type { GameMasterEvent } from './types';
import {
  requestSessionStartPulse,
  useMarkGameMasterEventSeen,
  useNextGameMasterEvent,
} from './useGameMaster';
import styles from './GameMasterAmbush.module.css';

/**
 * Game Master GM1 — the in-app ambush surface.
 *
 * Mounted once inside the authenticated shell (`AppShell`), never on
 * login/activation. It shows at most one unseen Game Master event for the
 * current user:
 *   - severity 1–2 → a small, non-blocking `role="status"` banner that does not
 *     cover primary controls (no backdrop, no focus trap);
 *   - severity 3–5 → the shared `Sheet` (a bottom sheet, not a full-screen
 *     theatrical takeover — those are deferred, spec §17).
 *
 * Game Master is optional and isolated (spec §2). This component is a pure
 * leaf presenter: every read goes through `useNextGameMasterEvent`, whose query
 * is `retry: false` + `throwOnError: false`. If the query is loading, errored,
 * or returns nothing — or the user has no challenge/session — it renders
 * `null`. It never wraps the shell, never shows an error state of its own, and
 * a Game Master failure is therefore indistinguishable from "no event".
 */
export function GameMasterAmbush() {
  const { user } = useAuth();
  const challenge = useChallengeData();
  const challengeId = challenge.data?.challenge.id ?? null;
  const userId = user?.id ?? null;

  // One best-effort pulse when the authenticated app first becomes active in
  // this browser session (plan Task 5 Step 3 / Task 6). Fire-and-forget — the
  // helper never throws and dedupes via sessionStorage; the ref just avoids a
  // second call on re-render within the same mount.
  const pulsedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!challengeId || pulsedFor.current === challengeId) return;
    pulsedFor.current = challengeId;
    requestSessionStartPulse(challengeId);
  }, [challengeId]);

  if (!challengeId || !userId) return null;
  return <Ambush challengeId={challengeId} userId={userId} />;
}

function Ambush({
  challengeId,
  userId,
}: {
  challengeId: string;
  userId: string;
}) {
  const query = useNextGameMasterEvent(challengeId, userId);
  const { mutate: markSeen } = useMarkGameMasterEventSeen();
  const [locallyDismissed, setLocallyDismissed] = useState<string | null>(null);

  const event = query.data ?? null;

  // Record `first_seen_at` exactly once per event id. Guarded by a ref so a
  // re-render (or the refetch the mutation itself triggers) never re-fires it.
  const firstSeenFor = useRef<string | null>(null);
  useEffect(() => {
    if (!event || firstSeenFor.current === event.id) return;
    firstSeenFor.current = event.id;
    markSeen({ eventId: event.id, dismiss: false });
  }, [event, markSeen]);

  // A GM failure must never block or overlay the shell: loading / error / no
  // event all render nothing at all.
  if (query.isLoading || query.isError || !event) return null;
  if (locallyDismissed === event.id) return null;

  const dismiss = () => {
    // Hide immediately so the ambush cannot flash back before the refetch;
    // the mutation sets `dismissed_at` and the API then filters it out.
    setLocallyDismissed(event.id);
    markSeen({ eventId: event.id, dismiss: true });
  };

  return presentationForSeverity(event.severity) === 'micro' ? (
    <MicroBanner event={event} onDismiss={dismiss} />
  ) : (
    <SheetAmbush event={event} onDismiss={dismiss} />
  );
}

function MicroBanner({
  event,
  onDismiss,
}: {
  event: GameMasterEvent;
  onDismiss: () => void;
}) {
  return (
    <div className={styles.banner} role="status" aria-label="Systemmeddelande">
      <div className={styles.bannerText}>
        <p className={styles.eyebrow}>SYSTEMET</p>
        <p className={styles.title}>{event.title}</p>
        <p className={styles.body}>{event.body}</p>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className={styles.dismiss}
        onClick={onDismiss}
      >
        Noterat
      </Button>
    </div>
  );
}

function SheetAmbush({
  event,
  onDismiss,
}: {
  event: GameMasterEvent;
  onDismiss: () => void;
}) {
  const isPrivate = event.visibility === 'private';
  return (
    <Sheet
      open
      onClose={onDismiss}
      title={event.title}
      footer={
        <Button variant="primary" fullWidth onClick={onDismiss}>
          Noterat
        </Button>
      }
    >
      <div className={styles.sheetHead}>
        <p className={styles.eyebrow}>SYSTEMET</p>
        {isPrivate && (
          <Badge tone="neutral" size="sm">
            Endast du
          </Badge>
        )}
      </div>
      <p className={styles.sheetBody}>{event.body}</p>
    </Sheet>
  );
}
