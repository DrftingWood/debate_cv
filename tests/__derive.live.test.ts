/**
 * Derives, per corpus tournament, the fields ingest computes with TypeScript
 * helpers, so scripts/seed-from-corpus.mjs can write them without a second
 * copy of the rules:
 *
 *   format               lib/calicotab/format.ts        inferTournamentFormat
 *   eliminationReached   lib/calicotab/judgeStats.ts    outroundRankStrict
 *   chairedPrelims,      lib/calicotab/judgeAggregates  computeJudgeAggregates
 *   deepestChaired,
 *   deepestPaneled
 *
 * The seed is plain .mjs and cannot import TypeScript; reimplementing these
 * in JavaScript is how a seeded record drifts from what a real ingest of the
 * same tabs would store. Same pattern as __tagplaceholders.live.test.ts.
 *
 *   RUN_DERIVE=1 BUNDLE_IN=<bundle.json> DERIVED_OUT=<derived.json> \
 *   npx vitest run tests/__derive.live.test.ts
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { inferTournamentFormat } from '@/lib/calicotab/format';
import { outroundRankStrict } from '@/lib/calicotab/judgeStats';
import { computeJudgeAggregates, type JudgeRound } from '@/lib/calicotab/judgeAggregates';

type Row = Record<string, unknown> & { tournament_id: number };

function byTournament(rows: Row[] = []): Map<number, Row[]> {
  const out = new Map<number, Row[]>();
  for (const r of rows) {
    const list = out.get(r.tournament_id) ?? [];
    list.push(r);
    out.set(r.tournament_id, list);
  }
  return out;
}

const ROLE: Record<string, JudgeRound['role']> = {
  chair: 'chair',
  panel: 'panellist',
  panellist: 'panellist',
  trainee: 'trainee',
};

describe.skipIf(!process.env.RUN_DERIVE)('derive ingest-computed fields', () => {
  it('writes format, outround depth and judge aggregates per tournament', () => {
    const bundle = JSON.parse(readFileSync(process.env.BUNDLE_IN!, 'utf-8'));
    const results = byTournament(bundle.team_results);
    const rosters = byTournament(bundle.teams);
    const field = byTournament(bundle.field);
    const squads = byTournament(bundle.squads);
    const judging = byTournament(bundle.judging);
    const speakerByT = new Map<number, Row>((bundle.speaker as Row[]).map((r) => [r.tournament_id, r]));
    const partByT = new Map<number, Row>((bundle.participation as Row[]).map((r) => [r.tournament_id, r]));

    const derived: Record<string, unknown> = {};
    const tally = { formats: new Map<string, number>(), reachedOutround: 0, chairedOutround: 0 };

    for (const t of bundle.tournaments as Array<{ id: number; name: string }>) {
      const rows = results.get(t.id) ?? [];

      const format = inferTournamentFormat({
        tournamentName: t.name ?? '',
        teamRows: (rosters.get(t.id) ?? [])
          .map((r) => ({ speakers: String(r.speakers ?? '').split(' | ').filter(Boolean) }))
          .filter((r) => r.speakers.length > 0),
        speakerRows: (field.get(t.id) ?? []).map((r) => ({ teamName: (r.team_name as string) ?? null })),
        participantRows: (squads.get(t.id) ?? []).map((r) => ({
          role: 'speaker',
          teamName: (r.team_name as string) ?? null,
        })),
        registrationSpeakers: [],
        rounds: [{ teamResults: rows.map((r) => ({ position: (r.position as string) ?? null })) }],
      });

      // Deepest outround the subject's team appeared in.
      const team =
        (speakerByT.get(t.id)?.team_name as string | undefined) ??
        (partByT.get(t.id)?.team_name as string | undefined) ??
        null;
      const deepest = team
        ? rows
            .filter((r) => r.is_outround && r.team_name === team)
            .map((r) => ({ label: r.round_label as string, rank: outroundRankStrict(r.round_label as string) }))
            .filter((x): x is { label: string; rank: number } => x.rank != null)
            .sort((a, b) => b.rank - a.rank)[0]?.label ?? null
        : null;

      const agg = computeJudgeAggregates(
        (judging.get(t.id) ?? [])
          .filter((j) => ROLE[String(j.panel_role)])
          .map((j) => ({
            role: ROLE[String(j.panel_role)],
            roundNumber: j.is_outround ? null : ((j.round_number as number) ?? null),
            stage: j.is_outround ? String(j.round_label) : String(j.round_number ?? ''),
          })),
      );

      derived[t.id] = {
        format,
        eliminationReached: deepest,
        chairedPrelims: agg.chairedPrelims,
        deepestChaired: agg.deepestChaired,
        deepestPaneled: agg.deepestPaneled,
      };
      tally.formats.set(format ?? '(none)', (tally.formats.get(format ?? '(none)') ?? 0) + 1);
      if (deepest) tally.reachedOutround += 1;
      if (agg.deepestChaired) tally.chairedOutround += 1;
    }

    console.log(`[derive] formats: ${[...tally.formats].map(([f, n]) => `${n} ${f}`).join(', ')}`);
    console.log(`[derive] tournaments with an outround spoken: ${tally.reachedOutround}`);
    console.log(`[derive] tournaments with an outround chaired: ${tally.chairedOutround}`);
    writeFileSync(process.env.DERIVED_OUT!, JSON.stringify(derived, null, 1), 'utf-8');
    expect(Object.keys(derived).length).toBe(bundle.tournaments.length);
  });
});
