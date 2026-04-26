import { describe, expect, test } from 'vitest';
import { parseRoundResults, parseParticipantsList } from '@/lib/calicotab/parseTabs';

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

describe('parseParticipantsList — judgeTag', () => {
  test('recognizes British spelling "subsidised"', () => {
    const html = `
      <table>
        <thead><tr><th>Name</th><th>Role</th></tr></thead>
        <tbody><tr><td>Ada L</td><td>Subsidised Adjudicator</td></tr></tbody>
      </table>
    `;
    const rows = parseParticipantsList(html);
    expect(rows[0]!.judgeTag).toBe('subsidized');
    expect(rows[0]!.role).toBe('adjudicator');
  });

  test('recognizes "Independent Adjudicator" as invited', () => {
    const html = `
      <table>
        <thead><tr><th>Name</th><th>Role</th></tr></thead>
        <tbody><tr><td>Ada L</td><td>Independent Adjudicator</td></tr></tbody>
      </table>
    `;
    const rows = parseParticipantsList(html);
    expect(rows[0]!.judgeTag).toBe('invited');
  });

  test('plain "Adjudicator" label gives judgeTag=normal', () => {
    const html = `
      <table>
        <thead><tr><th>Name</th><th>Role</th></tr></thead>
        <tbody><tr><td>Ada L</td><td>Adjudicator</td></tr></tbody>
      </table>
    `;
    const rows = parseParticipantsList(html);
    expect(rows[0]!.judgeTag).toBe('normal');
  });
});
