/**
 * Live parity check: the Tabbycat REST API mapping (lib/calicotab/tabbycatApi)
 * against the HTML parsers it would replace, on real tournaments. Skipped by
 * default. Run with:
 *
 *   RUN_TABBYCAT_API=1 npx vitest run tests/__tabbycatApi.live.test.ts
 *
 * TABBYCAT_API_TOURNAMENTS overrides the list (comma-separated tournament
 * base URLs, each ending in "/"). Ingest only switches to the API once this
 * diff is clean across a meaningful sample — that is the point of the file.
 */

import { describe, it, expect } from 'vitest';
import { parseSpeakerTab, parseTeamTab, type SpeakerTabRow, type TeamTabRow } from '@/lib/calicotab/parseTabs';
import { fetchTabsFromApi } from '@/lib/calicotab/tabbycatApi';

const TOURNAMENTS = (process.env.TABBYCAT_API_TOURNAMENTS ??
  'https://wudc2024.calicotab.com/wudc/,https://wudc2025.calicotab.com/open/')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Accept: 'text/html',
};

async function html(url: string): Promise<string> {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

// The HTML speaker tab appends a synthetic "Average" cell on some installs;
// it is derived, not a round, so it is not part of the comparison.
const realRounds = (r: SpeakerTabRow) => r.roundScores.filter((s) => s.positionLabel !== 'average');

function diffTeams(htmlRows: TeamTabRow[], apiRows: TeamTabRow[]): string[] {
  const api = new Map(apiRows.map((r) => [r.teamName, r]));
  const out: string[] = [];
  for (const h of htmlRows) {
    const a = api.get(h.teamName);
    if (!a) { out.push(`team missing from API: ${h.teamName}`); continue; }
    for (const k of ['rank', 'wins', 'totalPoints', 'firsts', 'seconds'] as const) {
      if (h[k] != null && h[k] !== a[k]) out.push(`${h.teamName}.${k}: html=${h[k]} api=${a[k]}`);
    }
  }
  if (apiRows.length !== htmlRows.length) out.push(`team count: html=${htmlRows.length} api=${apiRows.length}`);
  return out;
}

// A cell the HTML tab leaves empty but the API fills is not a disagreement:
// swing-team speakers' scores are blanked on the HTML tab and published by
// the API. Count those separately; only a cell where both have a value and
// they differ, or the HTML has one the API lacks, is a diff.
//
// Likewise a redacted row the API could not tie to one hidden speaker (two
// opted-out speakers on the same total) comes back with empty rounds by
// design; those are counted as withheld rather than as diffs.
let extraApiScores = 0;
let withheldRedacted = 0;

function diffRounds(h: SpeakerTabRow, a: SpeakerTabRow): string | null {
  const hr = realRounds(h);
  if (hr.length !== a.roundScores.length) return `columns html=${hr.map((s) => s.roundLabel)} api=${a.roundScores.map((s) => s.roundLabel)}`;
  if (a.teamName == null && a.roundScores.every((s) => s.score == null) && hr.some((s) => s.score != null)) {
    withheldRedacted++;
    return null;
  }
  const bad: string[] = [];
  hr.forEach((s, i) => {
    const as = a.roundScores[i];
    if (s.roundLabel !== as.roundLabel) bad.push(`${s.roundLabel}≠${as.roundLabel}`);
    else if (s.score == null && as.score != null) extraApiScores++;
    else if (s.score !== as.score) bad.push(`${s.roundLabel} html=${s.score} api=${as.score}`);
  });
  return bad.length ? bad.join(', ') : null;
}

function diffSpeakers(htmlRows: SpeakerTabRow[], apiRows: SpeakerTabRow[]): string[] {
  // Keyed on name + team, plus the total for redacted rows, which share
  // both a name and a null team.
  const key = (r: SpeakerTabRow) => `${r.speakerName}|${r.teamName}|${r.teamName == null ? r.totalScore : ''}`;
  const api = new Map<string, SpeakerTabRow[]>();
  for (const r of apiRows) api.set(key(r), [...(api.get(key(r)) ?? []), r]);
  const out: string[] = [];
  for (const h of htmlRows) {
    const a = api.get(key(h))?.shift();
    if (!a) { out.push(`speaker missing from API: ${key(h)}`); continue; }
    if (h.rank != null && h.rank !== a.rank) out.push(`${key(h)}.rank: html=${h.rank} api=${a.rank}`);
    if (h.totalScore != null && h.totalScore !== a.totalScore) out.push(`${key(h)}.total: html=${h.totalScore} api=${a.totalScore}`);
    const rd = diffRounds(h, a);
    if (rd) out.push(`${key(h)}.rounds: ${rd}`);
    const unresolvedRedacted = a.teamName == null && a.roundScores.every((s) => s.score == null);
    if (!unresolvedRedacted && h.categories.join() !== a.categories.join()) out.push(`${key(h)}.categories: html=${h.categories} api=${a.categories}`);
  }
  if (apiRows.length !== htmlRows.length) out.push(`speaker count: html=${htmlRows.length} api=${apiRows.length}`);
  return out;
}

describe.skipIf(!process.env.RUN_TABBYCAT_API)('Tabbycat API vs HTML tabs', () => {
  for (const base of TOURNAMENTS) {
    it(base, async () => {
      const api = await fetchTabsFromApi(base);
      // A tab released to the top N is deliberately left to HTML (see
      // tabReleaseFromPreferences), so there is nothing to diff for it.
      const limited = (o: { source: string; reason?: string }) => o.source === 'html' && /top N/.test(o.reason ?? '');
      for (const [tab, o] of [['team', api.teams], ['speaker', api.speakers]] as const) {
        if (o.source !== 'api' && !limited(o)) throw new Error(`${tab} tab not from API: ${o.reason}`);
        if (limited(o)) console.log(`${base}: ${tab} tab limited — left to HTML, not compared`);
      }
      const htmlTeams = parseTeamTab(await html(`${base}tab/team/`));
      const htmlSpeakers = parseSpeakerTab(await html(`${base}tab/speaker/`));
      extraApiScores = 0;
      withheldRedacted = 0;
      const diffs = [
        ...(api.teams.source === 'api' ? diffTeams(htmlTeams, api.teams.rows) : []),
        ...(api.speakers.source === 'api' ? diffSpeakers(htmlSpeakers, api.speakers.rows) : []),
      ];
      console.log(
        `${base}: ${htmlSpeakers.length} speakers, ${htmlTeams.length} teams, ${diffs.length} diffs, ` +
          `${extraApiScores} scores only the API has, ${withheldRedacted} redacted rows withheld`,
      );
      if (diffs.length) console.log(`${base}\n  ` + diffs.slice(0, 40).join('\n  ') + (diffs.length > 40 ? `\n  …${diffs.length - 40} more` : ''));
      expect(diffs).toEqual([]);
    }, 180_000);
  }
});
