import { describe, expect, test } from 'vitest';
import { parseTeamTab } from '@/lib/calicotab/parseTabs';

/**
 * Column keys and cell shapes verbatim from
 * https://01-rean.calicotab.com/ko-23/tab/team/.
 *
 * `1sts` / `2nds` are BP's standard tiebreaker — how many rooms the team
 * topped — and appear on 82 of 100 team tabs in the corpus. The roster
 * lives in the team cell's popover, on 100 of 100. Neither was read.
 */
function teamTabPage(head: unknown[], rows: unknown[][]): string {
  const payload = { tablesData: [{ head, data: rows }] };
  return `<html><body><div id="vue"></div>
    <script>var x = ${JSON.stringify(payload)};</script>
  </body></html>`;
}

const HEAD = [
  { key: 'Rk' },
  { key: 'team' },
  { key: 'Pts' },
  { key: 'Spk' },
  { key: '1sts' },
  { key: '2nds' },
];

const teamCell = (name: string, speakers: string | null) => ({
  text: name,
  emoji: '🐯',
  sort: name,
  class: 'team-name no-wrap',
  popover: {
    title: name,
    content: [
      ...(speakers ? [{ text: speakers }] : []),
      { text: `View ${name}'s Record`, link: '/t/participants/team/1/' },
    ],
  },
});

const row = (rk: string, name: string, speakers: string | null, pts: string, firsts: string, seconds: string) => [
  { text: rk, sort: Number(rk) },
  teamCell(name, speakers),
  { text: pts, sort: Number(pts) },
  { text: '791', sort: 791 },
  { text: firsts, sort: Number(firsts) },
  { text: seconds, sort: Number(seconds) },
];

describe('team tab — firsts and seconds', () => {
  test('reads both columns', () => {
    const rows = parseTeamTab(
      teamTabPage(HEAD, [row('1', 'Cat Woman', 'Michael Kwak, Roman Num', '13', '3', '2')]),
    );
    expect(rows[0]!.firsts).toBe(3);
    expect(rows[0]!.seconds).toBe(2);
  });

  test('they reconcile with the points total', () => {
    // BP scores 3/2/1/0, so firsts*3 + seconds*2 can never exceed the total.
    const rows = parseTeamTab(
      teamTabPage(HEAD, [row('1', 'Cat Woman', 'A, B', '13', '3', '2')]),
    );
    const r = rows[0]!;
    expect(r.firsts! * 3 + r.seconds! * 2).toBeLessThanOrEqual(Number(r.totalPoints));
  });

  test('null when the tab does not publish them', () => {
    // Two-team formats have a wins column instead.
    const head = [{ key: 'Rk' }, { key: 'team' }, { key: 'wins' }];
    const rows = parseTeamTab(
      teamTabPage(head, [[{ text: '1' }, teamCell('Solo', 'A, B'), { text: '4' }]]),
    );
    expect(rows[0]!.firsts).toBe(null);
    expect(rows[0]!.seconds).toBe(null);
    expect(rows[0]!.wins).toBe(4);
  });

  test('does not mistake a round column for them', () => {
    const head = [{ key: 'Rk' }, { key: 'team' }, { key: 'R1' }, { key: '1sts' }];
    const rows = parseTeamTab(
      teamTabPage(head, [[{ text: '1' }, teamCell('T', 'A, B'), { text: '3' }, { text: '2' }]]),
    );
    expect(rows[0]!.firsts).toBe(2);
  });
});

describe('team tab — the roster in the popover', () => {
  test('reads the speakers', () => {
    const rows = parseTeamTab(
      teamTabPage(HEAD, [row('1', 'Cat Woman', 'Michael Kwak, Roman Num', '13', '3', '2')]),
    );
    expect(rows[0]!.speakers).toEqual(['Michael Kwak', 'Roman Num']);
  });

  test('ignores the "View Record" link entry', () => {
    const rows = parseTeamTab(
      teamTabPage(HEAD, [row('1', 'Cat Woman', 'Michael Kwak, Roman Num', '13', '3', '2')]),
    );
    expect(rows[0]!.speakers.join(' ')).not.toMatch(/View|Record/);
  });

  test('empty when the cell carries no roster', () => {
    const rows = parseTeamTab(teamTabPage(HEAD, [row('1', 'Cat Woman', null, '13', '3', '2')]));
    expect(rows[0]!.speakers).toEqual([]);
  });

  test('a three-speaker team comes through whole', () => {
    // The one consumer infers the format from team size, so the count matters.
    const rows = parseTeamTab(
      teamTabPage(HEAD, [row('1', 'Trio', 'Ann Lee, Bo Ng, Cy Ray', '13', '3', '2')]),
    );
    expect(rows[0]!.speakers).toEqual(['Ann Lee', 'Bo Ng', 'Cy Ray']);
  });

  test('the team name itself is unaffected', () => {
    const rows = parseTeamTab(
      teamTabPage(HEAD, [row('1', 'Cat Woman', 'Michael Kwak, Roman Num', '13', '3', '2')]),
    );
    expect(rows[0]!.teamName).toBe('Cat Woman');
    expect(rows[0]!.rank).toBe(1);
  });
});
