import { describe, expect, test } from 'vitest';
import { parseSpeakerTab } from '@/lib/calicotab/parseTabs';

/**
 * Tabbycat 2.11 publishes a speaker's break-category membership in a
 * `category` column, comma-separated. It replaced the separate ESL/EFL RANK
 * columns, which is why rankEsl/rankEfl came back null for all 14371
 * speakers in a 625-tournament corpus: the ranks are not published any more.
 * 86 of 100 speaker tabs carry this column, and every one of them has values.
 *
 * Column keys and values below are taken verbatim from that corpus.
 */
function speakerTabPage(head: unknown[], rows: unknown[][]): string {
  const payload = { tablesData: [{ head, data: rows }] };
  return `<html><body><div id="vue"></div>
    <script>var x = ${JSON.stringify(payload)};</script>
  </body></html>`;
}

const HEAD = [
  { key: 'Rk', tooltip: 'Rank' },
  { key: 'name', tooltip: 'Name' },
  { key: 'category', title: 'Category' },
  { key: 'team', tooltip: 'Team' },
  { key: 'R1', title: 'R1' },
  { key: 'Total', title: 'Total' },
];
const row = (rank: string, name: string, category: string) => [
  { text: rank },
  { text: name },
  { text: category },
  { text: 'Some Team' },
  { text: '75' },
  { text: '75' },
];

describe('speaker tab — break categories', () => {
  test('reads a single category', () => {
    const rows = parseSpeakerTab(speakerTabPage(HEAD, [row('1', 'Ada Novice', 'Novice')]));
    expect(rows[0]!.categories).toEqual(['Novice']);
  });

  test('splits a comma-separated list', () => {
    // "Open, Novice" and "ESL, EFL" are the second and third most common
    // values in the corpus.
    const rows = parseSpeakerTab(
      speakerTabPage(HEAD, [
        row('1', 'Bo Both', 'Open, Novice'),
        row('2', 'Cy Two', 'ESL, EFL'),
      ]),
    );
    expect(rows[0]!.categories).toEqual(['Open', 'Novice']);
    expect(rows[1]!.categories).toEqual(['ESL', 'EFL']);
  });

  test('keeps multi-word and non-English category names intact', () => {
    const rows = parseSpeakerTab(
      speakerTabPage(HEAD, [
        row('1', 'Hi Schooler', 'High School'),
        row('2', 'Ina Nueva', 'Personas Novatas'),
        row('3', 'Efe Long', 'English as a Foreign Language'),
      ]),
    );
    expect(rows[0]!.categories).toEqual(['High School']);
    expect(rows[1]!.categories).toEqual(['Personas Novatas']);
    expect(rows[2]!.categories).toEqual(['English as a Foreign Language']);
  });

  test('an empty cell means no declared category', () => {
    const rows = parseSpeakerTab(speakerTabPage(HEAD, [row('1', 'Opal Default', '')]));
    expect(rows[0]!.categories).toEqual([]);
  });

  test('a tab with no category column yields no categories', () => {
    const headNoCat = HEAD.filter((h) => h.key !== 'category');
    const rows = parseSpeakerTab(
      speakerTabPage(headNoCat, [
        [{ text: '1' }, { text: 'Una Categorised' }, { text: 'Some Team' }, { text: '75' }, { text: '75' }],
      ]),
    );
    expect(rows[0]!.categories).toEqual([]);
  });

  test('the plural "categories" key is read too', () => {
    // Team tabs use the plural; 72 pages in the corpus.
    const headPlural = HEAD.map((h) => (h.key === 'category' ? { key: 'categories', title: 'Categories' } : h));
    const rows = parseSpeakerTab(speakerTabPage(headPlural, [row('1', 'Plu Ral', 'Novice')]));
    expect(rows[0]!.categories).toEqual(['Novice']);
  });

  test('does not disturb the columns beside it', () => {
    const rows = parseSpeakerTab(speakerTabPage(HEAD, [row('3', 'Ada Novice', 'Novice')]));
    expect(rows[0]!.rank).toBe(3);
    expect(rows[0]!.speakerName).toBe('Ada Novice');
    expect(rows[0]!.teamName).toBe('Some Team');
    expect(rows[0]!.totalScore).toBe(75);
  });
});
