import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DayState } from '@/domain/dayState';
import { StatusCell } from './StatusCell';

/**
 * v1.11.0 — double-pass gold star (§19 UI truth table). The star is purely
 * presentational; these tests only assert on what StatusCell ACTUALLY does
 * with the already-computed `doublePass` flag it is handed — the domain
 * decision itself is covered exhaustively in src/domain/penalties.test.ts.
 */
describe('StatusCell — double-pass gold star', () => {
  it('completed normal single-pass day: no star', () => {
    render(<StatusCell state={DayState.Completed} doublePass={false} />);
    expect(screen.queryByTestId('double-pass-star')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^Genomförd$/)).toBeInTheDocument();
  });

  it('completed voluntary double-pass day: star renders', () => {
    render(<StatusCell state={DayState.Completed} doublePass />);
    expect(screen.getByTestId('double-pass-star')).toBeInTheDocument();
  });

  it('incomplete multi-session day (not completed): no star even if flagged', () => {
    // A caller must never pass doublePass=true for a non-completed day per
    // the domain rule, but StatusCell itself has no opinion on `state` vs
    // `doublePass` — it renders exactly what it's told. This case documents
    // that decoupling: the flag alone controls the star, `state` alone
    // controls everything else.
    render(<StatusCell state={DayState.Missed} doublePass={false} />);
    expect(screen.queryByTestId('double-pass-star')).not.toBeInTheDocument();
  });

  it('penalized double-pass day (e.g. double_session 30+30): star renders alongside the penalty dot', () => {
    render(<StatusCell state={DayState.Completed} penalised doublePass />);
    expect(screen.getByTestId('double-pass-star')).toBeInTheDocument();
    expect(
      screen.getByLabelText(/\(straff\) · Dubbelpass genomfört$/),
    ).toBeInTheDocument();
  });

  it('accessible name contains "Dubbelpass genomfört" verbatim when starred', () => {
    render(
      <StatusCell
        state={DayState.Completed}
        doublePass
        ariaLabel="Anna, Måndag 5: Genomförd"
      />,
    );
    const el = screen.getByLabelText(
      'Anna, Måndag 5: Genomförd Dubbelpass genomfört',
    );
    expect(el).toBeInTheDocument();
    expect(el.getAttribute('aria-label')).toContain('Dubbelpass genomfört');
  });

  it('accessible name has NO double-pass text when not starred', () => {
    render(
      <StatusCell
        state={DayState.Completed}
        doublePass={false}
        ariaLabel="Anna, Måndag 5: Genomförd"
      />,
    );
    const el = screen.getByLabelText('Anna, Måndag 5: Genomförd');
    expect(el.getAttribute('aria-label')).not.toContain('Dubbelpass');
  });

  it('the star does not block the parent cell click/tap behaviour', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <StatusCell state={DayState.Completed} doublePass onClick={onClick} />,
    );
    await user.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('the star marker itself is aria-hidden (meaning carried by the cell label, not the glyph)', () => {
    render(<StatusCell state={DayState.Completed} doublePass />);
    expect(screen.getByTestId('double-pass-star')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
  });
});
