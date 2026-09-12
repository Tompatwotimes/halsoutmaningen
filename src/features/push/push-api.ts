import { supabase } from '@/lib/supabase';
import { env } from '@/lib/env';
import { registerServiceWorker } from './registerServiceWorker';
import { detectPushCapability } from './capability';

export class PushError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PushError';
  }
}

export function notificationPermission():
  NotificationPermission | 'unsupported' {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission;
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const base64Safe = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64Safe);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

/**
 * Request permission (must be called from a user gesture) and, if granted,
 * subscribe the browser and register it server-side. Throws PushError with a
 * Swedish message on any failure — never leaves a half-registered state
 * silently.
 */
export async function enablePush(): Promise<void> {
  const capability = await detectPushCapability();
  if (capability === 'unsupported') {
    throw new PushError('Push-notiser stöds inte i den här webbläsaren.');
  }
  if (capability === 'error') {
    throw new PushError(
      'Kunde inte kontrollera stöd för notiser just nu. Försök igen om en liten stund.',
    );
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new PushError('Du behöver tillåta notiser för att aktivera dem.');
  }

  const registration =
    (await navigator.serviceWorker.ready.catch(() => null)) ??
    (await registerServiceWorker());
  if (!registration) {
    throw new PushError('Kunde inte starta bakgrundstjänsten för notiser.');
  }

  let subscription = await registration.pushManager.getSubscription();
  subscription ??= await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(
      env.webPushVapidPublicKey ?? '',
    ) as BufferSource,
  });

  const json = subscription.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!p256dh || !auth) {
    throw new PushError('Prenumerationen saknar nycklar.');
  }

  const { error } = await supabase.rpc('register_push_subscription', {
    p_endpoint: subscription.endpoint,
    p_p256dh: p256dh,
    p_auth_key: auth,
    p_user_agent: navigator.userAgent.slice(0, 400),
  });
  if (error) {
    throw new PushError(`Kunde inte spara prenumerationen: ${error.message}`);
  }
}

/** Unsubscribe the browser and remove the server-side row. Never throws. */
export async function disablePush(): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator))
    return;

  const registration = await navigator.serviceWorker
    .getRegistration()
    .catch(() => null);
  if (!registration) return;

  const subscription = await registration.pushManager
    .getSubscription()
    .catch(() => null);
  if (!subscription) return;

  const endpoint = subscription.endpoint;
  await subscription.unsubscribe().catch(() => undefined);
  try {
    await supabase.rpc('unregister_push_subscription', {
      p_endpoint: endpoint,
    });
  } catch {
    // Best-effort — see disablePush's own doc comment.
  }
}

/** Whether the current browser already holds an active PushSubscription. */
export async function hasActivePushSubscription(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator))
    return false;
  const registration = await navigator.serviceWorker
    .getRegistration()
    .catch(() => null);
  if (!registration) return false;
  const subscription = await registration.pushManager
    .getSubscription()
    .catch(() => null);
  return subscription !== null;
}

interface SelfTestResponse {
  results?: { outcome: string }[];
  error?: string;
}

export async function sendSelfTestPush(): Promise<{
  results: { outcome: string }[];
}> {
  const response = await supabase.functions.invoke<SelfTestResponse>(
    'notification-dispatcher',
    { body: { action: 'self-test' } },
  );
  const data = response.data;
  const invokeError = response.error as { message: string } | null;
  if (invokeError) {
    throw new PushError(
      `Testnotisen kunde inte skickas: ${invokeError.message}`,
    );
  }
  if (data?.error) {
    throw new PushError(data.error);
  }
  return { results: data?.results ?? [] };
}
