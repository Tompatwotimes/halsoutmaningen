import { describe, expect, it } from 'vitest';
import { describeAuditEvent, type AuditRow } from './audit-humanize';

const NAMES: Record<string, string> = {
  admin: 'Admin',
  anna: 'Anna',
  erik: 'Erik',
};
const resolve = (id: string | null | undefined) =>
  id ? (NAMES[id] ?? 'Okänd') : '—';

function row(over: Partial<AuditRow>): AuditRow {
  return {
    id: 'a1',
    actorUserId: 'admin',
    challengeId: 'c1',
    targetUserId: null,
    entityType: 'challenge',
    entityId: 'c1',
    action: 'update',
    beforeData: null,
    afterData: null,
    note: null,
    createdAt: '2026-09-01T10:00:00Z',
    ...over,
  };
}

describe('describeAuditEvent', () => {
  it('humanises a rule change with a before/after diff', () => {
    const d = describeAuditEvent(
      row({
        action: 'challenge_rules_changed',
        beforeData: { required_minutes: 30, name: 'X' },
        afterData: { required_minutes: 45, name: 'X' },
      }),
      resolve,
    );
    expect(d.title).toBe('Regler ändrade');
    expect(d.changes).toEqual([
      { label: 'Krav (minuter)', before: '30 min', after: '45 min' },
    ]);
  });

  it('humanises a penalty assignment naming sender, target and date', () => {
    const d = describeAuditEvent(
      row({
        action: 'penalty_assigned',
        entityType: 'penalty_assignment',
        targetUserId: 'anna',
        afterData: {
          from_user_id: 'erik',
          to_user_id: 'anna',
          target_date: '2026-09-05',
          display_name: '60-minutaren',
        },
      }),
      resolve,
    );
    expect(d.title).toBe('Straff tilldelat');
    expect(d.detail).toContain('Erik');
    expect(d.detail).toContain('Anna');
    expect(d.detail).toContain('60-minutaren');
    expect(d.detail).toContain('2026-09-05');
  });

  it('marks an automatic correction as "Automatiskt"', () => {
    const d = describeAuditEvent(
      row({
        action: 'penalty_assignment_cancelled',
        entityType: 'penalty_assignment',
        actorUserId: null,
        targetUserId: 'anna',
        beforeData: { display_name: '45-minutaren' },
        afterData: { auto: true },
        note: 'Automatiskt: streaken korrigerades bort',
      }),
      resolve,
    );
    expect(d.actor).toBe('Automatiskt');
    expect(d.title).toBe('Straff ångrat');
  });

  it('humanises an invalidation with its reason', () => {
    const d = describeAuditEvent(
      row({
        action: 'invalidate',
        entityType: 'training_entry',
        targetUserId: 'anna',
        note: 'otillräckligt bildbevis',
      }),
      resolve,
    );
    expect(d.title).toBe('Pass ogiltigförklarat');
    expect(d.detail).toContain('Anna');
    expect(d.detail).toContain('otillräckligt bildbevis');
    expect(d.category).toBe('training');
  });

  it('humanises a start-date correction with the old/new dates and reason', () => {
    const d = describeAuditEvent(
      row({
        action: 'challenge_start_date_corrected',
        beforeData: { start_date: '2026-08-01' },
        afterData: { start_date: '2026-09-01' },
        note: 'felaktigt startdatum vid aktivering',
      }),
      resolve,
    );
    expect(d.title).toBe('Startdatum rättat');
    expect(d.detail).toContain('2026-08-01');
    expect(d.detail).toContain('2026-09-01');
    expect(d.detail).toContain('felaktigt startdatum vid aktivering');
    expect(d.changes).toEqual([
      { label: 'Startdatum', before: '2026-08-01', after: '2026-09-01' },
    ]);
    expect(d.category).toBe('challenge');
  });

  it('falls back gracefully for an unknown action', () => {
    const d = describeAuditEvent(
      row({ entityType: 'training_proof', action: 'delete' }),
      resolve,
    );
    expect(d.category).toBe('other');
    expect(d.title).toContain('training_proof');
  });
});
