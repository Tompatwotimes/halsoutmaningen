import { beforeEach, describe, expect, it, vi } from 'vitest';

interface RpcResult {
  data: unknown;
  error: { message: string } | null;
}

const rpc = vi.fn<(fn: string, args: unknown) => Promise<RpcResult>>();

vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: (fn: string, args: unknown) => rpc(fn, args) },
}));

import {
  fetchNotificationPreferences,
  updateNotificationPreferences,
} from './preferences-api';

const rowFromServer = {
  user_id: 'u1',
  challenge_id: 'c1',
  chat_reply: true,
  chat_like: false,
  chat_all_messages: false,
  straffbanken: true,
  game_master: true,
  training_reminders: true,
  personal_status: true,
  daily_group_summary: true,
  updated_at: '2026-09-11T00:00:00Z',
};

beforeEach(() => {
  rpc.mockReset();
});

describe('fetchNotificationPreferences', () => {
  it('maps the snake_case row to camelCase', async () => {
    rpc.mockResolvedValue({ data: rowFromServer, error: null });
    const result = await fetchNotificationPreferences('c1');
    expect(rpc).toHaveBeenCalledWith('get_notification_preferences', {
      p_challenge_id: 'c1',
    });
    expect(result).toEqual({
      chatReply: true,
      chatLike: false,
      chatAllMessages: false,
      straffbanken: true,
      gameMaster: true,
      trainingReminders: true,
      personalStatus: true,
      dailyGroupSummary: true,
    });
  });

  it('throws on a server error', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(fetchNotificationPreferences('c1')).rejects.toThrow('boom');
  });
});

describe('updateNotificationPreferences', () => {
  it('sends only the changed field, leaving the rest undefined', async () => {
    rpc.mockResolvedValue({ data: rowFromServer, error: null });
    await updateNotificationPreferences('c1', { chatAllMessages: true });
    expect(rpc).toHaveBeenCalledWith('update_notification_preferences', {
      p_challenge_id: 'c1',
      p_chat_all_messages: true,
    });
  });

  it('sends every provided field', async () => {
    rpc.mockResolvedValue({ data: rowFromServer, error: null });
    await updateNotificationPreferences('c1', {
      chatReply: false,
      trainingReminders: false,
    });
    expect(rpc).toHaveBeenCalledWith('update_notification_preferences', {
      p_challenge_id: 'c1',
      p_chat_reply: false,
      p_training_reminders: false,
    });
  });
});
