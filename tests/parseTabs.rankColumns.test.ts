import { describe, expect, test } from 'vitest';
import { parseSpeakerTab } from '@/lib/calicotab/parseTabs';

/**
 * The old resolver picked the first "rank"-containing column, which was ESL rank
 * when columns were ordered [ESL rank, rank, EFL rank]. These fixtures lock the
 * disambiguation: `speakerRankOpen` must pull from the plain "rank" column, not
 * from an ESL- or EFL-qualified one.
 */

describe('parseSpeakerTab — rank column disambiguation', () => {
  test('ESL rank column before the open rank column does not win', () => {
    const html = `
      <table>
        <thead>
          <tr>
            <th>ESL rank</th>
            <th>Rank</th>
            <th>EFL rank</th>
            <th>Name</th>
            <th>Team</th>
            <th>Total</th>
            <th>R1</th>
            <th>R2</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>11</td>
            <td>3</td>
            <td>22</td>
            <td>Ada L</td>
            <td>Alpha</td>
            <td>160</td>
            <td>80</td>
            <td>80</td>
          </tr>
        </tbody>
      </table>
    `;
    const rows = parseSpeakerTab(html);
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    expect(r.rank).toBe(3);
    expect(r.rankEsl).toBe(11);
    expect(r.rankEfl).toBe(22);
    expect(r.roundScores).toHaveLength(2);
    expect(r.roundScores.map((s) => s.score)).toEqual([80, 80]);
  });

  test('only ESL + EFL columns (no open rank) still pull scores cleanly', () => {
    const html = `
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Team</th>
            <th>Total</th>
            <th>ESL rank</th>
            <th>EFL rank</th>
            <th>R1</th>
            <th>R2</th>
            <th>R3</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Ada L</td>
            <td>Alpha</td>
            <td>240</td>
            <td>5</td>
            <td>10</td>
            <td>80</td>
            <td>81</td>
            <td>79</td>
          </tr>
        </tbody>
      </table>
    `;
    const rows = parseSpeakerTab(html);
    expect(rows[0]!.rank).toBeNull();
    expect(rows[0]!.rankEsl).toBe(5);
    expect(rows[0]!.rankEfl).toBe(10);
    expect(rows[0]!.roundScores).toHaveLength(3);
    expect(rows[0]!.roundScores.map((s) => s.score)).toEqual([80, 81, 79]);
  });

  test('AP-style bare-numeric round headers (1/2/3…) are picked up as per-round scores', () => {
    // Mirrors the speaker-tab variant some Tabbycat AP installs serve where
    // round columns are bare digits ("1", "2", "3") rather than "R1/R2/R3".
    // Without this the user's CV showed `prelims_spoken=0` and the speaker
    // average row was empty (NLSD/SRDF/CUPD pattern).
    const html = `
      <table>
        <thead>
          <tr>
            <th>Rank</th>
            <th>Name</th>
            <th>Team</th>
            <th>Total</th>
            <th>1</th>
            <th>2</th>
            <th>3</th>
            <th>4</th>
            <th>5</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>2</td>
            <td>Abhishek A</td>
            <td>NH 48</td>
            <td>378.5</td>
            <td>76</td>
            <td>75</td>
            <td>76</td>
            <td>75.5</td>
            <td>76</td>
          </tr>
        </tbody>
      </table>
    `;
    const rows = parseSpeakerTab(html);
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    expect(r.totalScore).toBe(378.5);
    expect(r.roundScores).toHaveLength(5);
    expect(r.roundScores.map((s) => s.score)).toEqual([76, 75, 76, 75.5, 76]);
  });

  test('Speech-N / Debate-N column headers count as per-round scores', () => {
    const html = `
      <table>
        <thead>
          <tr>
            <th>Rank</th>
            <th>Name</th>
            <th>Team</th>
            <th>Total</th>
            <th>Speech 1</th>
            <th>Speech 2</th>
            <th>Speech 3</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>1</td>
            <td>Sample S</td>
            <td>Alpha</td>
            <td>240</td>
            <td>80</td>
            <td>81</td>
            <td>79</td>
          </tr>
        </tbody>
      </table>
    `;
    const rows = parseSpeakerTab(html);
    expect(rows[0]!.roundScores.map((s) => s.score)).toEqual([80, 81, 79]);
  });

  test('average-only speaker tabs expose the average as a synthetic score', () => {
    const html = `
      <table>
        <thead>
          <tr>
            <th>Rank</th>
            <th>Name</th>
            <th>Team</th>
            <th>Average</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>4</td>
            <td>Priya Shah</td>
            <td>AP Team</td>
            <td>75.5</td>
          </tr>
        </tbody>
      </table>
    `;
    const rows = parseSpeakerTab(html);
    expect(rows[0]!.totalScore).toBeNull();
    expect(rows[0]!.roundScores).toEqual([
      { roundLabel: 'Average', score: 75.5, positionLabel: 'average' },
    ]);
  });
});
