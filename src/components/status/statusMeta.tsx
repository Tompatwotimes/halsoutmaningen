import type { ComponentType, SVGProps } from 'react';
import { DayState } from '@/domain/dayState';
import { CheckIcon, MissedIcon, PendingIcon } from '@/components/icons';

/**
 * The one place the canonical day states get their Swedish label, short label,
 * icon and colour role. Every status surface (dashboard cell, matrix cell,
 * badge, home hero) reads from here so the language stays consistent
 * (design north star — status system; CLAUDE.md §7).
 *
 * Colour is never the only signal: each state also has a distinct glyph and a
 * text label.
 */

export interface StatusMeta {
  /** Full Swedish label, e.g. "Genomförd". */
  label: string;
  /** Terse label for dense contexts, e.g. "Klar". */
  short: string;
  /** Distinct glyph; `null` for the states drawn as an empty/hollow cell. */
  Icon: ComponentType<SVGProps<SVGSVGElement>> | null;
  /** CSS custom-property base, e.g. "completed" → var(--c-completed-*). */
  tone: 'completed' | 'missed' | 'pending' | 'future' | 'absent';
}

export const STATUS_META: Record<DayState, StatusMeta> = {
  [DayState.Completed]: {
    label: 'Genomförd',
    short: 'Klar',
    Icon: CheckIcon,
    tone: 'completed',
  },
  [DayState.Missed]: {
    label: 'Missad',
    short: 'Missad',
    Icon: MissedIcon,
    tone: 'missed',
  },
  [DayState.Pending]: {
    label: 'Väntar på dagens pass',
    short: 'Kvar idag',
    Icon: PendingIcon,
    tone: 'pending',
  },
  [DayState.Future]: {
    label: 'Kommande dag',
    short: 'Kommande',
    Icon: null,
    tone: 'future',
  },
  [DayState.NotParticipating]: {
    label: 'Deltog inte',
    short: 'Deltog ej',
    Icon: null,
    tone: 'absent',
  },
};

export function statusMeta(state: DayState): StatusMeta {
  return STATUS_META[state];
}
