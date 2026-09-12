import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SignedProofImage } from './SignedProofImage';

/**
 * Egress regression guard (2026-09 forensic audit): a chat page can render
 * many of these at once (one per training card). Without native
 * lazy-loading the browser downloaded every image's full bytes on mount
 * regardless of scroll position — this is the fix, so it must never
 * silently regress.
 *
 * PRODUCTION REGRESSION guard (2026-09, same cycle): the loading placeholder
 * used to hide the <img> via `display: none`, which — combined with
 * `loading="lazy"` — meant the browser could never compute the image's
 * distance from the viewport and so never even started the fetch. That
 * deadlocked every proof image, visible or not, on a real iOS Home Screen
 * PWA. The fix keeps the <img> always laid out (opacity-only hide) with the
 * loading skeleton as an absolutely positioned overlay instead.
 */
describe('SignedProofImage', () => {
  it('renders the image with native lazy-loading', () => {
    render(
      <SignedProofImage src="https://example.invalid/signed.jpg" alt="Bevis" />,
    );
    const img = screen.getByAltText('Bevis');
    expect(img).toHaveAttribute('loading', 'lazy');
  });

  it('never hides the <img> itself via display:none while loading — the exact deadlock that broke lazy-loading in production', () => {
    render(
      <SignedProofImage src="https://example.invalid/signed.jpg" alt="Bevis" />,
    );
    const img = screen.getByAltText('Bevis') as HTMLImageElement;
    // A `loading="lazy"` image with no layout box (display:none) can never
    // be measured as "near the viewport", so the browser never fetches it —
    // onLoad never fires — the loading state never clears. The <img> must
    // always keep a real box; only its opacity may change.
    expect(img.style.display).not.toBe('none');
    expect(getComputedStyle(img).display).not.toBe('none');
  });

  it('shows the image at full opacity once loaded, hidden only via opacity while loading', () => {
    render(
      <SignedProofImage src="https://example.invalid/signed.jpg" alt="Bevis" />,
    );
    const img = screen.getByAltText('Bevis') as HTMLImageElement;
    expect(img.style.opacity).toBe('0');
    fireEvent.load(img);
    expect(img.style.opacity).toBe('1');
  });

  it('shows a retry action on load failure, and calls onRetry + remounts the <img> on click', () => {
    const onRetry = vi.fn();
    render(
      <SignedProofImage
        src="https://example.invalid/broken.jpg"
        alt="Bevis"
        onRetry={onRetry}
      />,
    );
    const img = screen.getByAltText('Bevis');
    fireEvent.error(img);

    expect(screen.getByText('Bilden kunde inte laddas.')).toBeInTheDocument();
    const retryButton = screen.getByRole('button', { name: 'Försök igen' });
    fireEvent.click(retryButton);

    expect(onRetry).toHaveBeenCalledTimes(1);
    // Back to loading — the <img> is rendered again (a fresh element), never
    // display:none.
    const retriedImg = screen.getByAltText('Bevis') as HTMLImageElement;
    expect(retriedImg.style.display).not.toBe('none');
    expect(retriedImg.style.opacity).toBe('0');
  });

  it('still offers a retry action (re-requesting the same URL) when no onRetry is provided', () => {
    render(
      <SignedProofImage src="https://example.invalid/broken.jpg" alt="Bevis" />,
    );
    fireEvent.error(screen.getByAltText('Bevis'));
    const retryButton = screen.getByRole('button', { name: 'Försök igen' });
    expect(() => fireEvent.click(retryButton)).not.toThrow();
    expect(screen.getByAltText('Bevis')).toBeInTheDocument();
  });
});
