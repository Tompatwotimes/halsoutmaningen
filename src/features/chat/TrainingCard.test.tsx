import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { TrainingCardData } from './types';

const { useTrainingCardProofUrlsMock } = vi.hoisted(() => ({
  useTrainingCardProofUrlsMock: vi.fn(),
}));
vi.mock('./useChat', () => ({
  useTrainingCardProofUrls: useTrainingCardProofUrlsMock,
}));

import { TrainingCard } from './TrainingCard';

/**
 * A controllable IntersectionObserver stand-in for the two tests that need
 * to prove the near-viewport gate itself (jsdom has no real
 * IntersectionObserver at all — every other test here relies on
 * `useNearViewport`'s "unavailable API" fallback, which treats every card as
 * already near, matching this suite's existing expectations unmodified).
 */
class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  callback: IntersectionObserverCallback;
  observed: Element[] = [];
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    FakeIntersectionObserver.instances.push(this);
  }
  observe(el: Element) {
    this.observed.push(el);
  }
  disconnect() {
    this.observed = [];
  }
  unobserve() {
    // Never exercised — TrainingCard/useNearViewport only ever disconnects.
  }
  fire(isIntersecting: boolean) {
    this.callback(
      this.observed.map(
        (target) => ({ isIntersecting, target }) as IntersectionObserverEntry,
      ),
      this as unknown as IntersectionObserver,
    );
  }
}

function card(over: Partial<TrainingCardData> = {}): TrainingCardData {
  return {
    entryId: 'e1',
    activity: 'Löpning',
    durationMinutes: 45,
    note: null,
    challengeDate: '2026-09-06',
    entryStatus: 'active',
    trainedAt: '2026-09-06T17:42:00Z',
    proofs: [],
    ...over,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

function primeProofs(
  data: { position: number; url: string | null }[] | undefined,
  isLoading = false,
  refetch: () => void = vi.fn(),
) {
  useTrainingCardProofUrlsMock.mockReturnValue({ data, isLoading, refetch });
}

describe('TrainingCard', () => {
  it('shows who logged, the activity, the duration and the date', () => {
    primeProofs([]);
    render(<TrainingCard card={card()} senderName="Tomas" time="19:42" />);
    expect(screen.getByText(/Tomas loggade ett pass/)).toBeInTheDocument();
    expect(screen.getByText('Löpning')).toBeInTheDocument();
    expect(screen.getByText(/45\s*min/)).toBeInTheDocument();
    expect(screen.getByText(/september 2026/)).toBeInTheDocument();
  });

  it('says "Du loggade ett pass" for the viewer\'s own card', () => {
    primeProofs([]);
    render(<TrainingCard card={card()} senderName="Du" time="19:42" />);
    expect(screen.getByText(/Du loggade ett pass/)).toBeInTheDocument();
  });

  it('falls back to "Träning" when the entry has no activity', () => {
    primeProofs([]);
    render(
      <TrainingCard
        card={card({ activity: null })}
        senderName="A"
        time="8:00"
      />,
    );
    expect(screen.getByText('Träning')).toBeInTheDocument();
  });

  it('renders one proof image', () => {
    primeProofs([{ position: 1, url: 'https://s/p1?token=x' }]);
    render(
      <TrainingCard
        card={card({ proofs: [{ position: 1, path: 'c/u/d/p1.jpg' }] })}
        senderName="A"
        time="8:00"
      />,
    );
    const imgs = screen
      .getByTestId('training-card-proofs')
      .querySelectorAll('img');
    expect(imgs).toHaveLength(1);
    expect(imgs[0]?.getAttribute('src')).toBe('https://s/p1?token=x');
  });

  it('renders two proof images', () => {
    primeProofs([
      { position: 1, url: 'https://s/p1' },
      { position: 2, url: 'https://s/p2' },
    ]);
    render(
      <TrainingCard
        card={card({
          proofs: [
            { position: 1, path: 'c/u/d/p1.jpg' },
            { position: 2, path: 'c/u/d/p2.jpg' },
          ],
        })}
        senderName="A"
        time="8:00"
      />,
    );
    expect(
      screen.getByTestId('training-card-proofs').querySelectorAll('img'),
    ).toHaveLength(2);
  });

  it('shows a broken-image fallback for a denied proof slot without crashing', () => {
    primeProofs([{ position: 1, url: null }]);
    render(
      <TrainingCard
        card={card({ proofs: [{ position: 1, path: 'c/u/d/p1.jpg' }] })}
        senderName="A"
        time="8:00"
      />,
    );
    expect(
      screen.getByLabelText('Bilden kunde inte laddas'),
    ).toBeInTheDocument();
  });

  it('renders the note when present', () => {
    primeProofs([]);
    render(
      <TrainingCard
        card={card({ note: 'tungt men klart' })}
        senderName="A"
        time="8:00"
      />,
    );
    expect(screen.getByText(/tungt men klart/)).toBeInTheDocument();
  });

  it('renders "Passet har underkänts" for an invalidated entry', () => {
    primeProofs([]);
    render(
      <TrainingCard
        card={card({ entryStatus: 'invalidated' })}
        senderName="A"
        time="8:00"
      />,
    );
    expect(screen.getByText('Passet har underkänts')).toBeInTheDocument();
  });

  it('does not fetch proof URLs when the card has no proofs', () => {
    primeProofs(undefined);
    render(
      <TrainingCard card={card({ proofs: [] })} senderName="A" time="8" />,
    );
    expect(useTrainingCardProofUrlsMock).toHaveBeenCalledWith('e1', []);
    expect(
      screen.queryByTestId('training-card-proofs'),
    ).not.toBeInTheDocument();
  });

  it('shows a retry control for a denied proof slot, wired to refetch', () => {
    const refetch = vi.fn();
    primeProofs([{ position: 1, url: null }], false, refetch);
    render(
      <TrainingCard
        card={card({ proofs: [{ position: 1, path: 'c/u/d/p1.jpg' }] })}
        senderName="A"
        time="8:00"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Försök igen' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  describe('near-viewport gating (IntersectionObserver available)', () => {
    const realIO = global.IntersectionObserver;

    afterEach(() => {
      global.IntersectionObserver = realIO;
      FakeIntersectionObserver.instances = [];
    });

    it('does not request signed URLs for a card that has not been observed as near the viewport', () => {
      global.IntersectionObserver =
        FakeIntersectionObserver as unknown as typeof IntersectionObserver;
      primeProofs([{ position: 1, url: 'https://s/p1' }]);
      render(
        <TrainingCard
          card={card({ proofs: [{ position: 1, path: 'c/u/d/p1.jpg' }] })}
          senderName="A"
          time="8:00"
        />,
      );

      // Offscreen: the hook is called with an empty proofs array (no signed
      // URL requested), and the slot renders a reserved-space skeleton, not
      // an <img> — this is the fix that replaces the unreliable native
      // `loading="lazy"` gate with an app-controlled one.
      expect(useTrainingCardProofUrlsMock).toHaveBeenCalledWith('e1', []);
      expect(
        screen.getByTestId('training-card-proofs').querySelector('img'),
      ).not.toBeInTheDocument();
    });

    it('requests signed URLs and renders the image exactly once the card is observed as near the viewport', () => {
      global.IntersectionObserver =
        FakeIntersectionObserver as unknown as typeof IntersectionObserver;
      primeProofs([{ position: 1, url: 'https://s/p1' }]);
      render(
        <TrainingCard
          card={card({ proofs: [{ position: 1, path: 'c/u/d/p1.jpg' }] })}
          senderName="A"
          time="8:00"
        />,
      );

      const observer = FakeIntersectionObserver.instances[0];
      expect(observer).toBeDefined();
      act(() => observer?.fire(true));

      expect(useTrainingCardProofUrlsMock).toHaveBeenLastCalledWith('e1', [
        { position: 1, path: 'c/u/d/p1.jpg' },
      ]);
      expect(
        screen.getByTestId('training-card-proofs').querySelector('img'),
      ).toBeInTheDocument();

      // Scrolling away and back must not re-fetch — the gate is a one-way
      // latch (regression brief: "AFTER SCROLL INTO VIEW: image loads
      // exactly once").
      const callsAfterFirstNear =
        useTrainingCardProofUrlsMock.mock.calls.length;
      act(() => observer?.fire(false));
      act(() => observer?.fire(true));
      expect(useTrainingCardProofUrlsMock.mock.calls.length).toBe(
        callsAfterFirstNear,
      );
    });
  });
});
