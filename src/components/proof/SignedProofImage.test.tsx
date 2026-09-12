import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SignedProofImage } from './SignedProofImage';

/**
 * Egress regression guard (2026-09 forensic audit): a chat page can render
 * many of these at once (one per training card). Without native
 * lazy-loading the browser downloaded every image's full bytes on mount
 * regardless of scroll position — this is the fix, so it must never
 * silently regress.
 */
describe('SignedProofImage', () => {
  it('renders the image with native lazy-loading', () => {
    render(
      <SignedProofImage src="https://example.invalid/signed.jpg" alt="Bevis" />,
    );
    const img = screen.getByAltText('Bevis');
    expect(img).toHaveAttribute('loading', 'lazy');
  });
});
