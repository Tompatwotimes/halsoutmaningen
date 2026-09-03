/**
 * Turns a raw `audit_log` row into a human-readable Swedish event for the
 * Granskningslogg. Pure — the name resolver is injected. No auth tokens or
 * secrets are ever in `audit_log`, so there is nothing to strip; we simply
 * surface the meaningful fields.
 */

export interface AuditRow {
  id: string;
  actorUserId: string | null;
  challengeId: string | null;
  targetUserId: string | null;
  entityType: string;
  entityId: string | null;
  action: string;
  beforeData: Record<string, unknown> | null;
  afterData: Record<string, unknown> | null;
  note: string | null;
  createdAt: string;
}

export interface AuditChange {
  label: string;
  before: string;
  after: string;
}

export interface DescribedAudit {
  /** e.g. "Straff tilldelat" */
  title: string;
  /** One-line context sentence. */
  detail: string;
  /** Field-level before → after, when relevant. */
  changes: AuditChange[];
  /** "Anna" / "Automatiskt" / "Systemet". */
  actor: string;
  category: 'challenge' | 'membership' | 'training' | 'penalty' | 'other';
}

export type NameResolver = (userId: string | null | undefined) => string;

const RULE_FIELDS: {
  key: string;
  label: string;
  fmt?: (v: unknown) => string;
}[] = [
  { key: 'name', label: 'Namn' },
  { key: 'start_date', label: 'Startdatum' },
  { key: 'end_date', label: 'Slutdatum' },
  { key: 'timezone', label: 'Tidszon' },
  {
    key: 'required_minutes',
    label: 'Krav (minuter)',
    fmt: (v) => `${String(v)} min`,
  },
  {
    key: 'proof_required',
    label: 'Bildbevis',
    fmt: (v) => (v ? 'krävs' : 'krävs inte'),
  },
  {
    key: 'missed_day_cost',
    label: 'Kostnad/missad dag',
    fmt: (v) => `${String(v)} kr`,
  },
  { key: 'status', label: 'Status' },
];

function str(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'ja' : 'nej';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}

function diff(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  fields: typeof RULE_FIELDS,
): AuditChange[] {
  if (!before || !after) return [];
  const out: AuditChange[] = [];
  for (const f of fields) {
    if (before[f.key] !== after[f.key]) {
      const fmt = f.fmt ?? str;
      out.push({
        label: f.label,
        before: fmt(before[f.key] ?? null),
        after: fmt(after[f.key] ?? null),
      });
    }
  }
  return out;
}

export function describeAuditEvent(
  row: AuditRow,
  resolveName: NameResolver,
): DescribedAudit {
  const actorRaw = row.afterData?.auto === true ? null : row.actorUserId;
  const actor =
    row.afterData?.auto === true
      ? 'Automatiskt'
      : actorRaw
        ? resolveName(actorRaw)
        : 'Systemet';
  const target = resolveName(row.targetUserId);
  const data = row.afterData ?? row.beforeData ?? {};
  const name = (data.display_name ?? data.name ?? '') as string;

  const base: Omit<
    DescribedAudit,
    'title' | 'detail' | 'changes' | 'category'
  > = { actor };

  switch (row.action) {
    case 'challenge_created':
      return {
        ...base,
        category: 'challenge',
        title: 'Utmaning skapad',
        detail: `${actor} skapade "${name}"${
          typeof row.note === 'string' && row.note ? ` (${row.note})` : ''
        }.`,
        changes: [],
      };
    case 'challenge_activated':
      return {
        ...base,
        category: 'challenge',
        title: 'Utmaning aktiverad',
        detail: `${actor} aktiverade utmaningen. Reglerna är nu låsta.`,
        changes: [],
      };
    case 'challenge_completed':
      return {
        ...base,
        category: 'challenge',
        title: 'Utmaning avslutad',
        detail: `${actor} avslutade utmaningen.`,
        changes: [],
      };
    case 'challenge_archived':
      return {
        ...base,
        category: 'challenge',
        title: 'Utmaning arkiverad',
        detail: `${actor} arkiverade utmaningen.`,
        changes: [],
      };
    case 'challenge_reopened':
      return {
        ...base,
        category: 'challenge',
        title: 'Utmaning återöppnad',
        detail: `${actor} återöppnade utmaningen${
          typeof row.note === 'string' && row.note ? ` (${row.note})` : ''
        }.`,
        changes: [],
      };
    case 'challenge_start_date_corrected':
      return {
        ...base,
        category: 'challenge',
        title: 'Startdatum rättat',
        detail: `${actor} rättade startdatumet från ${str(
          row.beforeData?.start_date,
        )} till ${str(row.afterData?.start_date)}${
          row.note ? `: ${row.note}` : ''
        }.`,
        changes: diff(row.beforeData, row.afterData, [
          { key: 'start_date', label: 'Startdatum' },
        ]),
      };
    case 'challenge_rules_changed':
      return {
        ...base,
        category: 'challenge',
        title: 'Regler ändrade',
        detail: `${actor} ändrade utmaningens regler.`,
        changes: diff(row.beforeData, row.afterData, RULE_FIELDS),
      };
    case 'penalties_bootstrapped':
      return {
        ...base,
        category: 'penalty',
        title: 'Standardstraff infört',
        detail: row.note ?? 'Standardstraff infört i utmaningen.',
        changes: [],
      };
    case 'penalties_expired':
      return {
        ...base,
        category: 'penalty',
        title: 'Straff gick ut',
        detail:
          row.note ?? 'Oanvända straff gick ut när utmaningen avslutades.',
        changes: [],
      };
    case 'membership_created':
      return {
        ...base,
        category: 'membership',
        title: 'Deltagare tillagd',
        detail: `${actor} lade till ${target} i utmaningen.`,
        changes: [],
      };
    case 'membership_window_changed':
      return {
        ...base,
        category: 'membership',
        title: 'Deltagandeperiod ändrad',
        detail: `${actor} ändrade ${target}s deltagandeperiod.`,
        changes: diff(row.beforeData, row.afterData, [
          { key: 'participation_start_date', label: 'Från' },
          { key: 'participation_end_date', label: 'Till' },
        ]),
      };
    case 'membership_deactivated':
      return {
        ...base,
        category: 'membership',
        title: 'Deltagande pausat',
        detail: `${actor} pausade ${target}s deltagande.`,
        changes: [],
      };
    case 'membership_reactivated':
      return {
        ...base,
        category: 'membership',
        title: 'Deltagande återupptaget',
        detail: `${actor} återupptog ${target}s deltagande.`,
        changes: [],
      };
    case 'invalidate':
      return {
        ...base,
        category: 'training',
        title: 'Pass ogiltigförklarat',
        detail: `${actor} ogiltigförklarade ${target}s pass${
          row.note ? `: ${row.note}` : ''
        }.`,
        changes: [],
      };
    case 'revalidate':
      return {
        ...base,
        category: 'training',
        title: 'Pass återställt',
        detail: `${actor} återställde ${target}s pass${
          row.note ? `: ${row.note}` : ''
        }.`,
        changes: [],
      };
    case 'penalty_earned':
      return {
        ...base,
        category: 'penalty',
        title: 'Straff intjänat',
        detail: `${target} tjänade in "${name}"${
          typeof data.earned_on_date === 'string'
            ? ` (${data.earned_on_date})`
            : ''
        }.`,
        changes: [],
      };
    case 'penalty_revoked':
      return {
        ...base,
        category: 'penalty',
        title: 'Straff indraget',
        detail: `"${name}" drogs in från ${target} efter en streak-korrigering.`,
        changes: [],
      };
    case 'penalty_assigned':
      return {
        ...base,
        category: 'penalty',
        title: 'Straff tilldelat',
        detail: `${resolveName(
          typeof data.from_user_id === 'string' ? data.from_user_id : null,
        )} gav ${target} "${name}" den ${str(data.target_date)}.`,
        changes: [],
      };
    case 'penalty_assignment_cancelled':
      return {
        ...base,
        category: 'penalty',
        title: 'Straff ångrat',
        detail: `${actor} ångrade "${str(
          row.beforeData?.display_name ?? name,
        )}" mot ${target}${row.note ? `: ${row.note}` : ''}.`,
        changes: [],
      };
    default:
      if (row.entityType === 'challenge_penalty_definition') {
        return {
          ...base,
          category: 'penalty',
          title:
            row.action === 'insert'
              ? 'Straffdefinition tillagd'
              : row.action === 'delete'
                ? 'Straffdefinition borttagen'
                : 'Straffdefinition ändrad',
          detail: `${actor} ${
            row.action === 'insert' ? 'lade till' : 'ändrade'
          } "${name}".`,
          changes: diff(row.beforeData, row.afterData, [
            { key: 'unlock_streak', label: 'Låses upp vid' },
            { key: 'value', label: 'Värde' },
            {
              key: 'active',
              label: 'Aktiv',
              fmt: (v) => (v ? 'ja' : 'nej'),
            },
          ]),
        };
      }
      return {
        ...base,
        category: 'other',
        title: `${row.entityType} · ${row.action}`,
        detail: row.note ?? `${actor} utförde en ändring.`,
        changes: [],
      };
  }
}
