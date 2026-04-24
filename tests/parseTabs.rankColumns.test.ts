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
});
