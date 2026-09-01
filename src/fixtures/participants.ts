import type { MembershipConfig } from '@/domain/membership';
import type { Role } from '@/features/profile/profile-api';

export interface ParticipantFixture {
  userId: string;
  displayName: string;
  role: Role;
  /** Admin flag for `profiles.active`. */
  profileActive: boolean;
  membership: MembershipConfig;
  /** 0–1 "discipline" — drives the seeded completion pattern. Dev only. */
  discipline: number;
}

/** The signed-in participant in the fixture world. */
export const SELF_USER_ID = 'u-johan';

/**
 * ~21 participants with realistic Swedish names and membership variation:
 * one late joiner (Erik), one early leaver (Lisa), one paused membership
 * (David). Everything else is a full-period membership.
 */
export const participantFixtures: ParticipantFixture[] = [
  mk('u-anna', 'Anna Lindqvist', 0.97, {}),
  mk('u-johan', 'Johan Berg', 0.88, {}, { role: 'admin' }),
  mk('u-sara', 'Sara Wallin', 0.9, {}),
  mk('u-erik', 'Erik Sundström', 0.82, {
    participationStartDate: '2026-08-20',
  }),
  mk('u-lisa', 'Lisa Hedlund', 0.86, {
    participationEndDate: '2026-10-15',
  }),
  mk('u-martin', 'Martin Ek', 0.71, {}),
  mk('u-olof', 'Olof Nyström', 0.87, {}),
  mk('u-karin', 'Karin Holm', 0.83, {}),
  mk('u-petra', 'Petra Sjöberg', 0.92, {}),
  mk('u-anders', 'Anders Falk', 0.64, {}),
  mk('u-emma', 'Emma Björk', 0.89, {}),
  mk('u-nils', 'Nils Åkesson', 0.76, {}),
  mk('u-hanna', 'Hanna Lund', 0.93, {}),
  mk('u-fredrik', 'Fredrik Dahl', 0.58, {}),
  mk('u-maja', 'Maja Ström', 0.85, {}),
  mk('u-gustav', 'Gustav Norén', 0.8, {}),
  mk('u-elin', 'Elin Sandberg', 0.9, {}),
  mk('u-oskar', 'Oskar Blom', 0.73, {}),
  mk('u-klara', 'Klara Vikström', 0.88, {}),
  mk(
    'u-david',
    'David Hagström',
    0.7,
    {},
    { profileActive: true, membershipActive: false },
  ),
  mk('u-sofia', 'Sofia Ohlsson', 0.83, {}),
];

function mk(
  userId: string,
  displayName: string,
  discipline: number,
  window: Partial<
    Pick<MembershipConfig, 'participationStartDate' | 'participationEndDate'>
  >,
  opts: {
    role?: Role;
    profileActive?: boolean;
    membershipActive?: boolean;
  } = {},
): ParticipantFixture {
  return {
    userId,
    displayName,
    role: opts.role ?? 'participant',
    profileActive: opts.profileActive ?? true,
    discipline,
    membership: {
      userId,
      participationStartDate: window.participationStartDate ?? '2026-08-01',
      participationEndDate: window.participationEndDate ?? null,
      active: opts.membershipActive ?? true,
    },
  };
}
