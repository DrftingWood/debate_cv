import { describe, expect, test } from 'vitest';
import { __cellTest__ } from '@/lib/calicotab/parseTabs';

const { decodeHtmlEntities, isRoundColumnHeader } = __cellTest__;

describe('decodeHtmlEntities', () => {
  // Tabbycat embeds its table data as a JS/JSON payload inside the HTML
  // document, so the text inside it is HTML-escaped. The Vue extraction path
  // reads those strings verbatim, which put "M&amp;Ms" in the database and
  // rendered it literally on the CV. 623 cells in a 102-tournament corpus.
  test('decodes the entities Tabbycat actually emits', () => {
    expect(decodeHtmlEntities('M&amp;Ms')).toBe('M&Ms');
    expect(decodeHtmlEntities('Kapoor &amp; Attyani')).toBe('Kapoor & Attyani');
    expect(decodeHtmlEntities('&quot;Oye papaji&quot;')).toBe('"Oye papaji"');
    expect(decodeHtmlEntities('A &lt; B &gt; C')).toBe('A < B > C');
    expect(decodeHtmlEntities('O&#39;Brien')).toBe("O'Brien");
    expect(decodeHtmlEntities('O&apos;Brien')).toBe("O'Brien");
  });

  test('decodes numeric references', () => {
    expect(decodeHtmlEntities('caf&#233;')).toBe('café');
    expect(decodeHtmlEntities('caf&#xe9;')).toBe('café');
  });

  test('decodes exactly one level, so escaped text survives intact', () => {
    // A team literally named "A&amp;B" arrives double-escaped; one pass is
    // the correct amount.
    expect(decodeHtmlEntities('A&amp;amp;B')).toBe('A&amp;B');
  });

  test('leaves ordinary text alone', () => {
    expect(decodeHtmlEntities('Plain Team Name')).toBe('Plain Team Name');
    expect(decodeHtmlEntities('')).toBe('');
    expect(decodeHtmlEntities('100% & rising')).toBe('100% & rising');
  });
});

describe('isRoundColumnHeader', () => {
  test('accepts the stock round columns', () => {
    expect(isRoundColumnHeader('R1', 'R1')).toBe(true);
    expect(isRoundColumnHeader('Round 3', 'round3')).toBe(true);
    expect(isRoundColumnHeader('Grand Final', 'gf')).toBe(true);
    expect(isRoundColumnHeader('Semifinals', 'sf')).toBe(true);
  });

  test('accepts split rounds', () => {
    // A tournament that runs round 1 in two halves labels the columns R1A
    // and R1B. Neither the \\br\\s*\\d+\\b nor the ^r\\d+$ rule matched them,
    // so both columns were dropped: one ANU speaker's tab showed a total of
    // 420 while the scores the parser kept summed to 337.
    expect(isRoundColumnHeader('R1A', 'R1A')).toBe(true);
    expect(isRoundColumnHeader('R1B', 'R1B')).toBe(true);
    expect(isRoundColumnHeader('R1a', 'R1a')).toBe(true);
    expect(isRoundColumnHeader('R10B', 'R10B')).toBe(true);
  });

  test('still rejects the non-round columns it sits next to', () => {
    // These share the table with the round columns; matching one of them
    // would fold a rank or an average into the round scores.
    expect(isRoundColumnHeader('Rk', 'Rk')).toBe(false);
    expect(isRoundColumnHeader('Avg', 'Avg')).toBe(false);
    expect(isRoundColumnHeader('Total', 'Total')).toBe(false);
    expect(isRoundColumnHeader('Stdev', 'Stdev')).toBe(false);
    expect(isRoundColumnHeader('Num', 'Num')).toBe(false);
    expect(isRoundColumnHeader('Team', 'team')).toBe(false);
    expect(isRoundColumnHeader('Category', 'category')).toBe(false);
  });
});
