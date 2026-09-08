import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LikeBadge } from './LikeBadge';

describe('LikeBadge', () => {
  it('renders nothing when there are no likes', () => {
    const { container } = render(
      <LikeBadge likeCount={0} likedByMe={false} onToggle={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders a heart only (no digit) for exactly one like', () => {
    render(<LikeBadge likeCount={1} likedByMe={false} onToggle={vi.fn()} />);
    expect(screen.getByRole('button')).toBeInTheDocument();
    expect(screen.queryByText('1')).not.toBeInTheDocument();
  });

  it('renders heart + count for two or more likes', () => {
    render(<LikeBadge likeCount={2} likedByMe={false} onToggle={vi.fn()} />);
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('renders the count for a large number on one element with a tabular-nums hook', () => {
    render(<LikeBadge likeCount={17} likedByMe={false} onToggle={vi.fn()} />);
    const count = screen.getByText('17');
    expect(count.className).toContain('tnum');
  });

  it('is not pressed when the viewer has not liked', () => {
    render(<LikeBadge likeCount={4} likedByMe={false} onToggle={vi.fn()} />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'false');
  });

  it('is pressed when the viewer has liked (state, not only colour)', () => {
    render(<LikeBadge likeCount={4} likedByMe onToggle={vi.fn()} />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true');
  });

  it('has a singular accessible label for one liker', () => {
    render(<LikeBadge likeCount={1} likedByMe={false} onToggle={vi.fn()} />);
    expect(
      screen.getByRole('button', { name: '1 person gillar meddelandet' }),
    ).toBeInTheDocument();
  });

  it('has a plural accessible label for several likers', () => {
    render(<LikeBadge likeCount={3} likedByMe={false} onToggle={vi.fn()} />);
    expect(
      screen.getByRole('button', { name: '3 personer gillar meddelandet' }),
    ).toBeInTheDocument();
  });

  it('names the viewer when they are among the likers', () => {
    render(<LikeBadge likeCount={3} likedByMe onToggle={vi.fn()} />);
    expect(
      screen.getByRole('button', { name: 'Du och 2 andra gillar meddelandet' }),
    ).toBeInTheDocument();
  });

  it('uses the given subject noun (a training card says "passet")', () => {
    render(
      <LikeBadge
        likeCount={2}
        likedByMe={false}
        subject="passet"
        onToggle={vi.fn()}
      />,
    );
    expect(
      screen.getByRole('button', { name: '2 personer gillar passet' }),
    ).toBeInTheDocument();
  });

  it('calls onToggle when clicked', async () => {
    const onToggle = vi.fn();
    render(<LikeBadge likeCount={2} likedByMe={false} onToggle={onToggle} />);
    await userEvent.click(screen.getByRole('button'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('does not fire while disabled', async () => {
    const onToggle = vi.fn();
    render(
      <LikeBadge
        likeCount={2}
        likedByMe={false}
        onToggle={onToggle}
        disabled
      />,
    );
    expect(screen.getByRole('button')).toBeDisabled();
    await userEvent.click(screen.getByRole('button'));
    expect(onToggle).not.toHaveBeenCalled();
  });
});
