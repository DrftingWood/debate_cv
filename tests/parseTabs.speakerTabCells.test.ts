import { describe, expect, test } from 'vitest';
import { parseRoundResults, parseSpeakerTab } from '@/lib/calicotab/parseTabs';

function vuePage(head: unknown[], rows: unknown[][]): string {
  const payload = { tablesData: [{ head, data: rows }] };
  return `<html><body><div id="vue"></div>
    <script>var x = ${JSON.stringify(payload)};</script>
  </body></html>`;
}

// Column keys verbatim from https://australs2022.calicotab.com/australs2022/tab/speaker/
// — no Total column, and decimals in their own <small> element.
const HEAD = [
  { key: 'Rk' },
  { key: 'name' },
  { key: 'category', title: 'Category' },
  { key: 'team' },
  { key: 'R1', title: 'R1' },
  { key: 'R2', title: 'R2' },
  { key: 'R3', title: 'R3' },
  { key: 'Avg', title: 'Avg' },
  { key: 'Stdev', title: 'Stdev' },
  { key: 'Num', title: 'Num' },
];
const small = (whole: string, frac: string) => ({ text: `${whole}<small class="text-muted">.${frac}</small>` });

describe('speaker tab cells', () => {
  const [row] = parseSpeakerTab(
    vuePage(HEAD, [[
      { text: '1=', sort: 1 },
      { text: 'David Africa' },
      { text: 'novice, esl' },
      { text: '—' },
      small('77', '50'),
      small('78', '00'),
      { text: '' },
      small('77', '75'),
      { text: '0.25' },
      { text: '2' },
    ]]),
  );

  test('a score with its decimals in a <small> is read', () => {
    // Every score on twelve corpus tabs was stored empty.
    expect(row!.roundScores.map((s) => s.score)).toEqual([77.5, 78, null]);
  });

  test('with no Total column, the total is the sum of the scored speeches', () => {
    expect(row!.totalScore).toBe(155.5);
  });

  test('categories are cased as the lexicon cases them', () => {
    expect(row!.categories).toEqual(['Novice', 'ESL']);
  });

  test('a dash is no team, not a team called "—"', () => {
    expect(row!.teamName).toBe(null);
  });

  test('a published total still wins over the sum', () => {
    const head = [{ key: 'Rk' }, { key: 'name' }, { key: 'R1' }, { key: 'Total' }];
    const [r] = parseSpeakerTab(vuePage(head, [[{ text: '1' }, { text: 'A B' }, { text: '75' }, { text: '150' }]]));
    expect(r!.totalScore).toBe(150);
  });

  test('a speaker with no scored speech has no total', () => {
    const head = [{ key: 'Rk' }, { key: 'name' }, { key: 'R1' }];
    const [r] = parseSpeakerTab(vuePage(head, [[{ text: '9' }, { text: 'A B' }, { text: '' }]]));
    expect(r!.totalScore).toBe(null);
  });
});

describe('two-team result cells', () => {
  // Verbatim shape from 2ndaristotlecup round 1: the text is " vs <opponent>",
  // the outcome lives only in the popover title.
  const HEAD_RR = [{ key: 'team' }, { key: 'result' }, { key: 'side' }];
  const cell = (opponent: string, title: string, up: boolean) => ({
    text: ` vs ${opponent}`,
    popover: { title, content: [] },
    icon: up ? 'chevron-up' : 'chevron-down',
    sort: up ? 2 : 1,
  });

  test('the popover title is the outcome', () => {
    const round = parseRoundResults(
      vuePage(HEAD_RR, [
        [{ text: 'Honorable Conquerors' }, cell('Jesus you are v emo', 'Won against Jesus you are v emo', true), { text: 'Government' }],
        [{ text: 'Jesus you are v emo' }, cell('Honorable Conquerors', 'Lost to Honorable Conquerors', false), { text: 'Opposition' }],
      ]),
      'https://x.calicotab.com/t/results/round/1/',
      'Round 1',
    );
    expect(round.teamResults.map((t) => t.won)).toEqual([true, false]);
  });

  test("the opponent's name is never read as the outcome", () => {
    const round = parseRoundResults(
      vuePage(HEAD_RR, [
        [{ text: 'Alpha' }, cell('Lost Boys', 'Won against Lost Boys', true), { text: 'Affirmative' }],
        [{ text: 'Beta' }, cell('Winners United', 'Lost to Winners United', false), { text: 'Negative' }],
      ]),
      'https://x.calicotab.com/t/results/round/1/',
      'Round 1',
    );
    expect(round.teamResults.map((t) => t.won)).toEqual([true, false]);
  });
});
