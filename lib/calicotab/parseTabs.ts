import * as cheerio from 'cheerio';
import { parseJsValue } from './parseJsValue';
import { extractFromCheerio } from './cheerioToVue';

// ── Vue.js data types ────────────────────────────────────────────────────────
// Tabbycat renders all tab/results/break pages via a Vue component that reads
// `window.vueData.tablesData` from the page's inline script. The server-rendered
// HTML has no <table> elements — cheerio finds nothing. We extract the JSON
// directly, with the cheerio path as a fallback for older deployments.

export type VueHead = { key?: string; title?: string; tooltip?: string };
export type VueCell = {
  text?: string;
  sort?: number | string;
  class?: string;
  tooltip?: string;
  link?: string;
  popover?: unknown;
  // Populated only by the cheerio→VueTable adapter (lib/calicotab/cheerioToVue.ts).
  // Native Vue payloads from Tabbycat leave this undefined — they embed HTML
  // inside `text` instead, which is why parseNav's HTML-aware consumers read
  // `cell.html ?? cell.text` to converge both sources.
  html?: string;
};
export type VueTable = { title?: string; subtitle?: string; head: VueHead[]; data: VueCell[][] };

/**
 * Parse an extracted object/array slice — try strict JSON first (fast path),
 * then fall back to acorn-based AST materialization for the JS object literal
 * syntax (unquoted keys, occasional `undefined`/`Infinity` values) that
 * Tabbycat embeds in its window.vueData payload. See parseJsValue.ts for
 * the safe AST walker that replaces the previous `new Function` eval.
 */
function parseSlice(slice: string): VueTable[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(slice);
  } catch {
    // Tabbycat uses a JS object literal (unquoted keys, possible `undefined`/
    // `Infinity` values) — fall back to acorn-based AST materialization.
    // parseJsValue parses-without-executing and rejects anything beyond
    // pure literal shapes; see lib/calicotab/parseJsValue.ts.
    try {
      parsed = parseJsValue(slice);
    } catch (e) {
      console.warn('[parseTabs] parseJsValue failed:', String(e).slice(0, 120));
      return null;
    }
  }
  if (Array.isArray(parsed)) return parsed as VueTable[];
  if (parsed && typeof parsed === 'object' && 'tablesData' in parsed) {
    const td = (parsed as Record<string, unknown>).tablesData;
    if (Array.isArray(td)) return td as VueTable[];
  }
  return null;
}

/**
 * Find the position immediately after the first balanced `{...}` or `[...]`
 * region in `text`, treating double-quoted strings as opaque (so braces
 * inside string literals don't affect the depth count) and respecting
 * backslash escapes inside strings.
 *
 * Operates from index 0. Returns -1 when no balanced region is found
 * (input exhausted before depth returned to zero, or no opening brace
 * ever encountered).
 *
 * Used by extractJsonAt, extractTablesDataDirectly, and diagnoseVueData
 * to locate where an embedded JS object/array literal ends. NOTE: handles
 * only double-quoted strings — single-quoted string contents containing
 * unmatched braces would still trip the depth count, but the downstream
 * parseJsValue's trailing-content guard converts that failure mode into
 * "returns null" rather than "silently wrong output."
 */
function findBalancedJsRegion(text: string): number {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (escaped) { escaped = false; continue; }
    if (ch === '\\' && inString) { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }

  return -1;
}

/**
 * Walk `html` looking for `marker` and extract the JS value assigned to it.
 * The brace counter correctly locates the value boundary; parseSlice() then
 * handles both strict JSON and JS object literal syntax.
 */
function extractJsonAt(html: string, marker: string): VueTable[] | null {
  const idx = html.indexOf(marker);
  if (idx < 0) return null;

  const rest = html.slice(idx + marker.length);
  const endIdx = findBalancedJsRegion(rest);
  if (endIdx < 0) return null;
  return parseSlice(rest.slice(0, endIdx));
}

/**
 * Fallback extractor: find `"tablesData":` in the HTML and extract just the
 * JSON array, bypassing any non-strict-JSON values in the outer window.vueData
 * object (e.g. JS-only `undefined`/`Infinity` in sort fields, or large popover
 * HTML that contains characters that trip JSON.parse on the full object).
 */
function extractTablesDataDirectly(html: string): VueTable[] | null {
  const m = /"tablesData"\s*:\s*\[/.exec(html);
  if (!m) return null;
  const arrayStart = html.indexOf('[', m.index);
  if (arrayStart < 0) return null;

  const rest = html.slice(arrayStart);
  const endIdx = findBalancedJsRegion(rest);
  if (endIdx < 0) return null;
  return parseSlice(rest.slice(0, endIdx));
}

export function extractVueData(html: string): VueTable[] | null {
  return (
    extractJsonAt(html, 'window.vueData = ') ??
    extractJsonAt(html, 'window.tablesData = ') ??
    extractJsonAt(html, 'var tablesData = ') ??
    extractJsonAt(html, 'const tablesData = ') ??
    extractTablesDataDirectly(html)
  );
}

/**
 * Returns a human-readable string explaining why a parser returned 0 rows.
 * Called from ingest.ts after a 0-row result to populate fetchWarnings so
 * the user sees exactly which column keys were present vs expected.
 */
export function diagnoseVueData(html: string, colNeedles: string[]): string {
  const tables = extractVueData(html);
  if (!tables) {
    const markerIdx = html.indexOf('window.vueData = ');
    const hasMarker = markerIdx >= 0;

    let parseError = '';
    if (hasMarker) {
      const rest = html.slice(markerIdx + 'window.vueData = '.length);
      const endIdx = findBalancedJsRegion(rest);
      if (endIdx >= 0) {
        try { JSON.parse(rest.slice(0, endIdx)); } catch (e) {
          const preview = rest.slice(0, endIdx).replace(/\s+/g, ' ').slice(0, 80);
          parseError = ` parseErr=${String(e).slice(0, 80)} near: ${preview}`;
        }
      } else {
        parseError = ' braceCounter: endIdx not found (unbalanced JSON)';
      }
    }

    const scriptSnippets: string[] = [];
    const scriptRe = /<script[^>]*>([\s\S]*?)<\/script>/gi;
    let sm: RegExpExecArray | null;
    while ((sm = scriptRe.exec(html)) !== null) {
      const body = (sm[1] ?? '').trim();
      if (body.length < 10) continue;
      scriptSnippets.push(body.replace(/\s+/g, ' ').slice(0, 120));
      if (scriptSnippets.length >= 4) break;
    }
    const hasTablesData = html.includes('tablesData');
    const hasTables = html.includes('<table');
    const scripts = scriptSnippets.length
      ? `\nscripts: ${scriptSnippets.map((s, i) => `[${i}]${s}`).join(' | ')}`
      : '\nscripts: none';
    return (
      `vueData: window.vueData not found (${html.length}b) ` +
      `marker:${hasMarker ? 'YES' : 'NO'} tablesData:${hasTablesData ? 'YES' : 'NO'} html-table:${hasTables ? 'YES' : 'NO'}` +
      parseError + scripts
    );
  }
  if (tables.length === 0) return 'vueData: tablesData is an empty array';
  const t = tables[0]!;
  const heads = (t.head ?? []).map((h) => h.key ?? h.title ?? '?');
  const rowCount = t.data?.length ?? 0;
  const unmatched = colNeedles.filter(
    (n) => !heads.some((h) => h.toLowerCase().includes(n)),
  );
  if (rowCount === 0) {
    return `vueData: columns=[${heads.join(',')}] but data[] is empty`;
  }
  if (unmatched.length > 0) {
    return `vueData: columns=[${heads.join(',')}] rows=${rowCount} — no match for [${unmatched.join(',')}]`;
  }
  return `vueData: columns=[${heads.join(',')}] rows=${rowCount} — columns matched but returned 0 rows`;
}

function cellText(cell: VueCell | undefined): string {
  return String(cell?.text ?? '').replace(/\s+/g, ' ').trim();
}

/** Find column index by matching key or title against any of the given needles. */
function vueCol(heads: VueHead[], ...needles: string[]): number {
  return heads.findIndex((h) => {
    const k = (h.key ?? '').toLowerCase();
    const t = (h.title ?? '').toLowerCase();
    return needles.some((n) => k.includes(n) || t.includes(n));
  });
}

/** Find column index but exclude certain indices (e.g. ESL/EFL rank cols). */
function vueColExcluding(heads: VueHead[], exclude: Set<number>, ...needles: string[]): number {
  return heads.findIndex((h, i) => {
    if (exclude.has(i)) return false;
    const k = (h.key ?? '').toLowerCase();
    const t = (h.title ?? '').toLowerCase();
    return needles.some((n) => k.includes(n) || t.includes(n));
  });
}

function isAverageHeader(s: string): boolean {
  return /\b(avg|average|mean)\b/i.test(s);
}

/**
 * Decide whether a speaker-tab column header names a per-round/per-speech
 * score column. Looks beyond the canonical "R1/Round 1/Final/Quarter…" labels
 * for the cases we've seen on real AP tournaments where the score columns are
 * just bare digits (1/2/3/…) or "Speech N" / "Debate N" / "Match N".
 *
 * The downstream writer extracts `roundNumber` from the first digit in the
 * label, so any header carrying a number is enough — that's what the
 * isolated-digit and word-N alternates capture. AP tabs that lose per-round
 * data on `/cv` do so because their column heads lacked the literal "R" or
 * "Round" prefix this regex previously demanded.
 */
function isRoundColumnHeader(label: string, key: string): boolean {
  const labelTrimmed = label.trim();
  if (/\b(r(ound)?\s*\d+|final|semi|quarter|octo|grand)\b/i.test(labelTrimmed)) return true;
  if (/^r\d+$/i.test(key)) return true;
  if (/^\d+$/.test(labelTrimmed)) return true;
  if (/\b(speech|debate|match)\s*\d+/i.test(labelTrimmed)) return true;
  return false;
}

// ── Cheerio helpers (fallback for server-rendered Tabbycat) ──────────────────

function cleanText(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function classifyParticipantRole(roleText: string): { role: ParticipantsRow['role']; judgeTag: ParticipantsRow['judgeTag'] } {
  const lowered = roleText.toLowerCase();
  // Core adjudicators (Tab Director / Chief Adjudicator / Deputy CA / Adj
  // Core) shape the tournament — different category from regular judges.
  // Detect first because the labels often co-occur with "adjudicator"
  // (e.g., "Chief Adjudicator", "Deputy Chief Adjudicator") and would
  // otherwise fall through to 'normal'. Match `\bca\b` / `\bdca\b` as
  // standalone words so a name like "Cameron" doesn't false-positive.
  const isAdjCore =
    /\b(?:chief|deputy)\s+(?:chief\s+)?adjudicator\b/.test(lowered) ||
    /\b(?:adj[\s-]?core|core\s+adjudicator|tab[\s-]?director)\b/.test(lowered) ||
    /\bd?ca\b/.test(lowered);
  if (isAdjCore) {
    return { role: 'adjudicator', judgeTag: 'core' };
  }
  if (/adjud|judge/.test(lowered)) {
    return {
      role: 'adjudicator',
      judgeTag: /subsid/i.test(lowered)
        ? 'subsidized'
        : /invited|independent/i.test(lowered)
          ? 'invited'
          : 'normal',
    };
  }
  if (/speak|debat/.test(lowered)) return { role: 'speaker', judgeTag: null };
  return { role: 'other', judgeTag: null };
}

function parseNumber(s: string | undefined | null): number | null {
  if (s == null) return null;
  const t = s.replace(/[, ]+/g, '').trim();
  if (!t || !/^-?\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

// ── Public types ─────────────────────────────────────────────────────────────

export type TeamTabRow = {
  rank: number | null;
  teamName: string;
  institution: string | null;
  speakers: string[];
  wins: number | null;
  totalPoints: number | null;
};

export type SpeakerTabRow = {
  rank: number | null;
  rankEsl: number | null;
  rankEfl: number | null;
  speakerName: string;
  teamName: string | null;
  institution: string | null;
  totalScore: number | null;
  roundScores: Array<{ roundLabel: string; score: number | null; positionLabel: string | null }>;
};

export type RoundDebate = {
  roundLabel: string | null;
  isOutround: boolean;
  roundNumber: number | null;
  teamResults: Array<{ teamName: string; position: string | null; points: number | null; won: boolean | null }>;
  judgeAssignments: Array<{ personName: string; panelRole: 'chair' | 'panel' | null }>;
};

export type BreakRow = {
  rank: number | null;
  entityType: 'team' | 'adjudicator';
  entityName: string;
  institution: string | null;
  score: number | null;
  stage?: string | null;
};

export type ParticipantsRow = {
  name: string;
  role: 'speaker' | 'adjudicator' | 'other';
  /**
   * Sub-category for adjudicator participants:
   *   - 'core'       — Tab Director, Chief Adjudicator (CA), Deputy CA (DCA),
   *                    or anyone explicitly listed as "adj core". A different
   *                    category from regular judges and worth surfacing as a
   *                    distinct CV credential — they shape the tournament
   *                    rather than just judge it.
   *   - 'invited'    — independent / invited adjudicator (no team affiliation).
   *   - 'subsidized' — subsidised by the tournament (typically rookie / outreach
   *                    invitations).
   *   - 'normal'     — institutional adjudicator (the default catch-all).
   *   - null         — non-adjudicator (speaker / other) participant.
   */
  judgeTag: 'core' | 'normal' | 'invited' | 'subsidized' | null;
  teamName: string | null;
  institution: string | null;
};

// ── parseTeamTab ─────────────────────────────────────────────────────────────

function teamTabFromVue(tables: VueTable[]): TeamTabRow[] | null {
  const table = tables[0];
  if (!table?.head?.length || !table?.data?.length) return null;
  const heads = table.head;

  const teamCol = vueCol(heads, 'team');
  if (teamCol < 0) return null;

  const rankCol = vueCol(heads, 'rk', 'rank', '#');
  const instCol = vueCol(heads, 'inst', 'school', 'uni');
  const winsCol = vueCol(heads, 'win');
  // Prefer explicit "pts"/"points"/"total" col; fall back to speaker score
  let ptsCol = vueCol(heads, 'pts', 'point', 'total');
  if (ptsCol < 0) ptsCol = vueCol(heads, 'spk', 'speak', 'score');

  const rows: TeamTabRow[] = [];
  for (const row of table.data) {
    const teamName = cellText(row[teamCol]);
    if (!teamName) continue;
    rows.push({
      rank: rankCol >= 0 ? parseNumber(cellText(row[rankCol])) : null,
      teamName,
      institution: instCol >= 0 ? cellText(row[instCol]) || null : null,
      speakers: [],
      wins: winsCol >= 0 ? parseNumber(cellText(row[winsCol])) : null,
      totalPoints: ptsCol >= 0 ? parseNumber(cellText(row[ptsCol])) : null,
    });
  }
  return rows.length > 0 ? rows : null;
}

export function parseTeamTab(html: string): TeamTabRow[] {
  const vue = extractVueData(html);
  if (vue) {
    const rows = teamTabFromVue(vue);
    if (rows) return rows;
  }
  const cheerioTables = extractFromCheerio(html);
  if (cheerioTables.length === 0) return [];
  return teamTabFromVue(cheerioTables) ?? [];
}

// ── parseSpeakerTab ──────────────────────────────────────────────────────────

function speakerTabFromVue(tables: VueTable[]): SpeakerTabRow[] | null {
  const table = tables[0];
  if (!table?.head?.length || !table?.data?.length) return null;
  const heads = table.head;

  const nameCol = vueCol(heads, 'name', 'speaker');
  if (nameCol < 0) return null;

  const rankEslCol = heads.findIndex((h) => {
    const k = (h.key ?? '').toLowerCase();
    const t = (h.title ?? '').toLowerCase();
    return (k.includes('esl') || t.includes('esl'));
  });
  const rankEflCol = heads.findIndex((h) => {
    const k = (h.key ?? '').toLowerCase();
    const t = (h.title ?? '').toLowerCase();
    return (k.includes('efl') || t.includes('efl'));
  });
  const exclude = new Set([rankEslCol, rankEflCol].filter((i) => i >= 0));
  const rankCol = vueColExcluding(heads, exclude, 'rk', 'rank', '#');

  const avgCol = heads.findIndex((h) => isAverageHeader(`${h.key ?? ''} ${h.title ?? ''}`));
  const teamCol = vueCol(heads, 'team');
  const instCol = vueCol(heads, 'inst', 'school');
  const totalCol = vueColExcluding(
    heads,
    new Set([avgCol].filter((i) => i >= 0)),
    // Common header tokens for the cumulative-score column. The previous
    // set ('total', 'spk', 'score') missed AP installs labelling it
    // 'pts', 'sum', or just 'speaks' — both NLSD 2025 and SRDF 2024
    // (the user's reported "rank shows but avg doesn't" pair) fell
    // through to totalCol = -1 and the fallback in buildCvData had no
    // total to divide.
    'total',
    'spk',
    'score',
    'pts',
    'point',
    'sum',
    'speaks',
  );

  const nonRound = new Set(
    [rankCol, rankEslCol, rankEflCol, nameCol, teamCol, instCol, totalCol, avgCol].filter((i) => i >= 0),
  );
  const roundCols: Array<{ idx: number; label: string }> = [];
  heads.forEach((h, i) => {
    if (nonRound.has(i)) return;
    const k = h.key ?? '';
    const t = h.title ?? '';
    const label = t || k;
    if (isRoundColumnHeader(label, k)) {
      roundCols.push({ idx: i, label });
    }
  });

  const rows: SpeakerTabRow[] = [];
  // Tabbycat's /tab/speaker page renders rows already sorted by total score
  // descending, so we use 1-based row position as a fallback open rank when
  // no rank column was identified in the header (some installs use
  // non-standard headers like "Pos"/"Position" that the rank-column
  // matchers miss). Better an approximate rank than blank — ties get
  // sequential numbers, which is the same approximation Tabbycat itself
  // applies on the public tab.
  let rowIdx = 0;
  for (const row of table.data) {
    const speakerName = cellText(row[nameCol]);
    if (!speakerName) continue;
    const roundScores: SpeakerTabRow['roundScores'] = roundCols.map(({ idx, label }) => ({
      roundLabel: label,
      score: parseNumber(cellText(row[idx])),
      positionLabel: null,
    }));
    const avgScore = avgCol >= 0 ? parseNumber(cellText(row[avgCol])) : null;
    if (roundScores.length === 0 && avgScore != null) {
      roundScores.push({ roundLabel: 'Average', score: avgScore, positionLabel: 'average' });
    }
    rowIdx += 1;
    // Row-position fallback only fires when NO rank columns of any kind are
    // present — when ESL or EFL is set, the tab may be sorted by that
    // category rather than by total score, so guessing an open rank from
    // row position would produce wrong numbers.
    const noRankColumnsAtAll = rankCol < 0 && rankEslCol < 0 && rankEflCol < 0;
    const rank =
      rankCol >= 0
        ? parseNumber(cellText(row[rankCol]))
        : noRankColumnsAtAll
          ? rowIdx
          : null;
    rows.push({
      rank,
      rankEsl: rankEslCol >= 0 ? parseNumber(cellText(row[rankEslCol])) : null,
      rankEfl: rankEflCol >= 0 ? parseNumber(cellText(row[rankEflCol])) : null,
      speakerName,
      teamName: teamCol >= 0 ? cellText(row[teamCol]) || null : null,
      institution: instCol >= 0 ? cellText(row[instCol]) || null : null,
      totalScore: totalCol >= 0 ? parseNumber(cellText(row[totalCol])) : null,
      roundScores,
    });
  }
  return rows.length > 0 ? rows : null;
}

export function parseSpeakerTab(html: string): SpeakerTabRow[] {
  const vue = extractVueData(html);
  if (vue) {
    const rows = speakerTabFromVue(vue);
    if (rows) return rows;
  }
  const cheerioTables = extractFromCheerio(html);
  if (cheerioTables.length === 0) return [];
  return speakerTabFromVue(cheerioTables) ?? [];
}

// ── parseRoundResults ────────────────────────────────────────────────────────

function roundResultsFromVue(
  tables: VueTable[],
  roundNumber: number | null,
  roundLabel: string | null,
  isOutround: boolean,
): RoundDebate | null {
  const table = tables[0];
  if (!table?.head?.length || !table?.data?.length) return null;
  const heads = table.head;

  const teamCol = vueCol(heads, 'team');
  // BP-layout fallback: many Tabbycat round-result tables expose one row per
  // debate with four team columns (OG/OO/CG/CO) instead of a canonical "team"
  // column. We still want those teams in teamResults so ingest doesn't report
  // "no match for [team]" for perfectly valid BP tables.
  const bpPosCols: Array<{ idx: number; pos: string }> = [];
  const posNeedles: Array<{ needle: string; pos: string }> = [
    { needle: 'og', pos: 'OG' },
    { needle: 'oo', pos: 'OO' },
    { needle: 'cg', pos: 'CG' },
    { needle: 'co', pos: 'CO' },
  ];
  for (const { needle, pos } of posNeedles) {
    const idx = vueCol(heads, needle);
    if (idx >= 0) bpPosCols.push({ idx, pos });
  }
  if (teamCol < 0 && bpPosCols.length === 0) return null;

  const winCol = vueCol(heads, 'win', 'result');
  const posCol = vueCol(heads, 'position', 'side', 'pos');
  const ptsCol = vueCol(heads, 'point', 'score', 'pts');

  // Adjudicator extraction — historically hardcoded `judgeAssignments: []`,
  // which silently dropped every judge for modern Tabbycat instances that
  // serve round results via the Vue data island. Mirror the cheerio
  // fallback's logic (see parseRoundResults' fallback path below) so the
  // round-results-derived JudgeAssignment writer (recordJudgeRoundsFromRoundResults
  // in lib/calicotab/ingest.ts) actually has data to walk on completed
  // tournaments where the private-URL Debates card is empty.
  const adjCol = vueCol(heads, 'adjud', 'judge');
  const roleCol = vueColExcluding(heads, new Set([teamCol]), 'chair', 'panel', 'role');

  const teamResults: RoundDebate['teamResults'] = [];
  const judgeAssignments: RoundDebate['judgeAssignments'] = [];
  const judgeSeen = new Set<string>();
  for (const row of table.data) {
    if (teamCol >= 0) {
      const teamName = cellText(row[teamCol]);
      if (teamName) {
        const winText = winCol >= 0 ? cellText(row[winCol]).toLowerCase() : '';
        // Match explicit win text only. The previous form also accepted
        // `\b1\b` and `\btrue\b`, which fired on BP-style points columns
        // ("3"/"2"/"1"/"0" for 1st-4th place) when a header heuristic
        // misidentified them as a "result" column — flipping fourth
        // place into a "won this debate" mark and ultimately a
        // false-positive Champion. Only word-form signals count now.
        const won = winCol >= 0 ? /won|win|✓|✔/.test(winText) : null;
        teamResults.push({
          teamName,
          position: posCol >= 0 ? cellText(row[posCol]) || null : null,
          points: ptsCol >= 0 ? parseNumber(cellText(row[ptsCol])) : null,
          won,
        });
      }
    } else {
      for (const { idx, pos } of bpPosCols) {
        const teamName = cellText(row[idx]);
        if (!teamName) continue;
        teamResults.push({
          teamName,
          position: pos,
          points: null,
          won: null,
        });
      }
    }
    if (adjCol >= 0) {
      const raw = cellText(row[adjCol]);
      if (!raw) continue;
      const roleText = roleCol >= 0 ? cellText(row[roleCol]).toLowerCase() : '';
      const tokens = raw.split(/[,;\n]|\s+\/\s+/).map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
      for (const token of tokens) {
        const lower = token.toLowerCase();
        const isChair = /\bchair\b|\bchief\b|\(c\)/.test(lower) || /chair|chief/.test(roleText);
        const cleanedName = token
          .replace(/\(\s*c\s*\)$/i, '')
          .replace(/\s+\(chair\)$/i, '')
          .replace(/\s+\(chief\)$/i, '')
          .replace(/\s+/g, ' ')
          .trim();
        if (!cleanedName || cleanedName.length < 2) continue;
        const role: 'chair' | 'panel' | null = isChair ? 'chair' : roleText ? 'panel' : null;
        const key = `${cleanedName}|${role ?? ''}`;
        if (judgeSeen.has(key)) continue;
        judgeSeen.add(key);
        judgeAssignments.push({ personName: cleanedName, panelRole: role });
      }
    }
  }
  return teamResults.length > 0 || judgeAssignments.length > 0
    ? { roundNumber, roundLabel, isOutround, teamResults, judgeAssignments }
    : null;
}

export function parseRoundResults(
  html: string,
  sourceUrl: string,
  navLabel?: string | null,
): RoundDebate {
  const m = sourceUrl.match(/\/results\/round\/(\d+)/);
  const roundNumber = m ? Number(m[1]) : null;
  const roundLabelFallback = `Round ${roundNumber ?? '?'}`;
  const isOutroundFromUrl =
    /\/break\//i.test(sourceUrl) ||
    /\/elim/i.test(sourceUrl);

  // Resolution chain for the round's authoritative label:
  //   1. navLabel — link text from the landing-page nav
  //      (e.g. "Quarterfinals" for /results/round/7/). Tabbycat surfaces this
  //      itself and it cleanly maps each URL to its actual round name.
  //   2. Page heading — only when it ACTUALLY mentions a round. SIDO's
  //      results pages have a generic "SIDO 2026" heading that conveyed
  //      no per-round info; trusting it wholesale (PR #47) made every round
  //      land with stage="SIDO 2026" and classifyRoundLabel returned
  //      'unknown' for all of them.
  //   3. "Round N" numeric fallback from the URL.
  const $head = cheerio.load(html);
  const headingLabel = cleanText($head('h1, h2, h3, title').first().text());
  const headingLooksRoundRelated =
    /\bround\s+\d+\b|\bfinal|\bsemi|\bquarter|\bocto|\bgrand|\b(?:gf|sf|qf|of|dof|tof|r\d+)\b/i.test(
      headingLabel,
    );
  const trimmedNavLabel = (navLabel ?? '').trim();
  const roundLabel =
    trimmedNavLabel ||
    (headingLooksRoundRelated ? headingLabel : '') ||
    roundLabelFallback;
  const isOutround =
    isOutroundFromUrl ||
    /final|semi|quarter|octo|grand/i.test(roundLabel);

  const vue = extractVueData(html);
  if (vue) {
    const result = roundResultsFromVue(vue, roundNumber, roundLabel, isOutround);
    if (result) return result;
  }
  const cheerioTables = extractFromCheerio(html);
  if (cheerioTables.length === 0) {
    return { roundNumber, roundLabel, isOutround, teamResults: [], judgeAssignments: [] };
  }
  return roundResultsFromVue(cheerioTables, roundNumber, roundLabel, isOutround) ?? {
    roundNumber,
    roundLabel,
    isOutround,
    teamResults: [],
    judgeAssignments: [],
  };
}

// ── parseBreakPage ───────────────────────────────────────────────────────────

function breakPageFromVue(
  tables: VueTable[],
  isAdj: boolean,
  stage: string | null,
): BreakRow[] | null {
  const table = tables[0];
  if (!table?.head?.length || !table?.data?.length) return null;
  const heads = table.head;

  // Adjudicator breaks are binary in real Tabbycat data — a judge either
  // breaks (qualifies to adjudicate outrounds) or doesn't. Some installs
  // happen to render a row index in their break-tab table that looks like
  // a "rank" column to a generic header matcher, but it isn't a meaningful
  // rank. Don't extract a rank for adjudicator rows so we don't end up
  // displaying a phantom "rank:N" badge on /cv/verify.
  const rankCol = isAdj ? -1 : vueCol(heads, 'rk', 'rank', '#');
  const nameCol = vueCol(heads, 'team', 'adjudicator', 'name');
  const instCol = vueCol(heads, 'inst', 'school');
  const scoreCol = vueCol(heads, 'score', 'pts', 'point', 'total');

  const rows: BreakRow[] = [];
  for (const row of table.data) {
    const entityName = nameCol >= 0 ? cellText(row[nameCol]) : cellText(row[0]);
    if (!entityName) continue;
    rows.push({
      rank: rankCol >= 0 ? parseNumber(cellText(row[rankCol])) : null,
      entityType: isAdj ? 'adjudicator' : 'team',
      entityName,
      institution: instCol >= 0 ? cellText(row[instCol]) || null : null,
      score: scoreCol >= 0 ? parseNumber(cellText(row[scoreCol])) : null,
      stage,
    });
  }
  return rows.length > 0 ? rows : null;
}

/**
 * Normalize a Tabbycat break-tab URL fragment to the canonical break stage
 * label that downstream code (outroundStageRank, EliminationResult dedup)
 * expects:
 *   "teams/open"   → "Open"
 *   "teams/esl"    → "ESL"
 *   "teams/efl"    → "EFL"
 *   "teams/novice" → "Novice"
 *   "teams/pro-am" → "Pro-Am"
 *   "adjudicators" → "Adjudicators"
 *
 * Without this normalization, `EliminationResult.stage` ends up as raw URL
 * fragments and the downstream stage-rank classifier (which only matches
 * canonical names) silently rejects them.
 */
function normalizeBreakStage(fragment: string | null): string | null {
  if (!fragment) return null;
  if (fragment === 'adjudicators') return 'Adjudicators';
  const teamMatch = fragment.match(/^teams\/(.+)$/);
  if (!teamMatch) return fragment;
  const slug = teamMatch[1]!.toLowerCase();
  if (slug === 'open') return 'Open';
  if (slug === 'esl') return 'ESL';
  if (slug === 'efl') return 'EFL';
  // Title-case anything else: "novice" → "Novice", "pro-am" → "Pro-Am".
  return slug
    .split(/([\s-])/)
    .map((part) => (part.length > 0 && /\w/.test(part)
      ? part.charAt(0).toUpperCase() + part.slice(1)
      : part))
    .join('');
}

export function parseBreakPage(html: string, sourceUrl: string): BreakRow[] {
  const isAdj = /\/break\/adjudicators\//.test(sourceUrl);
  const stageMatch = sourceUrl.match(/\/break\/(teams\/[^/]+|adjudicators)/);
  const stage = normalizeBreakStage(stageMatch ? stageMatch[1] : null);

  const vue = extractVueData(html);
  if (vue) {
    const rows = breakPageFromVue(vue, isAdj, stage);
    if (rows) return rows;
  }
  const cheerioTables = extractFromCheerio(html);
  if (cheerioTables.length === 0) return [];
  return breakPageFromVue(cheerioTables, isAdj, stage) ?? [];
}

// ── parseParticipantsList ────────────────────────────────────────────────────

function participantsFromVue(tables: VueTable[]): ParticipantsRow[] | null {
  const rows: ParticipantsRow[] = [];
  for (const table of tables) {
    if (!table?.head?.length || !table?.data?.length) continue;
    const heads = table.head;

    const nameCol = vueCol(heads, 'name');
    if (nameCol < 0) continue;

    const teamCol = vueCol(heads, 'team');
    const instCol = vueCol(heads, 'inst', 'school');
    const roleCol = vueCol(heads, 'role');

    // Infer role from: explicit table.title (cheerio adapter hoists section
    // headings like "Adjudicators" / "Speakers" here) > role column > table
    // structure (presence of team column = speakers; rating header = adjs).
    const titleLower = (table.title ?? '').toLowerCase();
    const titleIsAdj = /^adjudicators?$/.test(titleLower);
    const titleIsSpeaker = /^speakers?$/.test(titleLower);
    const isSpeakerTable = titleIsSpeaker || (teamCol >= 0 && !titleIsAdj);
    const isAdjTable =
      titleIsAdj ||
      (!isSpeakerTable &&
        heads.some((h) => {
          const k = (h.key ?? '').toLowerCase();
          const t = (h.title ?? '').toLowerCase();
          return k.includes('rating') || t.includes('rating');
        }));
    // TODO(adj-core): promote adj-core flag to its own judgeTag once the union
    // grows a 'core' variant. Until then we collapse it into 'normal' below.
    const independentCol = vueCol(heads, 'independent');

    for (const row of table.data) {
      const name = cellText(row[nameCol]);
      if (!name) continue;
      let role: ParticipantsRow['role'] = 'other';
      let judgeTag: ParticipantsRow['judgeTag'] = null;
      if (roleCol >= 0) {
        const classified = classifyParticipantRole(cellText(row[roleCol]));
        role = classified.role;
        judgeTag = classified.judgeTag;
      } else if (isSpeakerTable) {
        role = 'speaker';
      } else if (isAdjTable) {
        role = 'adjudicator';
        // For adjudicators without an explicit role-column tag, derive the
        // judgeTag from check-icon presence on Adj Core / Independent flag
        // columns. The cheerio adapter populates VueCell.html with raw inner
        // HTML (where the feather-check svg lives); native Vue payloads put
        // the flag in `text` or `class`, so check both.
        const cellHasCheck = (idx: number): boolean => {
          if (idx < 0) return false;
          const cell = row[idx];
          if (!cell) return false;
          const html = cell.html ?? '';
          const cls = cell.class ?? '';
          return /feather-check\b/i.test(html) || /\bfeather-check\b/i.test(cls);
        };
        const isIndependent = cellHasCheck(independentCol);
        // Adj-core flag's closest semantic in our judgeTag union is 'normal'
        // (matching the previous cheerio fallback's decision). See the
        // TODO(adj-core) above for the planned refinement.
        judgeTag = isIndependent ? 'invited' : 'normal';
      }
      // Em-dash means "none stated" — normalize to null so callers don't
      // have to. Mirrors what the deleted cheerio block did for the
      // institution column.
      const rawInst = instCol >= 0 ? cellText(row[instCol]) : '';
      const institution = rawInst && rawInst !== '—' && rawInst !== '-' ? rawInst : null;
      rows.push({
        name,
        role,
        judgeTag,
        teamName: teamCol >= 0 ? cellText(row[teamCol]) || null : null,
        institution,
      });
    }
  }
  return rows.length > 0 ? rows : null;
}

export function parseParticipantsList(html: string): ParticipantsRow[] {
  const vue = extractVueData(html);
  if (vue) {
    const rows = participantsFromVue(vue);
    if (rows) return rows;
  }
  const cheerioTables = extractFromCheerio(html);
  if (cheerioTables.length > 0) {
    const rows = participantsFromVue(cheerioTables);
    if (rows && rows.length > 0) return rows;
  }

  // Registration-card fallback used on some private/participants pages where
  // each participant is rendered as a <div class="list-group"> block instead
  // of a table. Registration cards aren't tables, so the cheerio→VueTable
  // adapter can't reach them — this is the one path that genuinely needs
  // bespoke cheerio code. Example heading: "Registration (Abhishek Acharya)"
  // followed by role bullets such as "Independent adjudicator".
  const $ = cheerio.load(html);
  const rows: ParticipantsRow[] = [];
  $('.list-group').each((_i, group) => {
    const $group = $(group);
    const title = cleanText($group.find('.card-title').first().text());
    const m = title.match(/^Registration\s*\((.+)\)$/i);
    const name = m ? cleanText(m[1] ?? '') : '';
    if (!name) return;

    const roleBullets = $group
      .find('li')
      .map((_j, li) => cleanText($(li).text()))
      .get()
      .filter(Boolean);
    const roleBlob = roleBullets.join(' ');
    let { role, judgeTag } = classifyParticipantRole(roleBlob);

    // Heuristic for registration cards that don't label role textually:
    // a single-name registration indicates an adjudicator account.
    if (role === 'other' && roleBullets.length === 1) {
      role = 'adjudicator';
      judgeTag = 'normal';
    }

    let institution: string | null = null;
    $group.find('.list-group-item').each((_j, item) => {
      const itemText = cleanText($(item).text());
      const instMatch = itemText.match(/^Institution:\s*(.+)$/i);
      if (!instMatch) return;
      const value = cleanText(instMatch[1] ?? '');
      institution = value && value !== '—' && value !== '-' ? value : null;
    });

    rows.push({ name, role, judgeTag, teamName: null, institution });
  });
  return rows;
}

// Re-export for tests that assert on the helper's contract.
export const __test__ = {
  findBalancedJsRegion,
};
