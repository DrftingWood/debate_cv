import { describe, expect, test } from 'vitest';
import { parseBreakPage, parseSpeakerTab, parseTeamTab } from '@/lib/calicotab/parseTabs';

/**
 * Tabbycat marks a shared place with a trailing "=". Cell shape verbatim
 * from https://15thiitbombaydebate.calicotab.com/15thiitbombaydebate2023/tab/speaker/:
 *
 *   {"text": "1=", "sort": 1}, {"text": "1=", "sort": 1}, {"text": "3", "sort": 3}
 *
 * The number parser rejected "1=", so every tied row was stored unranked —
 * 9896 of 14371 speakers in the corpus.
 */
function vuePage(head: unknown[], rows: unknown[][]): string {
  const payload = { tablesData: [{ head, data: rows }] };
  return `<html><body><div id="vue"></div>
    <script>var x = ${JSON.stringify(payload)};</script>
  </body></html>`;
}

const rk = (text: string) => ({ text, sort: Number.parseInt(text, 10) });

describe('tied ranks', () => {
  test('speaker tab: "1=" is first, shared', () => {
    const head = [{ key: 'Rk' }, { key: 'name' }, { key: 'team' }, { key: 'R1' }, { key: 'Total' }];
    const rows = parseSpeakerTab(
      vuePage(head, [
        [rk('1='), { text: 'Ann Lee' }, { text: 'A' }, { text: '80' }, { text: '80' }],
        [rk('1='), { text: 'Bo Ng' }, { text: 'B' }, { text: '80' }, { text: '80' }],
        [rk('3'), { text: 'Cy Ray' }, { text: 'C' }, { text: '79' }, { text: '79' }],
      ]),
    );
    expect(rows.map((r) => r.rank)).toEqual([1, 1, 3]);
  });

  test('team tab: a tied place keeps its number', () => {
    const head = [{ key: 'Rk' }, { key: 'team' }, { key: 'Pts' }];
    const rows = parseTeamTab(
      vuePage(head, [
        [rk('4='), { text: 'Tokyo 1' }, { text: '18' }],
        [rk('4='), { text: 'NUS 1' }, { text: '18' }],
      ]),
    );
    expect(rows.map((r) => r.rank)).toEqual([4, 4]);
  });

  test('break page: a tied place keeps its number', () => {
    const html = `<html><body><table>
      <thead><tr><th>Rank</th><th>Team</th><th>Score</th></tr></thead>
      <tbody><tr><td>7=</td><td>MIT A</td><td>15</td></tr></tbody>
    </table></body></html>`;
    const rows = parseBreakPage(html, 'https://x.calicotab.com/foo/break/teams/open/');
    expect(rows[0]!.rank).toBe(7);
  });

  test('a cell that is not a place is still no rank', () => {
    const head = [{ key: 'Rk' }, { key: 'team' }];
    const rows = parseTeamTab(
      vuePage(head, [
        [{ text: '=' }, { text: 'T1' }],
        [{ text: 'n/a' }, { text: 'T2' }],
      ]),
    );
    expect(rows.map((r) => r.rank)).toEqual([null, null]);
  });
});
