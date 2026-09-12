import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AppFooter } from './AppFooter';
import { APP_VERSION } from '@/lib/version';

describe('AppFooter', () => {
  it('renders the canonical app version from package.json, not a hardcoded string', () => {
    render(<AppFooter />);
    expect(
      screen.getByText(`Hälsoutmaningen · v${APP_VERSION}`),
    ).toBeInTheDocument();
  });

  it('reflects the current v1.9.3 production bugfix release', () => {
    render(<AppFooter />);
    expect(screen.getByText('Hälsoutmaningen · v1.9.3')).toBeInTheDocument();
  });
});
