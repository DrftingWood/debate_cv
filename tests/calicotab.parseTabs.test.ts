import { describe, expect, test } from 'vitest';
import {
  parseTeamTab,
  parseSpeakerTab,
  parseRoundResults,
  parseBreakPage,
  parseParticipantsList,
} from '@/lib/calicotab/parseTabs';

/**
 * Fixtures modelled on Tabbycat's default tab templates.
 * The goal of these tests is to lock current parser behavior against
 * regressions in the header-matching / column-index logic, and to
 * document what markup variations are supported.
 */

describe('parseTeamTab', () => {
  test('extracts rank, team, institution, wins, points', () => {
    const html = `
      <table>
        <thead>
          <tr>
            <th>Rank</th>
            <th>Team</th>
            <th>Institution</th>
            <th>Speakers</th>
            <th>Wins</th>
            <th>Total points</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>1</td>
            <td>Viral Adidas</td>
            <td>IGNOU</td>
            <td>Abhishek Acharya, Shishir Jha</td>
            <td>6</td>
            <td>1,824</td>
          </tr>
          <tr>
            <td>2</td>
            <td>Alpha</td>
            <td>DU</td>
            <td>A, B</td>
            <td>5</td>
            <td>1811.5</td>
          </tr>
        </tbody>
      </table>
    `;
    const rows = parseTeamTab(html);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      rank: 1,
      teamName: 'Viral Adidas',
      institution: 'IGNOU',
      speakers: ['Abhishek Acharya', 'Shishir Jha'],
      wins: 6,
      totalPoints: 1824,
    });
    expect(rows[1]!.totalPoints).toBe(1811.5);
  });

  test('handles missing optional columns', () => {
    const html = `
      <table>
        <thead><tr><th>Team</th><th>Wins</th></tr></thead>
        <tbody><tr><td>Solo</td><td>3</td></tr></tbody>
      </table>
    `;
    const rows = parseTeamTab(html);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.teamName).toBe('Solo');
    expect(rows[0]!.wins).toBe(3);
    expect(rows[0]!.rank).toBeNull();
    expect(rows[0]!.speakers).toEqual([]);
  });
});

describe('parseSpeakerTab', () => {
  test('extracts name, team, per-round scores', () => {
    const html = `
      <table>
        <thead>
          <tr>
            <th>Rank</th>
            <th>Name</th>
            <th>Team</th>
            <th>Institution</th>
            <th>Total</th>
            <th>Round 1</th>
            <th>Round 2</th>
            <th>Round 3</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>1</td>
            <td>Abhishek Acharya</td>
            <td>Viral Adidas</td>
            <td>IGNOU</td>
            <td>228</td>
            <td>76</td>
            <td>75</td>
            <td>77</td>
          </tr>
        </tbody>
      </table>
    `;
    const rows = parseSpeakerTab(html);
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    expect(r.speakerName).toBe('Abhishek Acharya');
    expect(r.teamName).toBe('Viral Adidas');
    expect(r.institution).toBe('IGNOU');
    expect(r.totalScore).toBe(228);
    expect(r.roundScores).toHaveLength(3);
    expect(r.roundScores[0]!.score).toBe(76);
    expect(r.roundScores[2]!.roundLabel).toBe('Round 3');
  });
});

describe('parseRoundResults', () => {
  test('derives round number from URL + parses per-team rows', () => {
    const html = `
      <table>
        <thead>
          <tr>
            <th>Team</th>
            <th>Position</th>
            <th>Points</th>
            <th>Win</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>Viral Adidas</td><td>OG</td><td>3</td><td>Won</td></tr>
          <tr><td>Alpha</td><td>OO</td><td>2</td><td></td></tr>
        </tbody>
      </table>
    `;
    const round = parseRoundResults(
      html,
      'https://example.calicotab.com/t/results/round/4/',
    );
    expect(round.roundNumber).toBe(4);
    expect(round.teamResults).toHaveLength(2);
    expect(round.teamResults[0]!.teamName).toBe('Viral Adidas');
    expect(round.teamResults[0]!.won).toBe(true);
    expect(round.teamResults[1]!.won).toBe(false);
  });
});

describe('parseBreakPage', () => {
  test('parses the teams/open break', () => {
    const html = `
      <table>
        <thead><tr><th>Rank</th><th>Team</th><th>Institution</th><th>Score</th></tr></thead>
        <tbody>
          <tr><td>1</td><td>Alpha</td><td>DU</td><td>18</td></tr>
          <tr><td>2</td><td>Viral Adidas</td><td>IGNOU</td><td>17</td></tr>
        </tbody>
      </table>
    `;
    const rows = parseBreakPage(html, 'https://h.calicotab.com/t/break/teams/open/');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.entityType).toBe('team');
    expect(rows[0]!.rank).toBe(1);
    expect(rows[0]!.entityName).toBe('Alpha');
    expect(rows[0]!.stage).toBe('teams/open');
  });

  test('parses the adjudicators break', () => {
    const html = `
      <table>
        <thead><tr><th>#</th><th>Adjudicator</th><th>Institution</th><th>Score</th></tr></thead>
        <tbody>
          <tr><td>1</td><td>Judge Foo</td><td>IGNOU</td><td>4.5</td></tr>
        </tbody>
      </table>
    `;
    const rows = parseBreakPage(html, 'https://h.calicotab.com/t/break/adjudicators/');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.entityType).toBe('adjudicator');
    expect(rows[0]!.entityName).toBe('Judge Foo');
    expect(rows[0]!.stage).toBe('adjudicators');
  });
});

describe('parseParticipantsList', () => {
  test('classifies speakers and adjudicators from a participants table', () => {
    const html = `
      <table>
        <thead>
          <tr><th>Name</th><th>Role</th><th>Team</th><th>Institution</th></tr>
        </thead>
        <tbody>
          <tr><td>Abhishek Acharya</td><td>Debater</td><td>Viral Adidas</td><td>IGNOU</td></tr>
          <tr><td>Shishir Jha</td><td>Speaker</td><td>Viral Adidas</td><td>IGNOU</td></tr>
          <tr><td>Judge Foo</td><td>Adjudicator</td><td></td><td>IGNOU</td></tr>
          <tr><td>Org Bar</td><td>Organizer</td><td></td><td>IGNOU</td></tr>
        </tbody>
      </table>
    `;
    const rows = parseParticipantsList(html);
    expect(rows).toHaveLength(4);
    expect(rows[0]!.role).toBe('speaker');
    expect(rows[1]!.role).toBe('speaker');
    expect(rows[2]!.role).toBe('adjudicator');
    expect(rows[3]!.role).toBe('other');
    expect(rows[0]!.teamName).toBe('Viral Adidas');
  });
});
