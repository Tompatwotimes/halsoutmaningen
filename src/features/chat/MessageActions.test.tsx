import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MessageActions } from './MessageActions';

const BASE = {
  likedByMe: false,
  likeLabel: 'Gilla meddelandet',
  replyLabel: 'Svara på Annas meddelande',
  onLike: vi.fn(),
  onReply: vi.fn(),
};

describe('MessageActions', () => {
  it('renders a like button and a reply button, both real <button>s', () => {
    render(<MessageActions {...BASE} />);
    const like = screen.getByRole('button', { name: 'Gilla meddelandet' });
    const reply = screen.getByRole('button', {
      name: 'Svara på Annas meddelande',
    });
    expect(like.tagName).toBe('BUTTON');
    expect(like).toHaveAttribute('type', 'button');
    expect(reply.tagName).toBe('BUTTON');
    expect(reply).toHaveAttribute('type', 'button');
  });

  it('shows the "remove like" label when the viewer has liked', () => {
    render(
      <MessageActions
        {...BASE}
        likedByMe
        likeLabel="Ta bort gilla-markering"
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Ta bort gilla-markering' }),
    ).toHaveAttribute('aria-pressed', 'true');
  });

  it('the like button is aria-pressed=false when not liked', () => {
    render(<MessageActions {...BASE} />);
    expect(
      screen.getByRole('button', { name: 'Gilla meddelandet' }),
    ).toHaveAttribute('aria-pressed', 'false');
  });

  it('invokes onLike on click and on keyboard activation', async () => {
    const onLike = vi.fn();
    render(<MessageActions {...BASE} onLike={onLike} />);
    const like = screen.getByRole('button', { name: 'Gilla meddelandet' });
    await userEvent.click(like);
    like.focus();
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard(' ');
    expect(onLike).toHaveBeenCalledTimes(3);
  });

  it('disables the like button while a like mutation is pending', async () => {
    const onLike = vi.fn();
    render(<MessageActions {...BASE} onLike={onLike} likeDisabled />);
    const like = screen.getByRole('button', { name: 'Gilla meddelandet' });
    expect(like).toBeDisabled();
    await userEvent.click(like);
    expect(onLike).not.toHaveBeenCalled();
  });

  it('invokes onReply on click', async () => {
    const onReply = vi.fn();
    render(<MessageActions {...BASE} onReply={onReply} />);
    await userEvent.click(
      screen.getByRole('button', { name: 'Svara på Annas meddelande' }),
    );
    expect(onReply).toHaveBeenCalledTimes(1);
  });

  it('carries the training-card like label when given one', () => {
    render(<MessageActions {...BASE} likeLabel="Gilla passet" />);
    expect(
      screen.getByRole('button', { name: 'Gilla passet' }),
    ).toBeInTheDocument();
  });
});
