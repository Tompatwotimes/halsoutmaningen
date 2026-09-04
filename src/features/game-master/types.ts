/**
 * Game Master GM1 — shared frontend types.
 *
 * Game Master is an isolated, optional "surprise engine" (spec:
 * docs/superpowers/specs/2026-09-04-game-master-v1-design.md). It occasionally
 * turns authoritative challenge state into a private or public hand-written
 * roast. Nothing in this subsystem may influence training validity, day states,
 * streaks, liability/KASSAN, ranking, Straffbanken or retroactive registration.
 *
 * These types describe only what the browser renders. The server owns candidate
 * generation, scoring, cooldowns, randomness and persistence.
 */

export type GameMasterVisibility = 'private' | 'public';

export type GameMasterEventStatus = 'active' | 'expired' | 'cancelled';

export type GameMasterIntensity = 'low' | 'normal' | 'high';

export type GameMasterSeverity = 1 | 2 | 3 | 4 | 5;

/** How an event is surfaced in the app shell. */
export type GameMasterPresentation = 'micro' | 'sheet';

/**
 * One emitted surprise. Title/body/payload are frozen at emission time — later
 * data changes never rewrite an old roast.
 */
export interface GameMasterEvent {
  id: string;
  challengeId: string;
  family: string;
  visibility: GameMasterVisibility;
  /** Present for every private event; may be set for a public roast too. */
  subjectUserId: string | null;
  title: string;
  body: string;
  severity: GameMasterSeverity;
  /** Whether this event belongs in the public chronicle (Arkivet). */
  archive: boolean;
  startsAt: string;
  expiresAt: string | null;
  status: GameMasterEventStatus;
  /** Per-current-user view bookkeeping (from game_master_event_views). */
  firstSeenAt: string | null;
  dismissedAt: string | null;
}

export interface GameMasterSettings {
  challengeId: string;
  enabled: boolean;
  privateRoastsEnabled: boolean;
  publicRoastsEnabled: boolean;
  archiveEnabled: boolean;
  intensity: GameMasterIntensity;
}
