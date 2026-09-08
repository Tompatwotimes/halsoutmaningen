import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ChatImageGrid } from './ChatImageGrid';
import type { ChatAttachment } from './types';

const { signed } = vi.hoisted(() => ({ signed: vi.fn() }));
vi.mock('./chat-media', () => ({ chatImageSignedUrl: signed }));

function wrap(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

function atts(n: number): ChatAttachment[] {
  return Array.from({ length: n }, (_, i) => ({
    position: i + 1,
    path: `c/u/m/${i + 1}-x.jpg`,
  }));
}

describe('ChatImageGrid', () => {
  it('tags the grid with the attachment count for the layout', async () => {
    signed.mockResolvedValue('https://x/y');
    wrap(<ChatImageGrid messageId="m" attachments={atts(3)} />);
    expect(await screen.findByTestId('chat-image-grid')).toHaveAttribute(
      'data-count',
      '3',
    );
  });

  it('opens the lightbox when a thumbnail is clicked', async () => {
    const user = userEvent.setup();
    signed.mockResolvedValue('https://x/y');
    wrap(<ChatImageGrid messageId="m" attachments={atts(2)} />);
    const [firstThumb] = await screen.findAllByRole('button', {
      name: /Öppna bild/,
    });
    await user.click(firstThumb!);
    expect(
      screen.getByRole('dialog', { name: 'Bildvisning' }),
    ).toBeInTheDocument();
  });

  it('shows a broken-image slot when a URL is denied, without crashing', async () => {
    signed.mockResolvedValue(null);
    wrap(<ChatImageGrid messageId="m" attachments={atts(1)} />);
    expect(
      await screen.findByLabelText('Bilden kunde inte laddas'),
    ).toBeInTheDocument();
  });

  it('marks each thumbnail with data-chat-image so a double-tap can still like the message', async () => {
    signed.mockResolvedValue('https://x/y');
    wrap(<ChatImageGrid messageId="m" attachments={atts(2)} />);
    const thumbs = await screen.findAllByRole('button', { name: /Öppna bild/ });
    for (const t of thumbs) expect(t).toHaveAttribute('data-chat-image');
  });

  it('registers a close-lightbox callback while the lightbox is open and clears it when closed', async () => {
    const user = userEvent.setup();
    signed.mockResolvedValue('https://x/y');
    const register = vi.fn();
    wrap(
      <ChatImageGrid
        messageId="m"
        attachments={atts(1)}
        registerLightboxClose={register}
      />,
    );
    const [thumb] = await screen.findAllByRole('button', { name: /Öppna bild/ });
    await user.click(thumb!);
    // opened → a close fn was registered
    const lastFn = register.mock.calls.at(-1)?.[0];
    expect(typeof lastFn).toBe('function');
    expect(
      screen.getByRole('dialog', { name: 'Bildvisning' }),
    ).toBeInTheDocument();
    // calling it closes the lightbox and de-registers
    register.mockClear();
    lastFn();
    expect(
      screen.queryByRole('dialog', { name: 'Bildvisning' }),
    ).not.toBeInTheDocument();
    expect(register).toHaveBeenLastCalledWith(null);
  });
});
