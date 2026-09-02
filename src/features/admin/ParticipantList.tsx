import { useState } from 'react';
import type { ChallengeConfig } from '@/domain/challenge';
import { formatDayMonth } from '@/domain/format';
import type { RosterMember } from '@/features/challenge/roster-api';
import { membershipDisplayState } from './membershipState';
import type { AccountStatus } from './participants-api';
import { EditMembershipSheet } from './EditMembershipSheet';
import styles from './ParticipantList.module.css';

interface Props {
  challenge: ChallengeConfig;
  today: string;
  participants: RosterMember[];
  accountStatuses?: Record<string, AccountStatus> | undefined;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

function windowText(start: string, end: string | null): string {
  return end === null
    ? `Från ${formatDayMonth(start)}`
    : `${formatDayMonth(start)} – ${formatDayMonth(end)}`;
}

const ACCOUNT_LABEL: Record<AccountStatus['state'], string> = {
  invited: 'Inbjuden – ej aktiverad',
  active: 'Konto aktivt',
  unknown: 'Kontostatus okänd',
};

export function ParticipantList({
  challenge,
  today,
  participants,
  accountStatuses,
}: Props) {
  const [editing, setEditing] = useState<RosterMember | null>(null);

  return (
    <>
      <ul className={styles.list}>
        {participants.map((p) => {
          const membership = membershipDisplayState(
            challenge,
            {
              userId: p.userId,
              participationStartDate: p.participationStartDate,
              participationEndDate: p.participationEndDate,
              active: p.membershipActive,
            },
            today,
          );
          const account = accountStatuses?.[p.userId];

          return (
            <li key={p.membershipId} className={styles.item}>
              <span className={styles.avatar} aria-hidden="true">
                {initials(p.displayName)}
              </span>
              <div className={styles.body}>
                <div className={styles.nameRow}>
                  <span className={styles.name}>{p.displayName}</span>
                  {p.role === 'admin' && (
                    <span className={styles.roleBadge}>Admin</span>
                  )}
                </div>
                <span className={styles.window}>
                  {windowText(p.participationStartDate, p.participationEndDate)}
                </span>
                {account && (
                  <span className={styles.account}>
                    {ACCOUNT_LABEL[account.state]}
                  </span>
                )}
                {!p.profileActive && (
                  <span className={styles.account}>Profil inaktiverad</span>
                )}
              </div>
              <div className={styles.right}>
                <span
                  className={`${styles.stateBadge} ${styles[membership.state]}`}
                >
                  {membership.label}
                </span>
                <button
                  type="button"
                  className={styles.editBtn}
                  onClick={() => setEditing(p)}
                >
                  Ändra
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {editing && (
        <EditMembershipSheet
          open
          onClose={() => setEditing(null)}
          challenge={challenge}
          today={today}
          member={editing}
        />
      )}
    </>
  );
}
