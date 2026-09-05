import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ChatMessage } from '@/features/chat/types';

/**
 * The moderation affordance is admin-only and always requires a written reason
 * before it will hide anything (spec §6 / CLAUDE.md §6). It never shows the
 * original body — hiding is destructive-looking to participants but the row is
 * retained server-side.
 */

const { hideMock } = vi.hoisted(() => ({
  hideMock: {
    mutate: vi.fn(),
    reset: vi.fn(),
    isPending: false,
    isError: false,
    error: null as Error | null,
  },
}));

vi.mock('./chat-admin-api', () => ({
  useHideChatMessage: () => hideMock,
}));

import { ChatModerationSheet } from './ChatModerationSheet';

function message(over: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'm1',
    seq: 1,
    challengeId: 'c1',
    senderType: 'participant',
    senderUserId: 'u2',
    senderDisplayName: 'Anna',
    body: 'något olämpligt',
    status: 'active',
    hiddenReason: null,
    gameMasterEventId: null,
    createdAt: '2026-09-05T12:00:00Z',
    ...over,
  };
}

afterEach(() => {
  vi.clearAllMocks();
  hideMock.isPending = false;
  hideMock.isError = false;
  hideMock.error = null;
});

describe('ChatModerationSheet', () => {
  it('requires a non-empty reason before it will hide the message', async () => {
    const user = userEvent.setup({ delay: null });
    render(
      <ChatModerationSheet message={message()} challengeId="c1" isAdmin />,
    );

    await user.click(screen.getByRole('button', { name: 'Dölj' }));

    const dialog = screen.getByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Dölj' });
    expect(confirm).toBeDisabled();

    await user.type(within(dialog).getByRole('textbox'), '  ');
    expect(confirm).toBeDisabled();

    await user.type(within(dialog).getByRole('textbox'), 'Kränkande språk');
    expect(confirm).toBeEnabled();

    await user.click(confirm);
    expect(hideMock.mutate).toHaveBeenCalledTimes(1);
    expect(hideMock.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 'm1',
        challengeId: 'c1',
        reason: 'Kränkande språk',
      }),
      expect.anything(),
    );
  });

  it('shows no moderation trigger to a non-admin viewer', () => {
    render(
      <ChatModerationSheet
        message={message()}
        challengeId="c1"
        isAdmin={false}
      />,
    );
    expect(
      screen.queryByRole('button', { name: /dölj|ta bort/i }),
    ).not.toBeInTheDocument();
  });

  it('shows no trigger for an already-hidden message', () => {
    render(
      <ChatModerationSheet
        message={message({ status: 'hidden' })}
        challengeId="c1"
        isAdmin
      />,
    );
    expect(
      screen.queryByRole('button', { name: /dölj/i }),
    ).not.toBeInTheDocument();
  });
});
