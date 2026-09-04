import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { GameMasterEvent } from './types';

/**
 * Arkivet is a discrete chronicle, not a social feed (spec §9). These tests
 * pin that contract: the component renders exactly what `useGameMasterArchive`
 * returns (the API already filters to public + archive + active, newest first),
 * in order, with no like / comment / reply / post affordance of any kind, and a
 * Game Master read failure degrades to an understated empty state — never a
 * page-level error.
 */

const { archiveMock } = vi.hoisted(() => ({
  archiveMock: vi.fn<() => Record<string, unknown>>(),
}));

vi.mock('./useGameMaster', () => ({
  useGameMasterArchive: () => archiveMock(),
}));

import { GameMasterArchive } from './GameMasterArchive';

function makeEvent(over: Partial<GameMasterEvent> = {}): GameMasterEvent {
  return {
    id: 'e1',
    challengeId: 'c1',
    family: 'missed_day',
    visibility: 'public',
    subjectUserId: null,
    title: 'SYSTEMET HAR NOTERAT EN AVVIKELSE',
    body: 'Kravet var 30 minuter. Dygnet innehöll 1 440.',
    severity: 3,
    archive: true,
    startsAt: '2026-09-04T06:00:00Z',
    expiresAt: null,
    status: 'active',
    firstSeenAt: null,
    dismissedAt: null,
    ...over,
  };
}

function setArchive(over: Record<string, unknown> = {}) {
  archiveMock.mockReturnValue({
    data: [],
    isLoading: false,
    isError: false,
    ...over,
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('GameMasterArchive — the chronicle', () => {
  it('renders one row per event, in the order the hook returns (newest first)', () => {
    setArchive({
      data: [
        makeEvent({
          id: 'c',
          title: 'TREDJE',
          startsAt: '2026-09-06T06:00:00Z',
        }),
        makeEvent({
          id: 'b',
          title: 'ANDRA',
          startsAt: '2026-09-05T06:00:00Z',
        }),
        makeEvent({
          id: 'a',
          title: 'FÖRSTA',
          startsAt: '2026-09-04T06:00:00Z',
        }),
      ],
    });
    render(<GameMasterArchive challengeId="c1" />);

    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('TREDJE');
    expect(rows[1]).toHaveTextContent('ANDRA');
    expect(rows[2]).toHaveTextContent('FÖRSTA');
  });

  it('shows the date, a system label, and the frozen title + body for a row', () => {
    setArchive({
      data: [
        makeEvent({
          family: 'kassan',
          title: 'KASSAN',
          body: 'Gruppen har nu gemensamt misslyckats ihop till 3 000 kr.',
          startsAt: '2026-09-04T06:00:00Z',
        }),
      ],
    });
    render(<GameMasterArchive challengeId="c1" />);

    const row = screen.getByRole('listitem');
    expect(row).toHaveTextContent(/september 2026/);
    expect(row).toHaveTextContent('Kassan');
    expect(row).toHaveTextContent('KASSAN');
    expect(row).toHaveTextContent(
      'Gruppen har nu gemensamt misslyckats ihop till 3 000 kr.',
    );
  });

  it('maps every family to a short Swedish label', () => {
    setArchive({
      data: [
        makeEvent({ id: '1', family: 'missed_day', title: 'a' }),
        makeEvent({ id: '2', family: 'streak_broken', title: 'b' }),
        makeEvent({ id: '3', family: 'ranking_position', title: 'c' }),
        makeEvent({ id: '4', family: 'something_unknown', title: 'd' }),
      ],
    });
    render(<GameMasterArchive challengeId="c1" />);

    expect(screen.getByText('Avvikelse')).toBeInTheDocument();
    expect(screen.getByText('Fall')).toBeInTheDocument();
    expect(screen.getByText('Placering')).toBeInTheDocument();
    // Unknown families fall back to the generic system label.
    expect(screen.getByText('System')).toBeInTheDocument();
  });

  it('has no feed affordances — no composer, likes, comments or replies', () => {
    setArchive({
      data: [makeEvent(), makeEvent({ id: 'e2', title: 'ANNAN' })],
    });
    render(<GameMasterArchive challengeId="c1" />);

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /gilla|kommentera|svara/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('renders an understated empty state (no alert) when there is nothing', () => {
    setArchive({ data: [] });
    render(<GameMasterArchive challengeId="c1" />);

    expect(
      screen.getByText('Systemet har inte skrivit något än.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows skeletons while loading, not an error', () => {
    setArchive({ data: undefined, isLoading: true });
    const { container } = render(<GameMasterArchive challengeId="c1" />);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(
      screen.queryByText('Systemet har inte skrivit något än.'),
    ).not.toBeInTheDocument();
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
  });

  it('degrades to an understated empty state (no alert) when the hook errors', () => {
    setArchive({ data: undefined, isError: true });
    render(<GameMasterArchive challengeId="c1" />);

    expect(screen.getByText('Arkivet är tomt just nu.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('renders nothing but the empty state when there is no challenge', () => {
    setArchive({ data: [] });
    render(<GameMasterArchive challengeId={null} />);

    expect(
      screen.getByText('Systemet har inte skrivit något än.'),
    ).toBeInTheDocument();
  });
});
