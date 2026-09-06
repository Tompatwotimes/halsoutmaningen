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
});
