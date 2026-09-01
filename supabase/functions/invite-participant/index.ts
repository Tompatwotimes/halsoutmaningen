// ============================================================================
// invite-participant — privileged admin Edge Function
//
// Two actions (POST JSON body, `action` field):
//
//   { action: "invite", email, displayName, challengeId,
//     participationStartDate, participationEndDate? }
//       → verify caller is an admin
//       → create the Supabase Auth user + send the invite email (service role),
//         or resolve an already-existing account WITHOUT re-sending
//       → link / update the challenge membership AS THE CALLER (so RLS and the
//         audit trigger see the real admin identity)
//
//   { action: "account-status", challengeId }
//       → verify caller is an admin
//       → return non-sensitive auth status (invited vs. active) for the
//         challenge's members. auth.users is never exposed to the browser.
//
// The service-role key stays server-side (CLAUDE.md §19). Nothing here weakens
// RLS: the membership write goes through the normal authenticated policy.
//
// Idempotency / recovery: see docs/INVITE_FLOW.md. The invite email is only
// ever sent when a brand-new auth user is created; every retry path after that
// is a no-email upsert.
// ============================================================================

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import {
  accountStatusInputSchema,
  firstIssueMessage,
  inviteInputSchema,
  type InviteInput,
} from '../_shared/validation.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
// Where the invite / reset email should land the user. Falls back to the
// project URL if unset, but SITE_URL should be configured explicitly.
const SITE_URL = Deno.env.get('SITE_URL') ?? SUPABASE_URL;

interface CallerContext {
  callerId: string;
  asCaller: SupabaseClient;
  asService: SupabaseClient;
}

async function authenticateAdmin(
  authHeader: string,
): Promise<CallerContext | Response> {
  const asCaller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await asCaller.auth.getUser();
  if (userError || !userData.user) {
    return jsonResponse({ error: 'Ogiltig session.' }, 401);
  }

  // Admin status comes from the database predicate, never from the client.
  const { data: isAdmin, error: adminError } = await asCaller.rpc('is_admin');
  if (adminError) {
    return jsonResponse({ error: 'Behörighetskontroll misslyckades.' }, 500);
  }
  if (isAdmin !== true) {
    return jsonResponse(
      { error: 'Endast administratörer får utföra denna åtgärd.' },
      403,
    );
  }

  const asService = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return { callerId: userData.user.id, asCaller, asService };
}

async function findUserIdByEmail(
  asService: SupabaseClient,
  email: string,
): Promise<string | null> {
  const target = email.toLowerCase();
  // Small user base; page through until found. perPage max is 1000.
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await asService.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (error) {
      throw new Error(error.message);
    }
    const match = data.users.find((u) => u.email?.toLowerCase() === target);
    if (match) {
      return match.id;
    }
    if (data.users.length < 1000) {
      return null;
    }
  }
  return null;
}

function isAlreadyRegistered(error: { message?: string; status?: number; code?: string }): boolean {
  const msg = (error.message ?? '').toLowerCase();
  return (
    error.code === 'email_exists' ||
    error.status === 422 ||
    msg.includes('already been registered') ||
    msg.includes('already registered') ||
    msg.includes('already exists')
  );
}

async function handleInvite(
  ctx: CallerContext,
  input: InviteInput,
): Promise<Response> {
  const { callerId, asCaller, asService } = ctx;
  const endDate = input.participationEndDate ?? null;

  // ----------------------------------------------------------------------
  // 1. Resolve or create the auth user.
  // ----------------------------------------------------------------------
  let userId: string;
  let existingUser = false;

  const { data: invited, error: inviteError } =
    await asService.auth.admin.inviteUserByEmail(input.email, {
      data: { display_name: input.displayName },
      redirectTo: `${SITE_URL}/aktivera`,
    });

  if (invited?.user) {
    userId = invited.user.id;
  } else if (inviteError && isAlreadyRegistered(inviteError)) {
    existingUser = true;
    const found = await findUserIdByEmail(asService, input.email);
    if (!found) {
      return jsonResponse(
        { error: 'E-postadressen har redan ett konto som inte kunde hämtas.' },
        502,
      );
    }
    userId = found;
  } else {
    return jsonResponse(
      {
        error: `Inbjudan kunde inte skickas: ${inviteError?.message ?? 'okänt fel'}`,
      },
      502,
    );
  }

  // ----------------------------------------------------------------------
  // 2. Make sure a profile row exists. The on_auth_user_created trigger
  //    normally does this for new users; never overwrite an existing name.
  // ----------------------------------------------------------------------
  const { error: profileError } = await asService
    .from('profiles')
    .upsert(
      { id: userId, display_name: input.displayName },
      { onConflict: 'id', ignoreDuplicates: true },
    );
  if (profileError) {
    return jsonResponse(
      {
        error: `Kontot skapades men profilen kunde inte förberedas: ${profileError.message}`,
        userId,
        recoverable: true,
      },
      500,
    );
  }

  // ----------------------------------------------------------------------
  // 3. Link / update the challenge membership AS THE CALLER. Goes through
  //    challenge_memberships_insert RLS (requires is_admin()) and the audit
  //    trigger records actor_user_id = the admin.
  // ----------------------------------------------------------------------
  const { data: existingMembership, error: selectError } = await asCaller
    .from('challenge_memberships')
    .select('id, participation_start_date, participation_end_date, active')
    .eq('challenge_id', input.challengeId)
    .eq('user_id', userId)
    .maybeSingle();

  if (selectError) {
    return jsonResponse(
      {
        error: `Kunde inte läsa befintligt medlemskap: ${selectError.message}`,
        userId,
        recoverable: true,
      },
      500,
    );
  }

  if (!existingMembership) {
    const { error: insertError } = await asCaller
      .from('challenge_memberships')
      .insert({
        challenge_id: input.challengeId,
        user_id: userId,
        participation_start_date: input.participationStartDate,
        participation_end_date: endDate,
        active: true,
        created_by: callerId,
      });

    if (insertError) {
      // The auth user / invite already exists. Re-submitting the same form
      // resolves the existing user (no new email) and retries this insert.
      return jsonResponse(
        {
          error: `Kontot är klart men medlemskapet kunde inte skapas: ${insertError.message}. Skicka formuläret igen för att försöka på nytt.`,
          userId,
          recoverable: true,
        },
        500,
      );
    }

    return jsonResponse({
      status: existingUser ? 'linked' : 'invited',
      userId,
      existingUser,
      displayName: input.displayName,
      message: existingUser
        ? 'Kontot fanns redan och är nu kopplat till utmaningen.'
        : 'Inbjudan skickad.',
    });
  }

  // Membership already present.
  const unchanged =
    existingMembership.participation_start_date ===
      input.participationStartDate &&
    (existingMembership.participation_end_date ?? null) === endDate &&
    existingMembership.active === true;

  if (unchanged) {
    return jsonResponse({
      status: 'already_member',
      userId,
      existingUser,
      displayName: input.displayName,
      message: 'Personen är redan deltagare i utmaningen.',
    });
  }

  const { error: updateError } = await asCaller
    .from('challenge_memberships')
    .update({
      participation_start_date: input.participationStartDate,
      participation_end_date: endDate,
      active: true,
    })
    .eq('id', existingMembership.id);

  if (updateError) {
    return jsonResponse(
      {
        error: `Medlemskapet kunde inte uppdateras: ${updateError.message}`,
        userId,
        recoverable: true,
      },
      500,
    );
  }

  return jsonResponse({
    status: 'membership_updated',
    userId,
    existingUser,
    displayName: input.displayName,
    message: 'Deltagarens period uppdaterades.',
  });
}

async function handleAccountStatus(
  ctx: CallerContext,
  challengeId: string,
): Promise<Response> {
  const { asCaller, asService } = ctx;

  const { data: memberships, error: memErr } = await asCaller
    .from('challenge_memberships')
    .select('user_id')
    .eq('challenge_id', challengeId);

  if (memErr) {
    return jsonResponse({ error: memErr.message }, 500);
  }

  const wanted = new Set((memberships ?? []).map((m) => m.user_id as string));
  const accounts: {
    userId: string;
    state: 'invited' | 'active' | 'unknown';
    invitedAt: string | null;
    lastSignInAt: string | null;
  }[] = [];

  for (let page = 1; page <= 20 && accounts.length < wanted.size; page += 1) {
    const { data, error } = await asService.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (error) {
      return jsonResponse({ error: error.message }, 500);
    }
    for (const u of data.users) {
      if (!wanted.has(u.id)) continue;
      const lastSignInAt = u.last_sign_in_at ?? null;
      accounts.push({
        userId: u.id,
        state: lastSignInAt ? 'active' : 'invited',
        invitedAt: u.invited_at ?? null,
        lastSignInAt,
      });
    }
    if (data.users.length < 1000) break;
  }

  return jsonResponse({ accounts });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Endast POST stöds.' }, 405);
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return jsonResponse({ error: 'Saknar Authorization-huvud.' }, 401);
  }

  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
    return jsonResponse({ error: 'Funktionen är felkonfigurerad.' }, 500);
  }

  const ctx = await authenticateAdmin(authHeader);
  if (ctx instanceof Response) {
    return ctx;
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: 'Ogiltig JSON.' }, 400);
  }

  const action =
    (payload as { action?: string } | null)?.action ?? 'invite';

  if (action === 'account-status') {
    const parsed = accountStatusInputSchema.safeParse(payload);
    if (!parsed.success) {
      return jsonResponse({ error: firstIssueMessage(parsed.error) }, 422);
    }
    return handleAccountStatus(ctx, parsed.data.challengeId);
  }

  if (action === 'invite') {
    const parsed = inviteInputSchema.safeParse(payload);
    if (!parsed.success) {
      return jsonResponse({ error: firstIssueMessage(parsed.error) }, 422);
    }
    return handleInvite(ctx, parsed.data);
  }

  return jsonResponse({ error: `Okänd åtgärd: ${action}` }, 400);
});
