import { describe, expect, test } from 'vitest';
import { parseParticipantsList } from '@/lib/calicotab/parseTabs';

/**
 * Builds a page carrying a native Tabbycat Vue payload. The participants
 * list of Tabbycat 2.11 has columns ["name", "adjcore", "independent"] and
 * marks each flag with `{"icon": "check", "sort": 1}` — an `icon` FIELD, not
 * a class and not text. VueCell did not model `icon` at all, so every
 * adjudicator in a 99-page corpus came back judgeTag 'normal'.
 */
function vuePage(rows: unknown[][]): string {
  const payload = {
    tablesData: [
      {
        // `rating` is what marks this as the adjudicators table rather than
        // the speakers one; the flags are the two columns after the name.
        head: [{ key: 'name' }, { key: 'adjcore' }, { key: 'independent' }, { key: 'rating' }],
        data: rows,
      },
    ],
  };
  return `<html><body><div id="vue"></div>
    <script>var x = ${JSON.stringify(payload)};</script>
  </body></html>`;
}

const NAME = (t: string) => ({ text: t });
const RATING = { text: '4.5' };
const CHECK = { icon: 'check', sort: 1 };
const BLANK = { icon: '', sort: 2 };

describe('participants list — adjudicator flags', () => {
  test('an adj-core check becomes judgeTag "core"', () => {
    // A CA / DCA / tab director shapes the tournament rather than just
    // judging it, and the CV shows it as a credential.
    const rows = parseParticipantsList(vuePage([[NAME('Ada Chief'), CHECK, BLANK, RATING]]));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.role).toBe('adjudicator');
    expect(rows[0]!.judgeTag).toBe('core');
  });

  test('an independent check becomes judgeTag "invited"', () => {
    const rows = parseParticipantsList(vuePage([[NAME('Ivo Independent'), BLANK, CHECK, RATING]]));
    expect(rows[0]!.judgeTag).toBe('invited');
  });

  test('no check at all is an ordinary institutional adjudicator', () => {
    const rows = parseParticipantsList(vuePage([[NAME('Nina Normal'), BLANK, BLANK, RATING]]));
    expect(rows[0]!.judgeTag).toBe('normal');
  });

  test('core outranks independent when both are set', () => {
    // Being on the adjudication core is the more notable credential.
    const rows = parseParticipantsList(vuePage([[NAME('Cora Both'), CHECK, CHECK, RATING]]));
    expect(rows[0]!.judgeTag).toBe('core');
  });

  test('a whole panel is classified row by row', () => {
    const rows = parseParticipantsList(
      vuePage([
        [NAME('Ada Chief'), CHECK, BLANK, RATING],
        [NAME('Ivo Independent'), BLANK, CHECK, RATING],
        [NAME('Nina Normal'), BLANK, BLANK, RATING],
      ]),
    );
    expect(rows.map((r) => [r.name, r.judgeTag])).toEqual([
      ['Ada Chief', 'core'],
      ['Ivo Independent', 'invited'],
      ['Nina Normal', 'normal'],
    ]);
  });
});
