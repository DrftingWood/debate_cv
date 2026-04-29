import { describe, expect, test } from 'vitest';
import { parseRoundResults } from '@/lib/calicotab/parseTabs';

describe('parseRoundResults — isOutround classification', () => {
  test('R6 on a prelim page is NOT an outround (old heuristic misfired)', () => {
    const html = `
      <table>
        <thead><tr><th>Team</th><th>Position</th><th>Points</th></tr></thead>
        <tbody><tr><td>Alpha</td><td>OG</td><td>3</td></tr></tbody>
      </table>
    `;
    const round = parseRoundResults(html, 'https://h.calicotab.com/t/results/round/6/');
    expect(round.isOutround).toBe(false);
    expect(round.roundNumber).toBe(6);
  });

  test('URL under /break/ is an outround', () => {
    const html = `<html><body><h2>Break Round 1</h2></body></html>`;
    const round = parseRoundResults(html, 'https://h.calicotab.com/t/break/teams/open/');
    expect(round.isOutround).toBe(true);
  });

  test('page title mentioning "Grand Final" is an outround', () => {
    const html = `<h1>Grand Final — Results</h1>`;
    const round = parseRoundResults(html, 'https://h.calicotab.com/t/results/round/9/');
    expect(round.isOutround).toBe(true);
  });
});

// Builds a minimal HTML page with a Vue data island shaped the way modern
// Tabbycat instances render results. Each `head[i]` describes a column
// (`key` is the data key, `title` is the visible label); each row in
// `data` is an array of `{ text }` cells aligned with `head`. Used to
// pin the Vue extraction path in roundResultsFromVue.
function vueResultsHtml(head: { key: string; title: string }[], data: { text: string }[][]): string {
  const payload = JSON.stringify([{ head, data }]);
  return `<!doctype html><html><body><script>window.vueData = ${payload}</script></body></html>`;
}

describe('parseRoundResults — Vue judge extraction', () => {
  // Regression: roundResultsFromVue used to hardcode `judgeAssignments: []`
  // for every Vue-rendered round results page, silently dropping every judge
  // for completed tournaments where the private-URL Debates card is empty.
  // SIDO 2026's CV hit this: 16 round-results pages parsed, 0 judges seen,
  // recordJudgeRoundsFromRoundResults found nothing to write.
  test('extracts judges from a Vue data island with an "adjudicators" column', () => {
    const html = vueResultsHtml(
      [
        { key: 'team', title: 'Team' },
        { key: 'position', title: 'Position' },
        { key: 'points', title: 'Points' },
        { key: 'adjudicators', title: 'Adjudicators' },
      ],
      [
        [
          { text: 'Alpha' },
          { text: 'OG' },
          { text: '3' },
          { text: 'Jane Doe (chair), John Roe' },
        ],
        [
          { text: 'Beta' },
          { text: 'OO' },
          { text: '2' },
          { text: 'Jane Doe (chair), John Roe' },
        ],
      ],
    );
    const round = parseRoundResults(html, 'https://x.calicotab.com/t/results/round/1/');
    expect(round.teamResults).toHaveLength(2);
    expect(round.judgeAssignments).toHaveLength(2);
    const chair = round.judgeAssignments.find((j) => j.personName === 'Jane Doe');
    const panel = round.judgeAssignments.find((j) => j.personName === 'John Roe');
    expect(chair?.panelRole).toBe('chair');
    expect(panel?.panelRole).toBeNull();
  });

  test('chair markers "(c)", "(chair)", "(chief)" all classify as chair and get stripped from the name', () => {
    const html = vueResultsHtml(
      [
        { key: 'team', title: 'Team' },
        { key: 'adjudicators', title: 'Adj' },
      ],
      [
        [{ text: 'Team A' }, { text: 'Alice (c), Bob (chair), Carol (chief), Dave' }],
      ],
    );
    const round = parseRoundResults(html, 'https://x.calicotab.com/t/results/round/2/');
    const names = round.judgeAssignments.map((j) => j.personName).sort();
    expect(names).toEqual(['Alice', 'Bob', 'Carol', 'Dave']);
    const chairs = round.judgeAssignments.filter((j) => j.panelRole === 'chair').map((j) => j.personName).sort();
    expect(chairs).toEqual(['Alice', 'Bob', 'Carol']);
  });

  test('returns judgeAssignments: [] when the Vue table has no adjudicator column', () => {
    const html = vueResultsHtml(
      [
        { key: 'team', title: 'Team' },
        { key: 'points', title: 'Points' },
      ],
      [
        [{ text: 'Alpha' }, { text: '3' }],
      ],
    );
    const round = parseRoundResults(html, 'https://x.calicotab.com/t/results/round/3/');
    expect(round.teamResults).toHaveLength(1);
    expect(round.judgeAssignments).toEqual([]);
  });

  test('dedups identical (name, role) pairs that appear in multiple rows', () => {
    // Tabbycat's by-team view emits one row per team in a debate, all
    // listing the same panel. Vue extraction must not count the same
    // judge twice across rows of the same debate.
    const html = vueResultsHtml(
      [
        { key: 'team', title: 'Team' },
        { key: 'adjudicators', title: 'Adjudicators' },
      ],
      [
        [{ text: 'Alpha' }, { text: 'Jane Doe (c), John Roe' }],
        [{ text: 'Beta' }, { text: 'Jane Doe (c), John Roe' }],
      ],
    );
    const round = parseRoundResults(html, 'https://x.calicotab.com/t/results/round/4/');
    expect(round.judgeAssignments).toHaveLength(2);
  });

  test('outround pages routed through /results/round/N/ are detected via the page heading', () => {
    // Tabbycat installs route prelims AND outrounds through /results/round/N/.
    // The URL alone can't distinguish them — only the page heading can. Without
    // the hoisted heading-extraction, Vue-rendered outround pages used to land
    // with roundLabel="Round 7", isOutround=false, which made downstream
    // classifyRoundLabel count QF as a 7th INROUND on SIDO's CV.
    const head = [
      { key: 'team', title: 'Team' },
      { key: 'adjudicators', title: 'Adjudicators' },
    ];
    const data = [[{ text: 'Alpha' }, { text: 'Jane Doe (c), John Roe' }]];
    const payload = JSON.stringify([{ head, data }]);
    const html = `
      <!doctype html>
      <html>
        <body>
          <h1>Quarterfinals — Some Tournament 2026</h1>
          <script>window.vueData = ${payload}</script>
        </body>
      </html>
    `;
    const round = parseRoundResults(html, 'https://x.calicotab.com/t/results/round/7/');
    expect(round.isOutround).toBe(true);
    expect(round.roundLabel).toContain('Quarterfinal');
  });

  test('prelim pages still resolve as non-outround when heading says "Round N"', () => {
    const head = [
      { key: 'team', title: 'Team' },
      { key: 'adjudicators', title: 'Adjudicators' },
    ];
    const data = [[{ text: 'Alpha' }, { text: 'Jane Doe (c)' }]];
    const payload = JSON.stringify([{ head, data }]);
    const html = `
      <html><body><h1>Round 1</h1><script>window.vueData = ${payload}</script></body></html>
    `;
    const round = parseRoundResults(html, 'https://x.calicotab.com/t/results/round/1/');
    expect(round.isOutround).toBe(false);
    expect(round.roundLabel).toBe('Round 1');
  });
});

describe('parseRoundResults — round label resolution chain', () => {
  // Resolution order: navLabel (from landing-page nav) → page heading IF
  // it mentions a round → numeric "Round N" fallback.
  const dataPayload = JSON.stringify([
    {
      head: [
        { key: 'team', title: 'Team' },
        { key: 'adjudicators', title: 'Adjudicators' },
      ],
      data: [[{ text: 'Alpha' }, { text: 'Jane Doe (c)' }]],
    },
  ]);

  test('prefers the navLabel when supplied (the authoritative source)', () => {
    // Page heading is the tournament name (useless), but the nav called this
    // URL "Quarterfinals". Use the nav label.
    const html = `
      <html><body><h1>SIDO 2026</h1><script>window.vueData = ${dataPayload}</script></body></html>
    `;
    const round = parseRoundResults(
      html,
      'https://x.calicotab.com/t/results/round/7/',
      'Quarterfinals',
    );
    expect(round.roundLabel).toBe('Quarterfinals');
    expect(round.isOutround).toBe(true);
  });

  test('ignores a generic page heading that mentions no round', () => {
    // No navLabel; heading is just the tournament name. Should NOT be used
    // as the round label — falls through to the "Round N" numeric fallback.
    // Pre-fix this would have returned roundLabel="SIDO 2026" and made
    // every round of SIDO collapse to the same label, breaking
    // classifyRoundLabel.
    const html = `
      <html><body><h1>SIDO 2026</h1><script>window.vueData = ${dataPayload}</script></body></html>
    `;
    const round = parseRoundResults(html, 'https://x.calicotab.com/t/results/round/3/');
    expect(round.roundLabel).toBe('Round 3');
    expect(round.isOutround).toBe(false);
  });

  test('uses the page heading when it mentions a round name', () => {
    // No navLabel; heading says "Quarterfinals — SIDO 2026" — clearly
    // round-related, so use it.
    const html = `
      <html><body><h1>Quarterfinals — SIDO 2026</h1><script>window.vueData = ${dataPayload}</script></body></html>
    `;
    const round = parseRoundResults(html, 'https://x.calicotab.com/t/results/round/7/');
    expect(round.roundLabel).toContain('Quarterfinal');
    expect(round.isOutround).toBe(true);
  });

  test('navLabel "Grand Final" classifies as outround even without URL hints', () => {
    const html = `
      <html><body><h1>Generic Heading</h1><script>window.vueData = ${dataPayload}</script></body></html>
    `;
    const round = parseRoundResults(
      html,
      'https://x.calicotab.com/t/results/round/16/',
      'Grand Final',
    );
    expect(round.roundLabel).toBe('Grand Final');
    expect(round.isOutround).toBe(true);
  });

  test('parses BP tables that use OG/OO/CG/CO columns instead of a Team column', () => {
    const html = vueResultsHtml(
      [
        { key: 'venue', title: 'Venue' },
        { key: 'og', title: 'OG' },
        { key: 'oo', title: 'OO' },
        { key: 'cg', title: 'CG' },
        { key: 'co', title: 'CO' },
        { key: 'adjudicators', title: 'Adjudicators' },
      ],
      [
        [
          { text: 'Room 1' },
          { text: 'Team Alpha' },
          { text: 'Team Beta' },
          { text: 'Team Gamma' },
          { text: 'Team Delta' },
          { text: 'Jane Doe (chair), John Roe' },
        ],
      ],
    );
    const round = parseRoundResults(html, 'https://x.calicotab.com/t/results/round/2/');
    expect(round.teamResults).toHaveLength(4);
    expect(round.teamResults.map((r) => r.position)).toEqual(['OG', 'OO', 'CG', 'CO']);
    expect(round.teamResults.map((r) => r.teamName)).toEqual([
      'Team Alpha',
      'Team Beta',
      'Team Gamma',
      'Team Delta',
    ]);
    expect(round.judgeAssignments).toHaveLength(2);
  });
});

describe('parseRoundResults — judge extraction', () => {
  test('extracts chairs and panelists without double-counting across passes', () => {
    const html = `
      <table>
        <thead>
          <tr>
            <th>Team</th>
            <th>Position</th>
            <th>Points</th>
            <th>Adjudicators</th>
            <th>Role</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Alpha</td>
            <td>OG</td>
            <td>3</td>
            <td>Jane Doe (Chair), John Roe</td>
            <td>chair</td>
          </tr>
          <tr>
            <td>Beta</td>
            <td>OO</td>
            <td>2</td>
            <td>Jane Doe (Chair), John Roe</td>
            <td>chair</td>
          </tr>
        </tbody>
      </table>
    `;
    const round = parseRoundResults(html, 'https://h.calicotab.com/t/results/round/1/by-debate/');
    const names = round.judgeAssignments.map((j) => j.personName);
    expect(new Set(names).size).toBe(names.length); // no duplicates
    const chair = round.judgeAssignments.find((j) => j.personName === 'Jane Doe');
    expect(chair?.panelRole).toBe('chair');
    // teamResults come from both rows
    expect(round.teamResults).toHaveLength(2);
  });
});

describe('parseRoundResults — win column false-positive guards', () => {
  // The Monash Open 2023 bug: a BP-style points column ("3"/"2"/"1"/"0"
  // for 1st-4th place) was mis-recognised as a "result" column by the
  // header heuristic, and the win regex then matched `\b1\b` on the
  // 3rd-place team's "1", marking them as winners. With the regex
  // tightened to word-form signals only, numeric values can never
  // promote a row to "won".

  test('Vue path: numeric "1" in a result-shaped column does NOT mark as won', () => {
    const html = vueResultsHtml(
      [
        { key: 'team', title: 'Team' },
        { key: 'result', title: 'Result' }, // mis-named column
      ],
      [[{ text: 'Third Place' }, { text: '1' }]],
    );
    const round = parseRoundResults(html, 'https://x.calicotab.com/t/break/finals/');
    expect(round.teamResults[0]!.won).toBe(false);
  });

  test('Vue path: "won" / "win" cell text still marks as won', () => {
    const html = vueResultsHtml(
      [
        { key: 'team', title: 'Team' },
        { key: 'result', title: 'Result' },
      ],
      [
        [{ text: 'Champion' }, { text: 'won' }],
        [{ text: 'Runner-up' }, { text: 'lost' }],
      ],
    );
    const round = parseRoundResults(html, 'https://x.calicotab.com/t/break/finals/');
    const champ = round.teamResults.find((t) => t.teamName === 'Champion');
    const runner = round.teamResults.find((t) => t.teamName === 'Runner-up');
    expect(champ?.won).toBe(true);
    expect(runner?.won).toBe(false);
  });

  test('cheerio path: numeric "1" in a result column does NOT mark as won', () => {
    // Falls through to cheerio because there's no Vue data island.
    const html = `
      <table>
        <thead>
          <tr>
            <th>Team</th>
            <th>Result</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>Third Place</td><td>1</td></tr>
          <tr><td>Champion</td><td>won</td></tr>
        </tbody>
      </table>
    `;
    const round = parseRoundResults(html, 'https://x.calicotab.com/t/break/finals/');
    const third = round.teamResults.find((t) => t.teamName === 'Third Place');
    const champ = round.teamResults.find((t) => t.teamName === 'Champion');
    expect(third?.won).toBe(false);
    expect(champ?.won).toBe(true);
  });
});
