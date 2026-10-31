import type { AuditInputs, AuditPiece } from '@/lib/audit/checks';
import { runChecks } from '@/lib/audit/checks';
import type { CheckCode, CheckResult } from '@/lib/audit/types';

/** The parser version the fixtures were "scraped" with, and the current one. */
export const PARSER = '20261025.0';

/** An empty tournament: every list empty, every count zero. */
export function inputs(over: Partial<AuditInputs> = {}): AuditInputs {
  return {
    format: 'British Parliamentary',
    prelimRoundCount: 3,
    parserVersion: PARSER,
    teamTab: [],
    roundRows: [],
    outrounds: [],
    breakRows: [],
    speakersByTeam: {},
    redactedByTeam: {},
    speakerParticipants: 0,
    speakersWithScores: 0,
    judgeParticipants: 0,
    roundResultJudges: 0,
    judgesByRound: {},
    motionRounds: [],
    pieces: [],
    openReports: [],
    ...over,
  };
}

const BP_SIDES = ['OG', 'OO', 'CG', 'CO'];

/**
 * BP prelim rows: round i has `teams[i]` teams named T1..Tn, each scoring
 * 3/2/1/0 by seat, so T1 always takes 3 and the team tab can be derived.
 */
export function bpRows(teams: number[]): AuditInputs['roundRows'] {
  return teams.flatMap((n, i) =>
    Array.from({ length: n }, (_, t) => ({
      team: `T${t + 1}`,
      round: i + 1,
      points: 3 - (t % 4),
      wins: null,
      position: BP_SIDES[t % 4]!,
    })),
  );
}

/** A team tab whose points are exactly the sum of the rows. */
export function tabFromRows(rows: AuditInputs['roundRows']): AuditInputs['teamTab'] {
  const sums = new Map<string, { points: number; wins: number }>();
  for (const r of rows) {
    const s = sums.get(r.team) ?? { points: 0, wins: 0 };
    s.points += r.points ?? 0;
    s.wins += r.wins ?? 0;
    sums.set(r.team, s);
  }
  return [...sums].map(([team, s]) => ({ team, points: s.points, wins: s.wins }));
}

export function piece(
  kind: AuditPiece['kind'],
  key: string,
  label: string,
): AuditPiece {
  const status = 'ok';
  const path = kind === 'round' ? `results/round/${key}/` : `tab/${kind}/${key}`;
  return { kind, key, label, status, url: `https://wudc.calicotab.com/wudc/${path}` };
}

/** Outround rows for one stage: the first `won` teams won, the rest lost. */
export function stage(label: string, teams: string[], won: number): AuditInputs['outrounds'] {
  return teams.map((team, i) => ({ stage: label, team, result: i < won ? 'won' : 'lost' }));
}

export function names(prefix: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);
}

export function check(i: AuditInputs, code: CheckCode): CheckResult {
  const found = runChecks(i, PARSER).find((c) => c.code === code);
  if (!found) throw new Error(`no ${code} result`);
  return found;
}

export function keys(c: CheckResult): string[] {
  return c.pieces.map((p) => `${p.kind}:${p.key}`);
}

/** The same piece, failed or withheld. */
export function marked(p: AuditPiece, status: AuditPiece['status']): AuditPiece {
  return { ...p, status };
}
