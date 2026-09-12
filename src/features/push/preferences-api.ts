import { supabase } from '@/lib/supabase';

export interface NotificationPreferences {
  chatReply: boolean;
  chatLike: boolean;
  chatAllMessages: boolean;
  straffbanken: boolean;
  gameMaster: boolean;
  trainingReminders: boolean;
  personalStatus: boolean;
  dailyGroupSummary: boolean;
}

export type NotificationPreferencesPatch = Partial<NotificationPreferences>;

export async function fetchNotificationPreferences(
  challengeId: string,
): Promise<NotificationPreferences> {
  const { data, error } = await supabase.rpc('get_notification_preferences', {
    p_challenge_id: challengeId,
  });
  if (error) throw new Error(error.message);
  return {
    chatReply: data.chat_reply,
    chatLike: data.chat_like,
    chatAllMessages: data.chat_all_messages,
    straffbanken: data.straffbanken,
    gameMaster: data.game_master,
    trainingReminders: data.training_reminders,
    personalStatus: data.personal_status,
    dailyGroupSummary: data.daily_group_summary,
  };
}

export async function updateNotificationPreferences(
  challengeId: string,
  patch: NotificationPreferencesPatch,
): Promise<NotificationPreferences> {
  const args: {
    p_challenge_id: string;
    p_chat_reply?: boolean;
    p_chat_like?: boolean;
    p_chat_all_messages?: boolean;
    p_straffbanken?: boolean;
    p_game_master?: boolean;
    p_training_reminders?: boolean;
    p_personal_status?: boolean;
    p_daily_group_summary?: boolean;
  } = { p_challenge_id: challengeId };
  if (patch.chatReply !== undefined) args.p_chat_reply = patch.chatReply;
  if (patch.chatLike !== undefined) args.p_chat_like = patch.chatLike;
  if (patch.chatAllMessages !== undefined)
    args.p_chat_all_messages = patch.chatAllMessages;
  if (patch.straffbanken !== undefined)
    args.p_straffbanken = patch.straffbanken;
  if (patch.gameMaster !== undefined) args.p_game_master = patch.gameMaster;
  if (patch.trainingReminders !== undefined)
    args.p_training_reminders = patch.trainingReminders;
  if (patch.personalStatus !== undefined)
    args.p_personal_status = patch.personalStatus;
  if (patch.dailyGroupSummary !== undefined)
    args.p_daily_group_summary = patch.dailyGroupSummary;

  const { data, error } = await supabase.rpc(
    'update_notification_preferences',
    args,
  );
  if (error) throw new Error(error.message);
  return {
    chatReply: data.chat_reply,
    chatLike: data.chat_like,
    chatAllMessages: data.chat_all_messages,
    straffbanken: data.straffbanken,
    gameMaster: data.game_master,
    trainingReminders: data.training_reminders,
    personalStatus: data.personal_status,
    dailyGroupSummary: data.daily_group_summary,
  };
}
