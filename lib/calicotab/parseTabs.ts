import * as cheerio from 'cheerio';

type CheerioRoot = ReturnType<typeof cheerio.load>;
type CheerioEl = ReturnType<CheerioRoot>;

function cleanText(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Return the first table whose header row matches a predicate. Tabbycat pages
 * often ship a small summary / filter table above the real standings; using
 * `$('table').first()` picks that summary table and returns zero rows.
 */
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

export function parseTeamTab(html: string): TeamTabRow[] {
  const $ = cheerio.load(html);
  const rows: TeamTabRow[] = [];
  // Pick the table whose header row contains a "team" column. This skips
  // summary/filter tables that sometimes render above the real standings.
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
    const cells = $(tr)
      .find('td')
      .map((_j, td) => cleanText($(td).text()))
      .get();
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

export function parseSpeakerTab(html: string): SpeakerTabRow[] {
  const $ = cheerio.load(html);
  const rows: SpeakerTabRow[] = [];
  // Pick the real speaker-standings table (header row contains "name" or
  // "speaker"), not an upstream filter/summary table.
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

  // ESL/EFL rank columns first so the "open rank" resolver can exclude them.
  // If we picked `idx('rank', '#')` directly, "ESL rank" (which contains "rank")
  // would win and pollute speakerRankOpen.
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

  // Remaining header cells are per-round score columns. Exclude every known
  // non-round column (including ESL/EFL rank) so we don't accidentally
  // index a rank or a team label as a round score.
  const nonRoundCols = new Set(
    [rankCol, rankEslCol, rankEflCol, nameCol, teamCol, instCol, totalCol].filter(
      (i) => i >= 0,
    ),
  );
  const roundIdxs: number[] = [];
  headerCells.forEach((h, i) => {
    if (nonRoundCols.has(i)) return;
    if (/\b(r(ound)?\s*\d+|final|semi|quarter|octo|grand)\b/i.test(h)) roundIdxs.push(i);
  });

  table.find('tbody tr').each((_i, tr) => {
    const cells = $(tr)
      .find('td')
      .map((_j, td) => cleanText($(td).text()))
      .get();
    if (!cells.length) return;
    const speakerName = nameCol >= 0 ? cells[nameCol] : cells[0];
    if (!speakerName) return;
    const roundScores = roundIdxs.map((i) => ({
      roundLabel: headerCells[i],
      score: parseNumber(cells[i]),
      positionLabel: null as string | null,
    }));
    rows.push({
      rank: rankCol >= 0 ? parseNumber(cells[rankCol]) : null,
      rankEsl: rankEslCol >= 0 ? parseNumber(cells[rankEslCol]) : null,
      rankEfl: rankEflCol >= 0 ? parseNumber(cells[rankEflCol]) : null,
      speakerName,
      teamName: teamCol >= 0 ? cells[teamCol] || null : null,
      institution: instCol >= 0 ? cells[instCol] || null : null,
      totalScore: totalCol >= 0 ? parseNumber(cells[totalCol]) : null,
      roundScores,
    });
  });
  return rows;
}

export function parseRoundResults(html: string, sourceUrl: string): RoundDebate {
  const $ = cheerio.load(html);
  const m = sourceUrl.match(/\/results\/round\/(\d+)/);
  const roundNumber = m ? Number(m[1]) : null;
  const roundLabel = cleanText($('h1, h2, h3, title').first().text()) || null;
  // Classify as an outround only when the URL path or label says so. The
  // previous `roundNumber > 5` heuristic misclassified BP tournaments with
  // 6-9 prelim rounds.
  const isOutround =
    /\/break\//i.test(sourceUrl) ||
    /\/elim/i.test(sourceUrl) ||
    /final|semi|quarter|octo|grand/i.test(roundLabel ?? '');

  const teamResults: RoundDebate['teamResults'] = [];
  // Key judges by "name|role" inside the parser so two table passes over the
  // same data don't emit duplicate entries. The by-debate view rarely needs
  // two passes, but we stay defensive.
  const judgeSeen = new Set<string>();
  const judgeAssignments: RoundDebate['judgeAssignments'] = [];

  // Single pass over tables: per-table, figure out which columns exist and
  // pull team rows AND adjudicator rows from the same scan.
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

    $(table)
      .find('tbody tr')
      .each((_j, tr) => {
        const cells = $(tr)
          .find('td')
          .map((_k, td) => cleanText($(td).text()))
          .get();

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
          // Names separate on "," ";" "\n" and " / " — never on arbitrary
          // double-space, which was corrupting multi-word names.
          const tokens = raw
            .split(/[,;\n]|\s+\/\s+/)
            .map((x) => cleanText(x))
            .filter(Boolean);
          for (const token of tokens) {
            const lower = token.toLowerCase();
            const isChair = /\bchair\b|\bchief\b|\(c\)/.test(lower) || /chair|chief/.test(roleText);
            const cleanedName = cleanText(
              token
                .replace(/\(\s*c\s*\)$/i, '')
                .replace(/\s+\(chair\)$/i, '')
                .replace(/\s+\(chief\)$/i, ''),
            );
            if (!cleanedName || cleanedName.length < 2) continue;
            const role: 'chair' | 'panel' | null = isChair
              ? 'chair'
              : roleText
                ? 'panel'
                : null;
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

export function parseBreakPage(html: string, sourceUrl: string): BreakRow[] {
  const $ = cheerio.load(html);
  const rows: BreakRow[] = [];
  const isAdj = /\/break\/adjudicators\//.test(sourceUrl);
  const stageMatch = sourceUrl.match(/\/break\/(teams\/[^/]+|adjudicators)/);
  const stage = stageMatch ? stageMatch[1] : null;

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
    const cells = $(tr)
      .find('td')
      .map((_j, td) => cleanText($(td).text()))
      .get();
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

export type ParticipantsRow = {
  name: string;
  role: 'speaker' | 'adjudicator' | 'other';
  judgeTag: 'normal' | 'invited' | 'subsidized' | null;
  teamName: string | null;
  institution: string | null;
};

export function parseParticipantsList(html: string): ParticipantsRow[] {
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

    $(table)
      .find('tbody tr')
      .each((_j, tr) => {
        const cells = $(tr)
          .find('td')
          .map((_k, td) => cleanText($(td).text()))
          .get();
        const name = cells[nameCol];
        if (!name) return;
        const roleText = roleCol >= 0 ? cells[roleCol].toLowerCase() : '';
        // Judge subtype tags. Covers British ("subsidised"), American ("subsidized"),
        // "invited" / "independent" variants, and falls back to "normal" for any
        // other adjudicator label.
        const judgeTag: ParticipantsRow['judgeTag'] =
          /subsid/i.test(roleText)
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
