import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  AdminGameMasterEvent,
  GameMasterRun,
} from './game-master-admin-api';

/**
 * The run log is read-only observability plus one audited "hide event" action
 * (spec §16). No manual pulse / roast / victim / winner control. Hiding an
 * event requires a non-empty reason before the confirm is enabled.
 */

const { runsMock, eventsMock, cancelMock } = vi.hoisted(() => ({
  runsMock: vi.fn<() => Record<string, unknown>>(),
  eventsMock: vi.fn<() => Record<string, unknown>>(),
  cancelMock: {
    mutate: vi.fn(),
    reset: vi.fn(),
    isPending: false,
    isError: false,
    error: null as Error | null,
  },
}));

vi.mock('./game-master-admin-api', () => ({
  useGameMasterRuns: () => runsMock(),
  useRecentGameMasterEvents: () => eventsMock(),
  useCancelGameMasterEvent: () => cancelMock,
}));

import { GameMasterRunLog } from './GameMasterRunLog';

function makeRun(over: Partial<GameMasterRun> = {}): GameMasterRun {
  return {
    id: 'r1',
    source: 'scheduled',
    outcome: 'event',
    candidateCount: 5,
    eligibleCount: 2,
    selectedEventId: 'e1',
    diagnostics: { family: 'missed_day' },
    startedAt: '2026-09-04T06:00:00Z',
    completedAt: '2026-09-04T06:00:01Z',
    ...over,
  };
}

function makeEvent(
  over: Partial<AdminGameMasterEvent> = {},
): AdminGameMasterEvent {
  return {
    id: 'e1',
    family: 'missed_day',
    visibility: 'private',
    subjectUserId: 'u1',
    severity: 3,
    title: 'INCIDENTRAPPORT',
    body: 'Kravet var 30 minuter. Dygnet innehöll 1 440.',
    status: 'active',
    startsAt: '2026-09-04T06:00:00Z',
    createdAt: '2026-09-04T06:00:00Z',
    cancelledReason: null,
    ...over,
  };
}

function setData(runs: GameMasterRun[], events: AdminGameMasterEvent[]) {
  runsMock.mockReturnValue({
    data: runs,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
  eventsMock.mockReturnValue({
    data: events,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
}

afterEach(() => {
  vi.clearAllMocks();
  cancelMock.isPending = false;
  cancelMock.isError = false;
  cancelMock.error = null;
});

describe('GameMasterRunLog', () => {
  it('renders decisions with outcome, counts and the selected family', () => {
    setData([makeRun()], []);
    render(<GameMasterRunLog challengeId="c1" />);

    expect(screen.getByText('Händelse')).toBeInTheDocument();
    expect(screen.getByText(/5 kandidater · 2 möjliga/)).toBeInTheDocument();
    expect(screen.getByText('Avvikelse')).toBeInTheDocument();
  });

  it('does not show a family for a silent decision', () => {
    setData(
      [makeRun({ outcome: 'silence', diagnostics: { family: 'missed_day' } })],
      [],
    );
    render(<GameMasterRunLog challengeId="c1" />);

    expect(screen.getByText('Tystnad')).toBeInTheDocument();
    expect(screen.queryByText('Avvikelse')).not.toBeInTheDocument();
  });

  it('has no manual pulse / roast / victim / winner control', () => {
    setData([makeRun()], [makeEvent()]);
    render(<GameMasterRunLog challengeId="c1" />);

    expect(
      screen.queryByRole('button', {
        name: /roasta|kör puls|testa|skapa|välj vinnare|välj deltagare/i,
      }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('requires a non-empty reason before an event can be hidden', async () => {
    // delay: null — Sheet's open effect schedules a requestAnimationFrame
    // that autofocuses the panel's first focusable element (the Cancel
    // button, before this textarea in DOM order); under jsdom that rAF can
    // land mid-`type()` with the default per-keystroke delay and steal focus
    // away, truncating the typed reason (root-caused and reproduced against
    // AdminRetroactiveReview.test.tsx's identical pattern: ~80-93% failure
    // over 15 isolated reps with the default delay, 0% with delay: null).
    // Never manifests in a real browser (rAF resolves well before any human
    // keystroke) — a jsdom/test-timing artifact, not a product bug.
    const user = userEvent.setup({ delay: null });
    setData([], [makeEvent()]);
    render(<GameMasterRunLog challengeId="c1" />);

    await user.click(screen.getByRole('button', { name: 'Dölj' }));
    const dialog = screen.getByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Dölj' });

    expect(confirm).toBeDisabled();

    await user.type(
      within(dialog).getByPlaceholderText(/Fel mottagare/),
      'Bilden hörde till fel dag',
    );
    expect(confirm).toBeEnabled();

    await user.click(confirm);
    expect(cancelMock.mutate).toHaveBeenCalledTimes(1);
    expect(cancelMock.mutate).toHaveBeenCalledWith(
      { eventId: 'e1', reason: 'Bilden hörde till fel dag' },
      expect.anything(),
    );
  });

  it('shows the reason and no action for an already-hidden event', () => {
    setData(
      [],
      [
        makeEvent({
          status: 'cancelled',
          cancelledReason: 'Dubbelpost efter omförsök.',
        }),
      ],
    );
    render(<GameMasterRunLog challengeId="c1" />);

    expect(
      screen.getByText(/Dold: Dubbelpost efter omförsök\./),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Dölj' }),
    ).not.toBeInTheDocument();
  });
});
