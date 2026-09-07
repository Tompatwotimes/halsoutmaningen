import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { TrainingCardData } from './types';

const { useTrainingCardProofUrlsMock } = vi.hoisted(() => ({
  useTrainingCardProofUrlsMock: vi.fn(),
}));
vi.mock('./useChat', () => ({
  useTrainingCardProofUrls: useTrainingCardProofUrlsMock,
}));

import { TrainingCard } from './TrainingCard';

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
) {
  useTrainingCardProofUrlsMock.mockReturnValue({ data, isLoading });
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
});
