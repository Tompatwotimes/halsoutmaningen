import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { WeightRankingRow } from './types';
import { WeightRankingList } from './WeightRankingList';

function row(over: Partial<WeightRankingRow> = {}): WeightRankingRow {
  return {
    userId: 'u1',
    displayName: 'Anna',
    startWeightKg: 82,
    latestWeightKg: 78.7,
    latestEntryDate: '2026-09-05',
    kgChange: -3.3,
    percentageChange: -4.02,
    ...over,
  };
}

describe('WeightRankingList', () => {
  it('renders every field the spec lists for a public row', () => {
    render(<WeightRankingList rows={[row()]} />);
    expect(screen.getByText('Anna')).toBeInTheDocument();
    expect(screen.getByText(/82/)).toBeInTheDocument(); // start
    expect(screen.getByText(/78\.7/)).toBeInTheDocument(); // latest
    expect(screen.getByText(/-3\.3/)).toBeInTheDocument(); // kg change
    expect(screen.getByText(/-4\.02\s*%/)).toBeInTheDocument(); // percentage
    expect(screen.getByText(/5 september/i)).toBeInTheDocument(); // weigh-in date
  });

  it('renders every row it receives, trusting the server filtering entirely', () => {
    // The server (weight_public_ranking, SECURITY INVOKER) already excludes a
    // hidden participant — a correctly filtered response never contains one.
    // This list does NO filtering of its own; it renders exactly what it is
    // handed. The test feeds a second row that a caller could mistake for a
    // hidden participant and asserts BOTH rows render.
    render(
      <WeightRankingList
        rows={[
          row({ userId: 'a', displayName: 'Anna', percentageChange: -4.02 }),
          row({ userId: 'b', displayName: 'Bo', percentageChange: -1.1 }),
        ]}
      />,
    );
    expect(screen.getByText('Anna')).toBeInTheDocument();
    expect(screen.getByText('Bo')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('renders an empty state for zero rows', () => {
    render(<WeightRankingList rows={[]} />);
    expect(screen.getByText(/ingen.*viktkampen än/i)).toBeInTheDocument();
  });
});
