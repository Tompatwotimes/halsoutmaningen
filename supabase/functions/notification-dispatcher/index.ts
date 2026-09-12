// ============================================================================
// notification-dispatcher — the Web Push send path
//
// Two actions (POST JSON body, `action` field):
//
//   { action: "dispatch" }
//       Bearer auth: CRON_SECRET (a scheduled GitHub Actions job, NOT a user
//       session). Claims a batch of ready notification_outbox rows
//       (_claim_notification_outbox_batch — the one thing that genuinely
//       needs FOR UPDATE SKIP LOCKED, no PostgREST equivalent) and sends a
//       VAPID Web Push to every active subscription of each row's recipient.
//       Everything past the claim is a plain service-role table write, which
//       bypasses RLS exactly as 0031's schema comments describe.
//
//   { action: "self-test" }
//       Bearer auth: a real user session (validated the same way
//       invite-participant validates its caller). Sends one real push
//       through the same VAPID send path directly to the caller's own active
//       subscriptions — an immediate feedback loop for the Profil → Notiser
//       "Skicka testnotis" button. Deliberately does not touch
//       notification_outbox/notification_deliveries: a self-test is neither
//       deduped nor retried, so it has no queue state to keep.
//
// The service-role key and the VAPID private key stay server-side (CLAUDE.md
// §19). No push payload ever carries a signed image URL or a quoted chat
// body (spec §2) — every outbox row's title/body is already fixed,
// category-generic copy by the time it reaches here.
// ============================================================================

import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';
import { corsHeaders, jsonResponse } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const VAPID_PUBLIC_KEY = Deno.env.get('WEB_PUSH_VAPID_PUBLIC_KEY') ?? '';
const VAPID_PRIVATE_KEY = Deno.env.get('WEB_PUSH_VAPID_PRIVATE_KEY') ?? '';
const VAPID_SUBJECT = Deno.env.get('WEB_PUSH_VAPID_SUBJECT') ?? '';
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? '';

const MAX_ATTEMPTS = 5;
const BATCH_LIMIT = 50;

interface OutboxRow {
  id: string;
  recipient_id: string;
  category: string;
  title: string;
  body: string;
  url: string;
  tag: string;
  attempt_count: number;
  source_message_id: string | null;
}

interface SubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth_key: string;
}

function vapidConfigured(): boolean {
  return Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT);
}

function configureWebPush(): void {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

type SendOutcome = 'sent' | 'retired' | 'retry' | 'failed';

async function sendOne(
  sub: SubscriptionRow,
  payload: string,
): Promise<{ outcome: SendOutcome; statusCode: number | null; error?: string }> {
  try {
    await webpush.sendNotification(
      {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth_key },
      },
      payload,
      { TTL: 60 * 60 * 24 },
    );
    return { outcome: 'sent', statusCode: 201 };
  } catch (err) {
    const statusCode =
      typeof err === 'object' && err !== null && 'statusCode' in err
        ? Number((err as { statusCode: unknown }).statusCode)
        : null;
    const message = err instanceof Error ? err.message : String(err);

    if (statusCode === 404 || statusCode === 410) {
      return { outcome: 'retired', statusCode, error: message };
    }
    if (statusCode === 429 || (statusCode !== null && statusCode >= 500)) {
      return { outcome: 'retry', statusCode, error: message };
    }
    return { outcome: 'failed', statusCode, error: message };
  }
}

async function handleDispatch(): Promise<Response> {
  if (!vapidConfigured()) {
    return jsonResponse({ error: 'VAPID är inte konfigurerat.' }, 500);
  }
  configureWebPush();

  const asService = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const runId = crypto.randomUUID();
  const { data: claimed, error: claimError } = await asService.rpc(
    '_claim_notification_outbox_batch',
    { p_limit: BATCH_LIMIT, p_claimed_by: runId },
  );
  if (claimError) {
    return jsonResponse({ error: claimError.message }, 500);
  }

  const rows = (claimed ?? []) as OutboxRow[];
  let sentCount = 0;
  let retriedLaterCount = 0;
  let failedCount = 0;

  for (const row of rows) {
    // A chat reply/like/all-message push whose source message has since been
    // hidden must not be delivered (spec §2, "skip its chat push where
    // practical") — even though the copy never quotes the body either way.
    if (row.source_message_id) {
      const { data: message } = await asService
        .from('chat_messages')
        .select('status')
        .eq('id', row.source_message_id)
        .maybeSingle();
      if (!message || message.status !== 'active') {
        await asService
          .from('notification_outbox')
          .update({
            failed_at: new Date().toISOString(),
            last_error: 'source_message_hidden',
          })
          .eq('id', row.id);
        failedCount += 1;
        continue;
      }
    }

    const { data: subs, error: subsError } = await asService
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth_key')
      .eq('user_id', row.recipient_id)
      .is('retired_at', null);

    if (subsError) {
      await asService
        .from('notification_outbox')
        .update({ failed_at: new Date().toISOString(), last_error: subsError.message })
        .eq('id', row.id);
      failedCount += 1;
      continue;
    }

    const subscriptions = (subs ?? []) as SubscriptionRow[];
    if (subscriptions.length === 0) {
      await asService
        .from('notification_outbox')
        .update({
          failed_at: new Date().toISOString(),
          last_error: 'no_active_subscriptions',
        })
        .eq('id', row.id);
      failedCount += 1;
      continue;
    }

    const payload = JSON.stringify({
      title: row.title,
      body: row.body,
      url: row.url,
      tag: row.tag,
    });

    let anySent = false;
    let anyRetry = false;
    const errors: string[] = [];

    for (const sub of subscriptions) {
      const result = await sendOne(sub, payload);

      const { data: existingDelivery } = await asService
        .from('notification_deliveries')
        .select('attempt_count')
        .eq('outbox_id', row.id)
        .eq('subscription_id', sub.id)
        .maybeSingle();

      await asService.from('notification_deliveries').upsert(
        {
          outbox_id: row.id,
          subscription_id: sub.id,
          sent_at: result.outcome === 'sent' ? new Date().toISOString() : null,
          status_code: result.statusCode,
          outcome: result.outcome,
          attempt_count: (existingDelivery?.attempt_count ?? 0) + 1,
        },
        { onConflict: 'outbox_id,subscription_id' },
      );

      if (result.outcome === 'sent') {
        anySent = true;
        await asService
          .from('push_subscriptions')
          .update({ last_seen_at: new Date().toISOString() })
          .eq('id', sub.id);
      } else if (result.outcome === 'retired') {
        await asService
          .from('push_subscriptions')
          .update({ retired_at: new Date().toISOString() })
          .eq('id', sub.id);
      } else if (result.outcome === 'retry') {
        anyRetry = true;
      }
      if (result.error) errors.push(result.error);
    }

    if (anySent) {
      await asService
        .from('notification_outbox')
        .update({ sent_at: new Date().toISOString() })
        .eq('id', row.id);
      sentCount += 1;
    } else if (anyRetry && row.attempt_count < MAX_ATTEMPTS) {
      const backoffMinutes = Math.min(60, 2 ** row.attempt_count);
      await asService
        .from('notification_outbox')
        .update({
          not_before: new Date(Date.now() + backoffMinutes * 60_000).toISOString(),
          last_error: errors.join('; ').slice(0, 1000),
        })
        .eq('id', row.id);
      retriedLaterCount += 1;
    } else {
      await asService
        .from('notification_outbox')
        .update({
          failed_at: new Date().toISOString(),
          last_error: errors.join('; ').slice(0, 1000),
        })
        .eq('id', row.id);
      failedCount += 1;
    }
  }

  return jsonResponse({
    claimed: rows.length,
    sent: sentCount,
    retriedLater: retriedLaterCount,
    failed: failedCount,
  });
}

async function handleSelfTest(authHeader: string): Promise<Response> {
  if (!vapidConfigured()) {
    return jsonResponse({ error: 'VAPID är inte konfigurerat.' }, 500);
  }
  configureWebPush();

  const asCaller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await asCaller.auth.getUser();
  if (userError || !userData.user) {
    return jsonResponse({ error: 'Ogiltig session.' }, 401);
  }

  const { data: claimed, error: claimError } = await asCaller.rpc(
    'try_claim_self_test_notification',
  );
  if (claimError) {
    // Raised only when the caller has no active membership in a
    // push-enabled challenge — the kill switch must block self-test too.
    return jsonResponse({ error: 'Notiser är avstängda just nu.' }, 403);
  }
  if (!claimed) {
    return jsonResponse({ error: 'Vänta en liten stund innan du skickar igen.' }, 429);
  }

  const { data: subs, error: subsError } = await asCaller
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth_key')
    .is('retired_at', null);

  if (subsError) {
    return jsonResponse({ error: subsError.message }, 500);
  }
  const subscriptions = (subs ?? []) as SubscriptionRow[];
  if (subscriptions.length === 0) {
    return jsonResponse(
      { error: 'Inga aktiva enheter. Aktivera notiser i den här webbläsaren först.' },
      404,
    );
  }

  const payload = JSON.stringify({
    title: 'Testnotis',
    body: 'Om du ser den här fungerar notiser på den här enheten.',
    url: '/profil',
    tag: 'self-test',
  });

  const results = await Promise.all(
    subscriptions.map(async (sub) => {
      const result = await sendOne(sub, payload);
      return { subscriptionId: sub.id, outcome: result.outcome };
    }),
  );

  return jsonResponse({ results });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Endast POST stöds.' }, 405);
  }
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return jsonResponse({ error: 'Funktionen är felkonfigurerad.' }, 500);
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return jsonResponse({ error: 'Saknar Authorization-huvud.' }, 401);
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: 'Ogiltig JSON.' }, 400);
  }

  const action = (payload as { action?: string } | null)?.action;

  if (action === 'dispatch') {
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!CRON_SECRET || token !== CRON_SECRET) {
      return jsonResponse({ error: 'Ogiltig cron-hemlighet.' }, 401);
    }
    return handleDispatch();
  }

  if (action === 'self-test') {
    return handleSelfTest(authHeader);
  }

  return jsonResponse({ error: `Okänd åtgärd: ${String(action)}` }, 400);
});
