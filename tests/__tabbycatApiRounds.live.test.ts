/**
 * Live parity check for B8: round results, break tabs and the participants
 * list from the Tabbycat REST API (lib/calicotab/tabbycatApiRounds) against
 * the HTML parsers they would replace, on real tournaments. Skipped by
 * default. Run with:
 *
 *   RUN_TABBYCAT_API_ROUNDS=1 npx vitest run tests/__tabbycatApiRounds.live.test.ts
 *
 * TABBYCAT_API_TOURNAMENTS overrides the list (comma-separated tournament
 * base URLs, each ending in "/"). TABBYCAT_API_REPORT=<path> writes every
 * diff as JSON. Requests are spaced 1.5 s apart per run, gentler than
 * ingest's per-host floor.
 */

import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { extractNavigation } from '@/lib/calicotab/parseNav';
import {
  parseBreakPage,
  parseParticipantsList,
  parseRoundResults,
  type BreakRow,
  type ParticipantsRow,
  type RoundDebate,
} from '@/lib/calicotab/parseTabs';
import { fetchRestFromApi } from '@/lib/calicotab/tabbycatApiRounds';
import { normalizePersonName } from '@/lib/calicotab/fingerprint';

const TOURNAMENTS = (process.env.TABBYCAT_API_TOURNAMENTS ?? 'https://wudc2024.calicotab.com/wudc/')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let requests = 0;
async function politeFetch(url: string, accept: string): Promise<Response> {
  await sleep(1_500);
  requests++;
  return fetch(url, { headers: { 'User-Agent': UA, Accept: accept } });
}

async function html(url: string): Promise<string | null> {
  const res = await politeFetch(url, 'text/html');
  return res.ok ? res.text() : null;
}

/** ingest's fetchRound: the by-debate view when it carries data, else the plain page. */
async function roundHtml(url: string): Promise<{ url: string; html: string } | null> {
  const trimmed = url.replace(/\/+$/, '') + '/';
  const byDebate = await html(`${trimmed}by-debate/`);
  if (byDebate && /window\.vueData|tablesData/.test(byDebate)) return { url: `${trimmed}by-debate/`, html: byDebate };
  const plain = await html(trimmed);
  return plain ? { url: trimmed, html: plain } : null;
}

function diffRound(h: RoundDebate, a: RoundDebate): string[] {
  const out: string[] = [];
  for (const k of ['roundNumber', 'roundLabel', 'isOutround'] as const) {
    if (h[k] !== a[k]) out.push(`${k}: html=${h[k]} api=${a[k]}`);
  }
  const key = (t: RoundDebate['teamResults'][number]) => t.teamName;
  const api = new Map(a.teamResults.map((t) => [key(t), t]));
  for (const t of h.teamResults) {
    const x = api.get(key(t));
    if (!x) { out.push(`team missing from API: ${t.teamName}`); continue; }
    for (const k of ['position', 'points', 'won'] as const) {
      if (t[k] !== x[k]) out.push(`${t.teamName}.${k}: html=${t[k]} api=${x[k]}`);
    }
  }
  if (h.teamResults.length !== a.teamResults.length) out.push(`team rows: html=${h.teamResults.length} api=${a.teamResults.length}`);
  const j = (x: RoundDebate['judgeAssignments'][number]) => `${normalizePersonName(x.personName)}|${x.panelRole}`;
  const hj = new Set(h.judgeAssignments.map(j));
  const aj = new Set(a.judgeAssignments.map(j));
  for (const x of hj) if (!aj.has(x)) out.push(`judge missing from API: ${x}`);
  for (const x of aj) if (!hj.has(x)) out.push(`judge only in API: ${x}`);
  return out;
}

function diffBreak(h: BreakRow[], a: BreakRow[]): string[] {
  const out: string[] = [];
  const api = new Map(a.map((r) => [normalizePersonName(r.entityName), r]));
  for (const r of h) {
    const x = api.get(normalizePersonName(r.entityName));
    if (!x) { out.push(`break row missing from API: ${r.entityName}`); continue; }
    for (const k of ['rank', 'score', 'stage', 'entityType', 'institution'] as const) {
      if (r[k] !== x[k]) out.push(`${r.entityName}.${k}: html=${r[k]} api=${x[k]}`);
    }
  }
  if (h.length !== a.length) out.push(`break rows: html=${h.length} api=${a.length}`);
  return out;
}

function diffParticipants(h: ParticipantsRow[], a: ParticipantsRow[]): string[] {
  // A multiset on every field: names repeat ("Speaker 1" on each swing team,
  // one redaction per opted-out person), so no single field is a key.
  const key = (r: ParticipantsRow) =>
    [normalizePersonName(r.name), r.role, r.judgeTag, r.teamName, r.institution].join('|');
  const count = (rows: ParticipantsRow[]) => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + 1);
    return m;
  };
  const hc = count(h);
  const ac = count(a);
  const out: string[] = [];
  for (const [k, n] of hc) if ((ac.get(k) ?? 0) !== n) out.push(`html×${n} api×${ac.get(k) ?? 0}: ${k}`);
  for (const [k, n] of ac) if (!hc.has(k)) out.push(`html×0 api×${n}: ${k}`);
  return out;
}

describe.runIf(process.env.RUN_TABBYCAT_API_ROUNDS === '1')('tabbycat API rounds/break/participants parity', () => {
  const report: Record<string, unknown> = {};

  for (const base of TOURNAMENTS) {
    it(
      base,
      async () => {
        const start = requests;
        const landing = await html(base);
        expect(landing, 'landing page').toBeTruthy();
        const nav = extractNavigation(landing!, base);

        const apiStart = requests;
        const api = await fetchRestFromApi(base, nav, (u) => politeFetch(u, 'application/json'));
        const apiRequests = requests - apiStart;

        const diffs: Record<string, string[] | string> = {};
        let htmlRequests = 0;
        for (const u of nav.resultsRounds) {
          const before = requests;
          const page = await roundHtml(u);
          htmlRequests += requests - before;
          const got = api.rounds.get(u);
          if (!page) { diffs[u] = 'html: not fetched'; continue; }
          if (!got || got.source !== 'api') { diffs[u] = `api fell back: ${got?.source === 'html' ? got.reason : 'missing'}`; continue; }
          // Both sides get the nav label by the nav URL (see the B8 handoff
          // note on ingest's by-debate label lookup).
          const h = parseRoundResults(page.html, u, nav.resultsRoundLabels?.[u]);
          const d = diffRound(h, got.value);
          if (d.length) diffs[u] = d;
        }
        for (const u of nav.breakTabs) {
          const before = requests;
          const page = await html(u);
          htmlRequests += requests - before;
          const got = api.breaks.get(u);
          if (!page) { diffs[u] = 'html: not fetched'; continue; }
          if (!got || got.source !== 'api') { diffs[u] = `api fell back: ${got?.source === 'html' ? got.reason : 'missing'}`; continue; }
          const d = diffBreak(parseBreakPage(page, u), got.value);
          if (d.length) diffs[u] = d;
        }
        if (nav.participants) {
          const before = requests;
          const page = await html(nav.participants);
          htmlRequests += requests - before;
          const got = api.participants;
          if (!page) diffs.participants = 'html: not fetched';
          else if (!got || got.source !== 'api') diffs.participants = `api fell back: ${got?.source === 'html' ? got.reason : 'missing'}`;
          else {
            const d = diffParticipants(parseParticipantsList(page), got.value);
            if (d.length) diffs.participants = d;
          }
        }

        report[base] = {
          pages: { rounds: nav.resultsRounds.length, breaks: nav.breakTabs.length, participants: !!nav.participants },
          requests: { api: apiRequests, html: htmlRequests, landing: apiStart - start },
          diffs,
        };
        if (process.env.TABBYCAT_API_REPORT) writeFileSync(process.env.TABBYCAT_API_REPORT, JSON.stringify(report, null, 1));
        console.info(base, JSON.stringify(report[base]).slice(0, 3000));
      },
      900_000,
    );
  }
});
