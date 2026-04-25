import * as cheerio from 'cheerio';

type CheerioRoot = ReturnType<typeof cheerio.load>;
type CheerioEl = ReturnType<CheerioRoot>;

// ── Vue.js data types ────────────────────────────────────────────────────────
// Tabbycat renders all tab/results/break pages via a Vue component that reads
// `window.vueData.tablesData` from the page's inline script. The server-rendered
// HTML has no <table> elements — cheerio finds nothing. We extract the JSON
// directly, with the cheerio path as a fallback for older deployments.

type VueHead = { key?: string; title?: string; tooltip?: string };
type VueCell = { text?: string; sort?: number | string; class?: string; popover?: string };
type VueTable = { head: VueHead[]; data: VueCell[][] };

/**
 * Walk the HTML for `window.vueData = { tablesData: [...] }` and return the
 * tables array. Uses a string-aware brace counter so nested JSON and quoted
 * braces don't confuse the boundary detection.
 */
function extractVueData(html: string): VueTable[] | null {
  const marker = 'window.vueData = ';
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
  try {
    const parsed = JSON.parse(rest.slice(0, endIdx)) as { tablesData?: unknown };
    if (Array.isArray(parsed?.tablesData)) return parsed.tablesData as VueTable[];
  } catch {
    return null;
  }
  return null;
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

  const teamResults: RoundDebate['teamResults'] = [];
  for (const row of table.data) {
    const teamName = cellText(row[teamCol]);
    if (!teamName) continue;
    const winText = winCol >= 0 ? cellText(row[winCol]).toLowerCase() : '';
    const won = winCol >= 0 ? /won|win|✓|\btrue\b|\b1\b/.test(winText) : null;
    teamResults.push({
      teamName,
      position: posCol >= 0 ? cellText(row[posCol]) || null : null,
      points: ptsCol >= 0 ? parseNumber(cellText(row[ptsCol])) : null,
      won,
    });
  }
  return teamResults.length > 0
    ? { roundNumber, roundLabel, isOutround, teamResults, judgeAssignments: [] }
    : null;
}

export function parseRoundResults(html: string, sourceUrl: string): RoundDebate {
  const m = sourceUrl.match(/\/results\/round\/(\d+)/);
  const roundNumber = m ? Number(m[1]) : null;
  const roundLabelFallback = `Round ${roundNumber ?? '?'}`;
  const isOutround =
    /\/break\//i.test(sourceUrl) ||
    /\/elim/i.test(sourceUrl);

  const vue = extractVueData(html);
  if (vue) {
    const result = roundResultsFromVue(vue, roundNumber, roundLabelFallback, isOutround);
    if (result) return result;
  }

  // Cheerio fallback
  const $ = cheerio.load(html);
  const roundLabel = cleanText($('h1, h2, h3, title').first().text()) || roundLabelFallback;
  const isOutroundFull =
    isOutround || /final|semi|quarter|octo|grand/i.test(roundLabel);
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
  return { roundNumber, roundLabel, isOutround: isOutroundFull, teamResults, judgeAssignments };
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

  const rankCol = vueCol(heads, 'rk', 'rank', '#');
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

export function parseBreakPage(html: string, sourceUrl: string): BreakRow[] {
  const isAdj = /\/break\/adjudicators\//.test(sourceUrl);
  const stageMatch = sourceUrl.match(/\/break\/(teams\/[^/]+|adjudicators)/);
  const stage = stageMatch ? stageMatch[1] : null;

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
  const rankCol = idx('rank', '#');
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
        const roleText = cellText(row[roleCol]).toLowerCase();
        if (/adjud|judge/i.test(roleText)) {
          role = 'adjudicator';
          judgeTag = /subsid/i.test(roleText)
            ? 'subsidized'
            : /invited|independent/i.test(roleText)
              ? 'invited'
              : 'normal';
        } else if (/speak|debat/i.test(roleText)) {
          role = 'speaker';
        }
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

  // Cheerio fallback
  const $ = cheerio.load(html);
  const rows: ParticipantsRow[] = [];
  $('table').each((_i, table) => {
    const headers = $(table)
      .find('thead tr').first()
      .find('th')
      .map((_j, th) => cleanText($(th).text()).toLowerCase())
      .get();
    const nameCol = headers.findIndex((h) => h.includes('name'));
    const teamCol = headers.findIndex((h) => h.includes('team'));
    const instCol = headers.findIndex((h) => h.includes('institution'));
    const roleCol = headers.findIndex((h) => h.includes('role'));
    if (nameCol < 0) return;
    $(table).find('tbody tr').each((_j, tr) => {
      const cells = $(tr).find('td').map((_k, td) => cleanText($(td).text())).get();
      const name = cells[nameCol];
      if (!name) return;
      const roleText = roleCol >= 0 ? (cells[roleCol] ?? '').toLowerCase() : '';
      const judgeTag: ParticipantsRow['judgeTag'] = /subsid/i.test(roleText)
        ? 'subsidized'
        : /invited|independent/i.test(roleText)
          ? 'invited'
          : /adjud|judge/i.test(roleText)
            ? 'normal'
            : null;
      const role: ParticipantsRow['role'] = /adjud|judge/i.test(roleText)
        ? 'adjudicator'
        : /speak|debat/i.test(roleText)
          ? 'speaker'
          : 'other';
      rows.push({
        name,
        role,
        judgeTag,
        teamName: teamCol >= 0 ? cells[teamCol] || null : null,
        institution: instCol >= 0 ? cells[instCol] || null : null,
      });
    });
  });
  return rows;
}
