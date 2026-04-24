import * as cheerio from 'cheerio';

function cleanText(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
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
  speakerName: string;
  teamName: string | null;
  institution: string | null;
  totalScore: number | null;
  roundScores: Array<{ roundLabel: string; score: number | null; positionLabel: string | null }>;
};

export type RoundDebate = {
  roundNumber: number | null;
  teamResults: Array<{ teamName: string; position: string | null; points: number | null; won: boolean | null }>;
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
  const table = $('table').first();
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
  const table = $('table').first();
  const headerCells = table
    .find('thead tr').first()
    .find('th')
    .map((_i, th) => cleanText($(th).text()))
    .get();
  const lowered = headerCells.map((h) => h.toLowerCase());
  const idx = (...needles: string[]) =>
    lowered.findIndex((h) => needles.some((n) => h.includes(n)));

  const rankCol = idx('rank', '#');
  const nameCol = idx('name', 'speaker');
  const teamCol = idx('team');
  const instCol = idx('institution');
  const totalCol = idx('total', 'score');

  // remaining header cells are per-round. Keep their labels.
  const roundIdxs: number[] = [];
  headerCells.forEach((h, i) => {
    if ([rankCol, nameCol, teamCol, instCol, totalCol].includes(i)) return;
    if (/\b(r(ound)?\s*\d+|final|semi|quarter|octo)\b/i.test(h)) roundIdxs.push(i);
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
  const teamResults: RoundDebate['teamResults'] = [];

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

    if (teamCol < 0) return;

    $(table)
      .find('tbody tr')
      .each((_j, tr) => {
        const cells = $(tr)
          .find('td')
          .map((_k, td) => cleanText($(td).text()))
          .get();
        const teamName = cells[teamCol];
        if (!teamName) return;
        const winText = winCol >= 0 ? (cells[winCol] || '').toLowerCase() : '';
        const won = winCol >= 0 ? /won|win|✓|\b1\b/.test(winText) : null;
        teamResults.push({
          teamName,
          position: posCol >= 0 ? cells[posCol] || null : null,
          points: pointsCol >= 0 ? parseNumber(cells[pointsCol]) : null,
          won,
        });
      });
  });

  return { roundNumber, teamResults };
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
        const role: ParticipantsRow['role'] = /adjud|judge/.test(roleText)
          ? 'adjudicator'
          : /speak|debat/.test(roleText)
            ? 'speaker'
            : 'other';
        rows.push({
          name,
          role,
          teamName: teamCol >= 0 ? cells[teamCol] || null : null,
          institution: instCol >= 0 ? cells[instCol] || null : null,
        });
      });
  });
  return rows;
}
