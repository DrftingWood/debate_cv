import * as cheerio from 'cheerio';

type CheerioRoot = ReturnType<typeof cheerio.load>;
type CheerioEl = ReturnType<CheerioRoot>;

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
};
export type VueTable = { title?: string; subtitle?: string; head: VueHead[]; data: VueCell[][] };

/**
 * Evaluate a JS object/array literal string extracted from a trusted Tabbycat
 * page. `new Function` is used instead of `eval` so the code runs without
 * access to the local scope. The HTML source is always a URL that the user
 * explicitly chose to ingest (their own private tournament page).
 */
function evalJsLiteral(slice: string): unknown {
  // new Function('return <expr>') evaluates the expression in strict isolation
  // (no access to local variables or closures).
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function('return ' + slice)();
}

/**
 * Parse an extracted object/array slice — try strict JSON first (fast path),
 * then fall back to JS evaluation which handles unquoted keys and JS-only
 * values that Tabbycat embeds in its window.vueData object literal.
 */
function parseSlice(slice: string): VueTable[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(slice);
  } catch {
    // Tabbycat uses a JS object literal (unquoted keys, possible `undefined`/
    // `Infinity` values) — fall back to JS evaluation.
    try {
      parsed = evalJsLiteral(slice);
    } catch (e) {
      console.warn('[parseTabs] evalJsLiteral failed:', String(e).slice(0, 120));
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
 * Walk `html` looking for `marker` and extract the JS value assigned to it.
 * The brace counter correctly locates the value boundary; parseSlice() then
 * handles both strict JSON and JS object literal syntax.
 */
function extractJsonAt(html: string, marker: string): VueTable[] | null {
  const idx = html.indexOf(marker);
  if (idx < 0) return null;

  const rest = html.slice(idx + marker.length);
  let depth = 0;
  let inString = false;
  let escaped = false;
  let endIdx = -1;

  for (let i = 0; i < rest.length; i++) {
    const ch = rest[i]!;
    if (escaped) { escaped = false; continue; }
    if (ch === '\\' && inString) { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) { endIdx = i + 1; break; }
    }
  }

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
  let depth = 0;
  let inString = false;
  let escaped = false;
  let endIdx = -1;

  for (let i = 0; i < rest.length; i++) {
    const ch = rest[i]!;
    if (escaped) { escaped = false; continue; }
    if (ch === '\\' && inString) { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) { endIdx = i + 1; break; }
    }
  }

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
      let depth = 0, inStr = false, esc = false, endIdx = -1;
      for (let i = 0; i < rest.length; i++) {
        const ch = rest[i]!;
        if (esc) { esc = false; continue; }
        if (ch === '\\' && inStr) { esc = true; continue; }
        if (ch === '"') { inStr = !inStr; continue; }
        if (inStr) continue;
        if (ch === '{' || ch === '[') depth++;
        else if (ch === '}' || ch === ']') { depth--; if (depth === 0) { endIdx = i + 1; break; } }
      }
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

// ── Cheerio helpers (fallback for server-rendered Tabbycat) ──────────────────

function cleanText(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function classifyParticipantRole(roleText: string): { role: ParticipantsRow['role']; judgeTag: ParticipantsRow['judgeTag'] } {
  const lowered = roleText.toLowerCase();
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

function findTableByHeader(
  $: CheerioRoot,
  headerMatcher: (loweredHeaders: string[]) => boolean,
): CheerioEl | null {
  let found: CheerioEl | null = null;
  $('table').each((_i, el) => {
    if (found) return;
    const headers = $(el)
      .find('thead tr').first()
      .find('th')
      .map((_j, th) => cleanText($(th).text()).toLowerCase())
      .get();
    if (headers.length === 0) return;
    if (headerMatcher(headers)) found = $(el);
  });
  return found;
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
  judgeTag: 'normal' | 'invited' | 'subsidized' | null;
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

  // Cheerio fallback
  const $ = cheerio.load(html);
  const rows: TeamTabRow[] = [];
  const table =
    findTableByHeader($, (headers) => headers.some((h) => h.includes('team'))) ??
    $('table').first();
  const headers = table
    .find('thead th, tr').first()
    .find('th')
    .map((_i, th) => cleanText($(th).text()).toLowerCase())
    .get();
  const idx = (...needles: string[]) =>
    headers.findIndex((h) => needles.some((n) => h.includes(n)));
  const rankCol = idx('rank');
  const teamCol = idx('team');
  const instCol = idx('institution', 'school');
  const speakersCol = idx('speakers');
  const winsCol = idx('win', 'record');
  const pointsCol = idx('total', 'points');
  table.find('tbody tr').each((_i, tr) => {
    const cells = $(tr).find('td').map((_j, td) => cleanText($(td).text())).get();
    if (!cells.length) return;
    const teamName = teamCol >= 0 ? cells[teamCol] : cells[0];
    if (!teamName) return;
    const speakersText = speakersCol >= 0 ? cells[speakersCol] : '';
    rows.push({
      rank: rankCol >= 0 ? parseNumber(cells[rankCol]) : null,
      teamName,
      institution: instCol >= 0 ? cells[instCol] || null : null,
      speakers: speakersText
        ? speakersText.split(/[,;]|\sand\s/).map(cleanText).filter(Boolean)
        : [],
      wins: winsCol >= 0 ? parseNumber(cells[winsCol]) : null,
      totalPoints: pointsCol >= 0 ? parseNumber(cells[pointsCol]) : null,
    });
  });
  return rows;
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

  const teamCol = vueCol(heads, 'team');
  const instCol = vueCol(heads, 'inst', 'school');
  const totalCol = vueCol(heads, 'total', 'spk', 'score');

  const nonRound = new Set(
    [rankCol, rankEslCol, rankEflCol, nameCol, teamCol, instCol, totalCol].filter((i) => i >= 0),
  );
  const roundCols: Array<{ idx: number; label: string }> = [];
  heads.forEach((h, i) => {
    if (nonRound.has(i)) return;
    const k = h.key ?? '';
    const t = h.title ?? '';
    const label = t || k;
    if (/\b(r(ound)?\s*\d+|final|semi|quarter|octo|grand)\b/i.test(label) || /^r\d+$/i.test(k)) {
      roundCols.push({ idx: i, label });
    }
  });

  const rows: SpeakerTabRow[] = [];
  for (const row of table.data) {
    const speakerName = cellText(row[nameCol]);
    if (!speakerName) continue;
    rows.push({
      rank: rankCol >= 0 ? parseNumber(cellText(row[rankCol])) : null,
      rankEsl: rankEslCol >= 0 ? parseNumber(cellText(row[rankEslCol])) : null,
      rankEfl: rankEflCol >= 0 ? parseNumber(cellText(row[rankEflCol])) : null,
      speakerName,
      teamName: teamCol >= 0 ? cellText(row[teamCol]) || null : null,
      institution: instCol >= 0 ? cellText(row[instCol]) || null : null,
      totalScore: totalCol >= 0 ? parseNumber(cellText(row[totalCol])) : null,
      roundScores: roundCols.map(({ idx, label }) => ({
        roundLabel: label,
        score: parseNumber(cellText(row[idx])),
        positionLabel: null,
      })),
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

  // Cheerio fallback
  const $ = cheerio.load(html);
  const rows: SpeakerTabRow[] = [];
  const table =
    findTableByHeader($, (headers) =>
      headers.some((h) => h.includes('name') || h.includes('speaker')),
    ) ?? $('table').first();
  const headerCells = table
    .find('thead tr').first()
    .find('th')
    .map((_i, th) => cleanText($(th).text()))
    .get();
  const lowered = headerCells.map((h) => h.toLowerCase());
  const idx = (...needles: string[]) =>
    lowered.findIndex((h) => needles.some((n) => h.includes(n)));
  const rankEslCol = lowered.findIndex((h) => /\besl\b/.test(h));
  const rankEflCol = lowered.findIndex((h) => /\befl\b/.test(h));
  const rankCol = lowered.findIndex((h, i) => {
    if (i === rankEslCol || i === rankEflCol) return false;
    if (/\b(esl|efl|break)\b/.test(h)) return false;
    return /\brank\b/.test(h) || h === '#';
  });
  const nameCol = idx('name', 'speaker');
  const teamCol = idx('team');
  const instCol = idx('institution');
  const totalCol = idx('total', 'score');
  const nonRoundCols = new Set(
    [rankCol, rankEslCol, rankEflCol, nameCol, teamCol, instCol, totalCol].filter((i) => i >= 0),
  );
  const roundIdxs: number[] = [];
  headerCells.forEach((h, i) => {
    if (nonRoundCols.has(i)) return;
    if (/\b(r(ound)?\s*\d+|final|semi|quarter|octo|grand)\b/i.test(h)) roundIdxs.push(i);
  });
  table.find('tbody tr').each((_i, tr) => {
    const cells = $(tr).find('td').map((_j, td) => cleanText($(td).text())).get();
    if (!cells.length) return;
    const speakerName = nameCol >= 0 ? cells[nameCol] : cells[0];
    if (!speakerName) return;
    rows.push({
      rank: rankCol >= 0 ? parseNumber(cells[rankCol]) : null,
      rankEsl: rankEslCol >= 0 ? parseNumber(cells[rankEslCol]) : null,
      rankEfl: rankEflCol >= 0 ? parseNumber(cells[rankEflCol]) : null,
      speakerName,
      teamName: teamCol >= 0 ? cells[teamCol] || null : null,
      institution: instCol >= 0 ? cells[instCol] || null : null,
      totalScore: totalCol >= 0 ? parseNumber(cells[totalCol]) : null,
      roundScores: roundIdxs.map((i) => ({
        roundLabel: headerCells[i]!,
        score: parseNumber(cells[i]),
        positionLabel: null,
      })),
    });
  });
  return rows;
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
  if (teamCol < 0) return null;

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
    const teamName = cellText(row[teamCol]);
    if (teamName) {
      const winText = winCol >= 0 ? cellText(row[winCol]).toLowerCase() : '';
      const won = winCol >= 0 ? /won|win|✓|\btrue\b|\b1\b/.test(winText) : null;
      teamResults.push({
        teamName,
        position: posCol >= 0 ? cellText(row[posCol]) || null : null,
        points: ptsCol >= 0 ? parseNumber(cellText(row[ptsCol])) : null,
        won,
      });
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

  // Cheerio fallback — reuse the hoisted roundLabel + isOutround so both
  // paths agree on classification.
  const $ = cheerio.load(html);
  const teamResults: RoundDebate['teamResults'] = [];
  const judgeSeen = new Set<string>();
  const judgeAssignments: RoundDebate['judgeAssignments'] = [];
  $('table').each((_i, table) => {
    const headers = $(table)
      .find('thead tr').first()
      .find('th')
      .map((_j, th) => cleanText($(th).text()).toLowerCase())
      .get();
    if (!headers.length) return;
    const teamCol = headers.findIndex((h) => h.includes('team'));
    const pointsCol = headers.findIndex((h) => h.includes('points') || h.includes('score'));
    const posCol = headers.findIndex((h) => h.includes('position') || h.includes('side'));
    const winCol = headers.findIndex((h) => h === 'win' || h.includes('result'));
    const adjCol = headers.findIndex((h) => h.includes('adjud') || h.includes('judge'));
    const roleCol = headers.findIndex(
      (h) => h.includes('chair') || h.includes('panel') || h.includes('role'),
    );
    $(table).find('tbody tr').each((_j, tr) => {
      const cells = $(tr).find('td').map((_k, td) => cleanText($(td).text())).get();
      if (teamCol >= 0 && cells[teamCol]) {
        const winText = winCol >= 0 ? (cells[winCol] || '').toLowerCase() : '';
        const won = winCol >= 0 ? /won|win|✓|\b1\b/.test(winText) : null;
        teamResults.push({
          teamName: cells[teamCol]!,
          position: posCol >= 0 ? cells[posCol] || null : null,
          points: pointsCol >= 0 ? parseNumber(cells[pointsCol]) : null,
          won,
        });
      }
      if (adjCol >= 0 && cells[adjCol]) {
        const raw = cells[adjCol]!;
        const roleText = roleCol >= 0 ? (cells[roleCol] || '').toLowerCase() : '';
        const tokens = raw.split(/[,;\n]|\s+\/\s+/).map((x) => cleanText(x)).filter(Boolean);
        for (const token of tokens) {
          const lower = token.toLowerCase();
          const isChair = /\bchair\b|\bchief\b|\(c\)/.test(lower) || /chair|chief/.test(roleText);
          const cleanedName = cleanText(
            token.replace(/\(\s*c\s*\)$/i, '').replace(/\s+\(chair\)$/i, '').replace(/\s+\(chief\)$/i, ''),
          );
          if (!cleanedName || cleanedName.length < 2) continue;
          const role: 'chair' | 'panel' | null = isChair ? 'chair' : roleText ? 'panel' : null;
          const key = `${cleanedName}|${role ?? ''}`;
          if (judgeSeen.has(key)) continue;
          judgeSeen.add(key);
          judgeAssignments.push({ personName: cleanedName, panelRole: role });
        }
      }
    });
  });
  return { roundNumber, roundLabel, isOutround, teamResults, judgeAssignments };
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

  // Cheerio fallback
  const $ = cheerio.load(html);
  const rows: BreakRow[] = [];
  const table = $('table').first();
  const headers = table
    .find('thead tr').first()
    .find('th')
    .map((_i, th) => cleanText($(th).text()).toLowerCase())
    .get();
  const idx = (...needles: string[]) =>
    headers.findIndex((h) => needles.some((n) => h.includes(n)));
  // See breakPageFromVue: judge breaks are binary, no rank concept — don't
  // extract one even if a column header happens to look rank-like.
  const rankCol = isAdj ? -1 : idx('rank', '#');
  const nameCol = idx('team', 'adjudicator', 'name');
  const instCol = idx('institution');
  const scoreCol = idx('score', 'points', 'total');
  table.find('tbody tr').each((_i, tr) => {
    const cells = $(tr).find('td').map((_j, td) => cleanText($(td).text())).get();
    if (!cells.length) return;
    const entityName = nameCol >= 0 ? cells[nameCol] : cells[0];
    if (!entityName) return;
    rows.push({
      rank: rankCol >= 0 ? parseNumber(cells[rankCol]) : null,
      entityType: isAdj ? 'adjudicator' : 'team',
      entityName,
      institution: instCol >= 0 ? cells[instCol] || null : null,
      score: scoreCol >= 0 ? parseNumber(cells[scoreCol]) : null,
      stage,
    });
  });
  return rows;
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

    // Infer role from table structure when there's no explicit role column
    const isSpeakerTable = teamCol >= 0;
    const isAdjTable =
      !isSpeakerTable &&
      heads.some((h) => {
        const k = (h.key ?? '').toLowerCase();
        const t = (h.title ?? '').toLowerCase();
        return k.includes('rating') || t.includes('rating');
      });

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
        judgeTag = 'normal';
      }
      rows.push({
        name,
        role,
        judgeTag,
        teamName: teamCol >= 0 ? cellText(row[teamCol]) || null : null,
        institution: instCol >= 0 ? cellText(row[instCol]) || null : null,
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

  // Cheerio fallback. Modern Tabbycat puts the section type in the card-title
  // heading above each table (e.g. <h4 class="card-title">Adjudicators</h4>)
  // rather than in a "role" column on each row, so we walk cards rather than
  // raw <table> elements. Two tables on a page (Adjudicators + Speakers) both
  // get parsed — the heading is the only signal that distinguishes them.
  const $ = cheerio.load(html);
  const rows: ParticipantsRow[] = [];

  // Pull the canonical text out of one <td>. Vue-rendered cells embed a
  // <span hidden> with the sortable value plus visible content that mixes
  // emoji icons, tooltip triggers, and popover bodies — flattening with
  // .text() concatenates all of it. Prefer the hidden span; fall back to
  // the visible .tooltip-trigger; final fallback is the raw .text().
  const cellText = ($cell: ReturnType<typeof $>): string => {
    const hidden = $cell.find('span[hidden]').first().text();
    if (hidden && hidden.trim()) return cleanText(hidden);
    const trigger = $cell.find('.tooltip-trigger').first().text();
    if (trigger && trigger.trim()) return cleanText(trigger);
    return cleanText($cell.text());
  };

  // Em-dash means "none stated" — normalize to null so callers don't have to.
  const normalizeInst = (s: string): string | null => {
    const t = s.trim();
    if (!t || t === '—' || t === '-') return null;
    return t;
  };

  const containers = [
    ...$('.card-body, .card').toArray(),
    ...$('table').toArray(),
  ];
  // Dedupe by table — a .card-body inside a .card would otherwise process the
  // same <table> twice.
  const seenTables = new Set<unknown>();

  for (const card of containers) {
    const $card = $(card);
    const heading = cleanText($card.find('.card-title').first().text()).toLowerCase();
    let sectionRole: ParticipantsRow['role'] | null = null;
    if (/^adjudicators?$/.test(heading)) sectionRole = 'adjudicator';
    else if (/^speakers?$/.test(heading)) sectionRole = 'speaker';

    const $table = $card.is('table') ? $card : $card.find('table').first();
    if ($table.length === 0) continue;
    const tableEl = $table.get(0);
    if (!tableEl || seenTables.has(tableEl)) continue;
    seenTables.add(tableEl);

    // Read column headers — prefer data-original-title (the tooltip text,
    // which carries the full label like "Member of the Adjudication Core")
    // over the visible text (which is just an icon).
    const headers = $table
      .find('thead tr').first()
      .find('th')
      .map((_j, th) => {
        const $th = $(th);
        const tooltip = ($th.attr('data-original-title') ?? '').toLowerCase();
        const text = cleanText($th.text()).toLowerCase();
        return tooltip || text;
      })
      .get();

    const nameCol = headers.findIndex((h) => h.includes('name'));
    if (nameCol < 0) continue;
    const teamCol = headers.findIndex((h) => h.includes('team'));
    const instCol = headers.findIndex((h) => h.includes('institution'));
    const roleCol = headers.findIndex((h) => h.includes('role'));
    const adjCoreCol = headers.findIndex(
      (h) => h.includes('adjudication core') || h.includes('adj core'),
    );
    const independentCol = headers.findIndex((h) => h.includes('independent'));

    $table.find('tbody tr').each((_j, tr) => {
      const $tr = $(tr);
      const cells = $tr.find('td').toArray();
      if (cells.length === 0) return;

      const name = cellText($(cells[nameCol]));
      if (!name) return;

      // Role: explicit "role" column (legacy) wins; otherwise the card
      // heading; otherwise unknown.
      let role: ParticipantsRow['role'] = sectionRole ?? 'other';
      let judgeTag: ParticipantsRow['judgeTag'] = null;
      if (roleCol >= 0) {
        const classified = classifyParticipantRole(cellText($(cells[roleCol])));
        role = classified.role;
        judgeTag = classified.judgeTag;
      }

      // For adjudicators without an explicit role-column tag, infer the
      // judgeTag from the Adj Core / Independent flag columns. Tabbycat
      // shows a check-icon (.feather-check) when the flag is true; the
      // hidden sort value alongside isn't a reliable boolean signal because
      // its scheme has flipped between versions.
      if (role === 'adjudicator' && judgeTag === null) {
        const cellHasCheck = (idx: number): boolean =>
          idx >= 0 && idx < cells.length && $(cells[idx]).find('.feather-check').length > 0;
        const isIndependent = cellHasCheck(independentCol);
        // Adj-core flag exists but our judgeTag union has no 'core' option;
        // 'normal' is the closest semantic match for non-independent adjs.
        judgeTag = isIndependent ? 'invited' : 'normal';
      }

      const teamName =
        teamCol >= 0 ? cellText($(cells[teamCol])) || null : null;
      const institution =
        instCol >= 0 ? normalizeInst(cellText($(cells[instCol]))) : null;

      rows.push({ name, role, judgeTag, teamName, institution });
    });
  }

  // Legacy plain-table fallback (no card wrappers/headings).
  if (rows.length === 0) {
    $('table').each((_i, table) => {
      const $table = $(table);
      const headers = $table
        .find('thead tr').first()
        .find('th')
        .map((_j, th) => cleanText($(th).text()).toLowerCase())
        .get();
      if (headers.length === 0) return;
      const nameCol = headers.findIndex((h) => h.includes('name'));
      if (nameCol < 0) return;
      const teamCol = headers.findIndex((h) => h.includes('team'));
      const instCol = headers.findIndex((h) => h.includes('institution'));
      const roleCol = headers.findIndex((h) => h.includes('role'));

      $table.find('tbody tr').each((_j, tr) => {
        const cells = $(tr).find('td').toArray();
        if (cells.length === 0) return;
        const name = cellText($(cells[nameCol]));
        if (!name) return;

        let role: ParticipantsRow['role'] = 'other';
        let judgeTag: ParticipantsRow['judgeTag'] = null;
        if (roleCol >= 0) {
          const classified = classifyParticipantRole(cellText($(cells[roleCol])));
          role = classified.role;
          judgeTag = classified.judgeTag;
        } else if (teamCol >= 0) {
          role = 'speaker';
        }

        rows.push({
          name,
          role,
          judgeTag,
          teamName: teamCol >= 0 ? cellText($(cells[teamCol])) || null : null,
          institution: instCol >= 0 ? normalizeInst(cellText($(cells[instCol]))) : null,
        });
      });
    });
  }

  // Registration-card fallback used on some private/participants pages where
  // each participant is rendered as a <div class="list-group"> block instead
  // of a table. Example heading: "Registration (Abhishek Acharya)" followed by
  // role bullets such as "Independent adjudicator".
  if (rows.length === 0) {
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
  }
  return rows;
}
