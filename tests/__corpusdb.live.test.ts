/**
 * Corpus → CSV, for bulk loading into a local Postgres.
 *
 * Runs the repo's own parsers over the offline corpus and emits one CSV per
 * table. Loading the result into a database turns "does this parse?" into
 * questions SQL can answer across every tournament at once — duplicate
 * ranks, speakers whose scores contradict their total, break rows with no
 * matching team, category vocabulary by region, and so on.
 *
 * Not a test; it is a tool that borrows vitest for the `@/` alias and the
 * TypeScript pipeline. Reads the corpus off disk, no network.
 *
 *   RUN_CORPUS_DB=1 CORPUS_DIR=<dir> CSV_OUT=<dir> \
 *   npx vitest run tests/__corpusdb.live.test.ts
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { extractNavigation } from '@/lib/calicotab/parseNav';
import {
  parseTeamTab,
  parseSpeakerTab,
  parseBreakPage,
  parseParticipantsList,
  parseRoundResults,
} from '@/lib/calicotab/parseTabs';
import { splitStageLabel } from '@/lib/calicotab/stageLexicon';

type PageRef = { url: string; kind: string; status: number; file: string | null };
type Entry = { root: string; rootStatus: number; pages: PageRef[] };

const DIR = process.env.CORPUS_DIR ?? '';
const OUT = process.env.CSV_OUT ?? '';

/** RFC4180 cell. Postgres COPY ... FORMAT csv reads this directly. */
function cell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const row = (vals: unknown[]) => vals.map(cell).join(',');

describe.skipIf(!process.env.RUN_CORPUS_DB)('corpus → csv', () => {
  it('parses every corpus page into relational rows', () => {
    expect(DIR && OUT, 'CORPUS_DIR and CSV_OUT required').toBeTruthy();
    if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

    const entries: Entry[] = JSON.parse(readFileSync(join(DIR, 'index.json'), 'utf-8'));
    const html = (f: string) => gunzipSync(readFileSync(join(DIR, 'pages', f))).toString('utf-8');

    const tournaments: string[] = [];
    const teams: string[] = [];
    const speakers: string[] = [];
    const roundScores: string[] = [];
    const breakRows: string[] = [];
    const debates: string[] = [];
    const teamResults: string[] = [];
    const judges: string[] = [];
    const participants: string[] = [];
    const roundLabels: string[] = [];

    let tid = 0;
    let sid = 0; // surrogate key: speaker NAME is not unique within a tournament
    for (const e of entries) {
      if (e.rootStatus !== 200) continue;
      tid += 1;
      const u = new URL(e.root);
      const slug = u.pathname.split('/').filter(Boolean)[0] ?? null;
      const home = e.pages.find((p) => p.kind === 'home' && p.file);
      let name: string | null = null;
      let version: string | null = null;
      if (home) {
        const h = html(home.file!);
        name = h.match(/<title>([^<]*)<\/title>/i)?.[1]?.split('|')[0]?.trim() ?? null;
        version = h.match(/runs on Tabbycat\s*([0-9.]+[a-z-]*)/i)?.[1] ?? null;
        try {
          const nav = extractNavigation(h, e.root);
          for (const [url, label] of Object.entries(nav.resultsRoundLabels)) {
            const { category, stage } = splitStageLabel(label);
            roundLabels.push(row([tid, url, label, stage, category]));
          }
        } catch {
          /* nav failures are already covered by the property suite */
        }
      }
      tournaments.push(
        row([tid, e.root, u.host, slug, name, version, e.pages.filter((p) => p.file).length]),
      );

      for (const p of e.pages) {
        if (!p.file) continue;
        const h = html(p.file);
        try {
          if (p.kind === 'teamTab') {
            for (const r of parseTeamTab(h)) {
              teams.push(
                row([tid, r.rank, r.teamName, r.institution, r.wins, r.totalPoints, r.speakers.join(' | ')]),
              );
            }
          } else if (p.kind === 'speakerTab') {
            for (const r of parseSpeakerTab(h)) {
              sid += 1;
              speakers.push(
                row([sid, tid, r.rank, r.rankEsl, r.rankEfl, r.speakerName, r.teamName, r.institution, r.totalScore]),
              );
              for (const rs of r.roundScores) {
                roundScores.push(row([sid, tid, r.speakerName, rs.roundLabel, rs.score, rs.positionLabel]));
              }
            }
          } else if (p.kind === 'breakTab') {
            for (const r of parseBreakPage(h, p.url)) {
              breakRows.push(
                row([tid, p.url, r.rank, r.entityType, r.entityName, r.institution, r.score, r.stage ?? null]),
              );
            }
          } else if (p.kind === 'participants') {
            for (const r of parseParticipantsList(h)) {
              participants.push(row([tid, r.name, r.role, r.judgeTag, r.teamName, r.institution]));
            }
          } else if (p.kind === 'roundResults') {
            const d = parseRoundResults(h, p.url, null);
            debates.push(row([tid, p.url, d.roundLabel, d.isOutround, d.roundNumber]));
            for (const t of d.teamResults) {
              teamResults.push(row([tid, p.url, t.teamName, t.position, t.points, t.won]));
            }
            for (const j of d.judgeAssignments) {
              judges.push(row([tid, p.url, j.personName, j.panelRole]));
            }
          }
        } catch (err) {
          console.log(`[csv] parse failed ${p.kind} ${p.url}: ${String(err).slice(0, 100)}`);
        }
      }
    }

    const files: Array<[string, string[]]> = [
      ['tournaments', tournaments],
      ['teams', teams],
      ['speakers', speakers],
      ['speaker_round_scores', roundScores],
      ['break_rows', breakRows],
      ['round_debates', debates],
      ['team_results', teamResults],
      ['judge_assignments', judges],
      ['participants', participants],
      ['round_labels', roundLabels],
    ];
    for (const [nm, rows] of files) {
      writeFileSync(join(OUT, `${nm}.csv`), rows.join('\n') + (rows.length ? '\n' : ''), 'utf-8');
      console.log(`[csv] ${nm.padEnd(22)} ${rows.length}`);
    }
    expect(tournaments.length).toBeGreaterThan(100);
  }, 600_000);
});
