import type { ChallengeConfig } from '@/domain/challenge';
import type { ChallengeResultRow } from './challenge-results-api';

const HEADERS = [
  'deltagare',
  'period_start',
  'period_slut',
  'medlemskap_aktivt',
  'berakningsbara_dagar',
  'genomforda_dagar',
  'missade_dagar',
  'kvar_idag',
  'kommande_dagar',
  'genomforande_procent',
  'nuvarande_streak',
  'langsta_streak',
  'giltiga_traningsminuter',
  'skuld_sek',
  'straff_intjanade',
  'straff_utdelade',
  'straff_mottagna',
] as const;

function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * A CSV export of `challenge_results`, built purely from authoritative state.
 * No proof URLs, storage paths or tokens — only the fields below.
 */
export function buildChallengeResultsCsv(
  challenge: Pick<ChallengeConfig, 'name'>,
  rows: readonly ChallengeResultRow[],
  nameOf: (userId: string) => string,
): string {
  const lines = [
    `# ${challenge.name}`,
    HEADERS.join(';'),
    ...rows
      .slice()
      .sort((a, b) => b.completionRate - a.completionRate)
      .map((r) =>
        [
          nameOf(r.userId),
          r.participationStartDate,
          r.participationEndDate ?? '',
          r.membershipActive ? 'ja' : 'nej',
          r.eligibleDays,
          r.completedDays,
          r.missedDays,
          r.pendingDays,
          r.futureDays,
          Math.round(r.completionRate * 100),
          r.currentStreak,
          r.longestStreak,
          r.totalValidMinutes,
          r.liabilitySek,
          r.penaltiesEarned,
          r.penaltiesAssigned,
          r.penaltiesReceived,
        ]
          .map(csvCell)
          .join(';'),
      ),
  ];
  return lines.join('\n');
}

export function downloadCsv(filename: string, content: string): void {
  const blob = new Blob(['﻿' + content], {
    type: 'text/csv;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
