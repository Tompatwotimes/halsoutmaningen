import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReplyQuote } from './ReplyQuote';
import type { ReplyPreview } from './types';

function preview(over: Partial<ReplyPreview> = {}): ReplyPreview {
  return {
    deleted: false,
    messageId: 'p1',
    seq: 12,
    senderType: 'participant',
    senderUserId: 'u2',
    senderDisplayName: 'Anna',
    kind: 'text',
    text: 'Golf räknas inte',
    hasImage: false,
    training: null,
    ...over,
  };
}

describe('ReplyQuote', () => {
  it('renders the quoted sender label and preview line', () => {
    render(<ReplyQuote preview={preview()} viewerUserId="u1" />);
    expect(screen.getByText('Anna')).toBeInTheDocument();
    expect(screen.getByText('Golf räknas inte')).toBeInTheDocument();
  });

  it('is a button that calls onJump with the parent seq when clicked', async () => {
    const onJump = vi.fn();
    render(
      <ReplyQuote
        preview={preview({ seq: 34 })}
        viewerUserId="u1"
        onJump={onJump}
      />,
    );
    await userEvent.click(screen.getByRole('button'));
    expect(onJump).toHaveBeenCalledWith(34);
  });

  it('does not throw when clicked without an onJump handler (jump wired later)', async () => {
    render(<ReplyQuote preview={preview()} viewerUserId="u1" />);
    await userEvent.click(screen.getByRole('button'));
    // no assertion beyond "did not throw"
  });

  it('announces the reply relationship in its accessible name', () => {
    render(
      <ReplyQuote
        preview={preview({ senderDisplayName: 'Anna' })}
        viewerUserId="u1"
      />,
    );
    expect(
      screen.getByRole('button', { name: /Svar på Annas meddelande/ }),
    ).toBeInTheDocument();
  });

  it('for a hidden parent: accessible name is exactly the borttaget phrasing and NO content leaks', () => {
    render(
      <ReplyQuote
        preview={{ ...preview({ text: 'hemlig text' }), deleted: true }}
        viewerUserId="u1"
        onJump={vi.fn()}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Svar på ett borttaget meddelande' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('[Borttaget av administratör]'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/hemlig/)).toBeNull();
    expect(screen.queryByText('Anna')).toBeNull();
  });

  it('does not call onJump for a hidden parent (no jump to a withheld original)', async () => {
    const onJump = vi.fn();
    render(
      <ReplyQuote
        preview={{ ...preview(), deleted: true }}
        viewerUserId="u1"
        onJump={onJump}
      />,
    );
    await userEvent.click(screen.getByRole('button'));
    expect(onJump).not.toHaveBeenCalled();
  });
});
