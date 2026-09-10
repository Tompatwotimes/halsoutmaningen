import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatLightbox } from './ChatLightbox';

const urls = ['https://x/1', 'https://x/2', 'https://x/3'];

describe('ChatLightbox', () => {
  it('shows the image at startIndex and a counter', () => {
    render(<ChatLightbox urls={urls} startIndex={1} onClose={vi.fn()} />);
    expect(screen.getByRole('img')).toHaveAttribute('src', 'https://x/2');
    expect(screen.getByText('2 / 3')).toBeInTheDocument();
  });

  it('closes on the close button, the backdrop and Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { rerender } = render(
      <ChatLightbox urls={urls} startIndex={0} onClose={onClose} />,
    );
    await user.click(screen.getByRole('button', { name: 'Stäng' }));
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(<ChatLightbox urls={urls} startIndex={0} onClose={onClose} />);
    await user.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalledTimes(2);

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('navigates with the chevrons and wraps around', async () => {
    const user = userEvent.setup();
    render(<ChatLightbox urls={urls} startIndex={0} onClose={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Nästa bild' }));
    expect(screen.getByRole('img')).toHaveAttribute('src', 'https://x/2');
    await user.click(screen.getByRole('button', { name: 'Föregående bild' }));
    await user.click(screen.getByRole('button', { name: 'Föregående bild' }));
    expect(screen.getByRole('img')).toHaveAttribute('src', 'https://x/3');
  });

  it('shows a fallback for a denied (null) slot without crashing', () => {
    render(<ChatLightbox urls={[null]} startIndex={0} onClose={vi.fn()} />);
    expect(screen.getByText(/kunde inte laddas/i)).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('Escape closes ONLY the viewer — it does not bubble to an ancestor (the Sheet)', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const ancestorKeyDown = vi.fn();
    render(
      <div onKeyDown={ancestorKeyDown}>
        <ChatLightbox urls={urls} startIndex={0} onClose={onClose} />
      </div>,
    );
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(ancestorKeyDown).not.toHaveBeenCalled();
  });

  it('Escape still closes the viewer when focus has drifted outside it (opener detached)', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ChatLightbox urls={urls} startIndex={0} onClose={onClose} />);

    // Simulate the admin-hides-the-message case: the element that opened the
    // viewer is gone and focus has fallen back to <body>.
    (document.activeElement as HTMLElement | null)?.blur();
    document.body.focus();
    document.body.setAttribute('tabindex', '-1');
    document.body.focus();

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    document.body.removeAttribute('tabindex');
  });

  it('arrow keys still navigate when focus is outside the viewer', async () => {
    const user = userEvent.setup();
    render(<ChatLightbox urls={urls} startIndex={0} onClose={vi.fn()} />);
    document.body.setAttribute('tabindex', '-1');
    document.body.focus();

    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('img')).toHaveAttribute('src', 'https://x/2');
    document.body.removeAttribute('tabindex');
  });

  it('moves focus into the viewer on open and restores it to the opener on close', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    expect(document.activeElement).toBe(opener);

    const { unmount } = render(
      <ChatLightbox urls={urls} startIndex={0} onClose={vi.fn()} />,
    );
    expect(document.activeElement).toBe(screen.getByRole('dialog'));

    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});
