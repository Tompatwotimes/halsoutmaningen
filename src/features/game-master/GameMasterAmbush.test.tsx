import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GameMasterEvent } from './types';

/**
 * GameMasterAmbush is a leaf presenter: it consumes `useNextGameMasterEvent`,
 * `useMarkGameMasterEventSeen` and `requestSessionStartPulse`. Every dependency
 * is mocked so these tests exercise only the presentation contract (plan
 * Task 6): micro vs Sheet, first-seen/dismiss bookkeeping, and — above all —
 * that a Game Master failure never blocks or overlays the app shell.
 */

const {
  nextEventMock,
  markSeenMock,
  sessionPulseMock,
  challengeDataMock,
  authMock,
} = vi.hoisted(() => ({
  nextEventMock: vi.fn<() => Record<string, unknown>>(),
  markSeenMock: vi.fn<(vars: { eventId: string; dismiss: boolean }) => void>(),
  sessionPulseMock: vi.fn<(challengeId: string) => void>(),
  challengeDataMock: vi.fn<() => Record<string, unknown>>(),
  authMock: vi.fn<() => Record<string, unknown>>(),
}));

vi.mock('./useGameMaster', () => ({
  useNextGameMasterEvent: () => nextEventMock(),
  useMarkGameMasterEventSeen: () => ({ mutate: markSeenMock }),
  requestSessionStartPulse: (id: string) => sessionPulseMock(id),
}));
vi.mock('@/features/challenge/useChallengeData', () => ({
  useChallengeData: () => challengeDataMock(),
}));
vi.mock('@/features/auth/useAuth', () => ({
  useAuth: () => authMock(),
}));

import { GameMasterAmbush } from './GameMasterAmbush';

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

function setQuery(over: Record<string, unknown> = {}) {
  nextEventMock.mockReturnValue({
    data: null,
    isLoading: false,
    isError: false,
    ...over,
  });
}

function renderAmbush() {
  return render(
    <>
      <main data-testid="app-main">sidans innehåll</main>
      <GameMasterAmbush />
    </>,
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

// Default happy context: logged in, has a challenge.
challengeDataMock.mockReturnValue({ data: { challenge: { id: 'c1' } } });
authMock.mockReturnValue({ user: { id: 'u1' } });

describe('GameMasterAmbush — nothing to show', () => {
  it('renders nothing when there is no event', () => {
    setQuery({ data: null });
    renderAmbush();
    expect(screen.queryByText(/SYSTEMET/)).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders nothing (and never crashes the shell) when the query errored', () => {
    setQuery({ data: null, isError: true });
    renderAmbush();
    expect(screen.getByTestId('app-main')).toHaveTextContent('sidans innehåll');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('renders nothing while the query is loading', () => {
    setQuery({ data: null, isLoading: true });
    renderAmbush();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders nothing and fires no pulse when there is no challenge', () => {
    challengeDataMock.mockReturnValueOnce({ data: null });
    setQuery({ data: makeEvent() });
    renderAmbush();
    expect(screen.queryByText(/SYSTEMET/)).not.toBeInTheDocument();
    expect(sessionPulseMock).not.toHaveBeenCalled();
  });

  it('renders nothing when the user is not logged in', () => {
    authMock.mockReturnValueOnce({ user: null });
    setQuery({ data: makeEvent() });
    renderAmbush();
    expect(screen.queryByText(/SYSTEMET/)).not.toBeInTheDocument();
  });
});

describe('GameMasterAmbush — micro banner (severity 1–2)', () => {
  it('shows a small non-blocking banner, not a dialog', () => {
    setQuery({
      data: makeEvent({
        severity: 1,
        title: 'SYSTEMET',
        body: 'En liten avvikelse har registrerats.',
      }),
    });
    renderAmbush();

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const region = screen.getByRole('status');
    expect(region).toHaveTextContent('SYSTEMET');
    expect(region).toHaveTextContent('En liten avvikelse har registrerats.');
    // The page content is untouched.
    expect(screen.getByTestId('app-main')).toHaveTextContent('sidans innehåll');
  });

  it('severity 2 is also a banner', () => {
    setQuery({ data: makeEvent({ severity: 2 }) });
    renderAmbush();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('GameMasterAmbush — Sheet ambush (severity 3–5)', () => {
  it('severity 3 renders inside a dialog', () => {
    setQuery({ data: makeEvent({ severity: 3 }) });
    renderAmbush();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('SYSTEMET');
    expect(dialog).toHaveTextContent(
      'Kravet var 30 minuter. Dygnet innehöll 1 440.',
    );
  });

  it('severity 5 is a Sheet, not a full-screen takeover', () => {
    setQuery({ data: makeEvent({ severity: 5 }) });
    renderAmbush();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    // The real app content is still mounted behind the Sheet.
    expect(screen.getByTestId('app-main')).toHaveTextContent('sidans innehåll');
  });

  it('renders a private event’s frozen title and body verbatim', () => {
    const title = 'INCIDENTRAPPORT';
    const body =
      'Du misslyckades med att hitta 30 minuter under ett helt dygn.';
    setQuery({
      data: makeEvent({
        severity: 4,
        visibility: 'private',
        subjectUserId: 'u1',
        title,
        body,
      }),
    });
    renderAmbush();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent(title);
    expect(dialog).toHaveTextContent(body);
  });
});

describe('GameMasterAmbush — view bookkeeping', () => {
  it('marks the event first-seen once on mount', () => {
    setQuery({ data: makeEvent({ severity: 3 }) });
    const { rerender } = renderAmbush();
    expect(markSeenMock).toHaveBeenCalledWith({
      eventId: 'e1',
      dismiss: false,
    });
    const firstSeenCalls = markSeenMock.mock.calls.length;
    rerender(
      <>
        <main data-testid="app-main">sidans innehåll</main>
        <GameMasterAmbush />
      </>,
    );
    expect(markSeenMock.mock.calls.length).toBe(firstSeenCalls);
  });

  it('dismiss (“Noterat”) marks the event dismissed and hides it', async () => {
    const user = userEvent.setup();
    setQuery({ data: makeEvent({ severity: 3 }) });
    renderAmbush();

    await user.click(screen.getByRole('button', { name: 'Noterat' }));

    expect(markSeenMock).toHaveBeenCalledWith({ eventId: 'e1', dismiss: true });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText(/SYSTEMET/)).not.toBeInTheDocument();
  });

  it('a dismissed event does not come back after refetch drops it', async () => {
    const user = userEvent.setup();
    setQuery({ data: makeEvent({ severity: 1 }) });
    const { rerender } = renderAmbush();

    await user.click(screen.getByRole('button', { name: 'Noterat' }));
    // Refetch: the API now filters the dismissed event out.
    setQuery({ data: null });
    rerender(
      <>
        <main data-testid="app-main">sidans innehåll</main>
        <GameMasterAmbush />
      </>,
    );
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('the micro banner dismiss control has an accessible name', () => {
    setQuery({ data: makeEvent({ severity: 2 }) });
    renderAmbush();
    expect(screen.getByRole('button', { name: 'Noterat' })).toBeInTheDocument();
  });
});

describe('GameMasterAmbush — session-start pulse', () => {
  it('requests exactly one best-effort pulse on mount with the challenge id', () => {
    setQuery({ data: null });
    const { rerender } = renderAmbush();
    expect(sessionPulseMock).toHaveBeenCalledTimes(1);
    expect(sessionPulseMock).toHaveBeenCalledWith('c1');
    rerender(
      <>
        <main data-testid="app-main">sidans innehåll</main>
        <GameMasterAmbush />
      </>,
    );
    expect(sessionPulseMock).toHaveBeenCalledTimes(1);
  });
});
