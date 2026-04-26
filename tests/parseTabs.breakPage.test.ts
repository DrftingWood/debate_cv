import { describe, expect, test } from 'vitest';
import { parseBreakPage } from '@/lib/calicotab/parseTabs';

// Tabbycat embeds break-page data in two ways: a Vue data island the SPA
// hydrates from, and a server-rendered <table> fallback. Both code paths
// pull `stage` from the URL fragment — that fragment must be normalised to
// the canonical name (Open/ESL/EFL/...) before being persisted into
// `EliminationResult.stage`, otherwise downstream stage-rank classification
// silently rejects non-Open categories.

const TABLE_HTML = (rows: string) => `
<html><body>
  <table>
    <thead>
      <tr><th>Rank</th><th>Team</th><th>Institution</th><th>Score</th></tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
</body></html>
`;

const ROW = (rank: string, team: string) =>
  `<tr><td>${rank}</td><td>${team}</td><td>MIT</td><td>40</td></tr>`;

describe('parseBreakPage — stage normalization from URL fragment', () => {
  test('"teams/open" URL → stage "Open"', () => {
    const rows = parseBreakPage(
      TABLE_HTML(ROW('1', 'MIT A')),
      'https://x.calicotab.com/foo/break/teams/open/',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.stage).toBe('Open');
  });

  test('"teams/esl" URL → stage "ESL"', () => {
    const rows = parseBreakPage(
      TABLE_HTML(ROW('2', 'IIT Delhi A')),
      'https://x.calicotab.com/foo/break/teams/esl/',
    );
    expect(rows[0]!.stage).toBe('ESL');
  });

  test('"teams/efl" URL → stage "EFL"', () => {
    const rows = parseBreakPage(
      TABLE_HTML(ROW('3', 'Some Team')),
      'https://x.calicotab.com/foo/break/teams/efl/',
    );
    expect(rows[0]!.stage).toBe('EFL');
  });

  test('"teams/novice" URL → title-cased "Novice"', () => {
    const rows = parseBreakPage(
      TABLE_HTML(ROW('4', 'New Team')),
      'https://x.calicotab.com/foo/break/teams/novice/',
    );
    expect(rows[0]!.stage).toBe('Novice');
  });

  test('"teams/pro-am" URL → "Pro-Am" (preserves hyphen, title-cases each part)', () => {
    const rows = parseBreakPage(
      TABLE_HTML(ROW('5', 'Pro-Am Team')),
      'https://x.calicotab.com/foo/break/teams/pro-am/',
    );
    expect(rows[0]!.stage).toBe('Pro-Am');
  });

  test('"adjudicators" URL → "Adjudicators"', () => {
    const rows = parseBreakPage(
      TABLE_HTML(ROW('1', 'Some Judge')),
      'https://x.calicotab.com/foo/break/adjudicators/',
    );
    expect(rows[0]!.stage).toBe('Adjudicators');
  });

  test('row entityType reflects URL category', () => {
    const teamRows = parseBreakPage(
      TABLE_HTML(ROW('1', 'Team X')),
      'https://x.calicotab.com/foo/break/teams/open/',
    );
    const adjRows = parseBreakPage(
      TABLE_HTML(ROW('1', 'Judge X')),
      'https://x.calicotab.com/foo/break/adjudicators/',
    );
    expect(teamRows[0]!.entityType).toBe('team');
    expect(adjRows[0]!.entityType).toBe('adjudicator');
  });
});
