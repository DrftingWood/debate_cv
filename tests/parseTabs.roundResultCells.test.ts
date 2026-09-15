import { describe, expect, test } from 'vitest';
import { __cellTest__ } from '@/lib/calicotab/parseTabs';

const { parseAdjudicatorCell, isMarkupAdjudicatorCell, parseBpPlacing, readTeamOutcome } =
  __cellTest__;

// Verbatim from https://15thiitbombaydebate.calicotab.com/.../results/round/10/
// — Tabbycat renders the adjudicator cell as markup, with the chair marked
// by an adj-symbol and the comma separators living INSIDE their own spans.
const REAL_ADJ_CELL =
  '<span class="d-inline">Shuvam Mitra<i class=\'adj-symbol\'>Ⓒ</i></span>' +
  '<div class=\'clearfix pt-1 pb-1 d-block d-md-none\'> </div>' +
  '<span class=\'d-none d-md-inline\'>, </span>' +
  '<span class="d-inline">Anushikha Pokhriyal</span>' +
  '<div class=\'clearfix pt-1 pb-1 d-block d-md-none\'> </div>' +
  '<span class=\'d-none d-md-inline\'>, </span>' +
  '<span class="d-inline">Chinmaya Mohan</span>';

describe('parseAdjudicatorCell', () => {
  test('reads the names out of the markup', () => {
    // Splitting the raw string on commas cut through the tags and stored
    // fragments like `</span><span class="d-inline">Anushikha Pokhriyal</span>…`
    // as the person's NAME. Every one of the 8031 judge rows in a
    // 101-tournament corpus was markup.
    const got = parseAdjudicatorCell(REAL_ADJ_CELL);
    expect(got.map((a) => a.name)).toEqual([
      'Shuvam Mitra',
      'Anushikha Pokhriyal',
      'Chinmaya Mohan',
    ]);
  });

  test('reads the chair off the adj-symbol', () => {
    // Same cell carries the role the parser was reporting as null
    // everywhere: the chair is the one with the symbol.
    const got = parseAdjudicatorCell(REAL_ADJ_CELL);
    expect(got[0]).toEqual({ name: 'Shuvam Mitra', role: 'chair' });
    expect(got[1]!.role).toBe('panel');
    expect(got[2]!.role).toBe('panel');
  });

  test('a trainee symbol is a trainee, not a chair', () => {
    // Verbatim from cmudemadrid2020 round 1. Ⓣ rides in the same
    // <i class="adj-symbol"> as Ⓒ, and "has a symbol" was the chair test, so
    // this room reported three chairs. The popover confirms the roles:
    // "(chair, CIDEUP)", "(panellist)", "(trainee, SDCH)", "(trainee, UIS)".
    const got = parseAdjudicatorCell(
      '<span class="d-inline">Jorge Jean Pierre Bullon Sirumball<i class=\'adj-symbol\'>Ⓒ</i></span>' +
        '<span class=\'d-none d-md-inline\'>, </span>' +
        '<span class="d-inline">Samuel Moreiro</span>' +
        '<span class=\'d-none d-md-inline\'>, </span>' +
        '<span class="d-inline">César Arturo Tapia Parra<i class=\'adj-symbol\'>Ⓣ</i></span>' +
        '<span class=\'d-none d-md-inline\'>, </span>' +
        '<span class="d-inline">Daniel Mauricio Pallares Ropero<i class=\'adj-symbol\'>Ⓣ</i></span>',
    );
    expect(got.map((a) => a.role)).toEqual(['chair', 'panel', 'trainee', 'trainee']);
    expect(got[2]!.name).toBe('César Arturo Tapia Parra');
  });

  test('drops a hybrid event\'s attendance tag from the name', () => {
    // anu spring21 marks online / in-person attendance as "[o]" / "[i]" on
    // judges and teams, but not on its speaker tab — kept, the tag split one
    // person or team into two spellings.
    const got = parseAdjudicatorCell(
      '<span class="d-inline">[o] Vladimira Suflaj<i class=\'adj-symbol\'>Ⓒ</i></span>' +
        '<span class=\'d-none d-md-inline\'>, </span>' +
        '<span class="d-inline">[i] Kethmi Gamage</span>',
    );
    expect(got.map((a) => a.name)).toEqual(['Vladimira Suflaj', 'Kethmi Gamage']);
    expect(got[0]!.role).toBe('chair');
  });

  test('strips the annotations Tabbycat hangs off the name', () => {
    // Verbatim from 45mpdc round 1. Alongside the chair symbol there is a
    // NESTED span carrying a conflict marker; the name is the span's direct
    // text and everything else is an annotation. 153 of 8024 judge rows in
    // the corpus carried an emoji into the stored name, which is enough to
    // stop the same person matching their participants-list entry.
    const got = parseAdjudicatorCell(
      '<span class="d-inline">Ray John Li Mantigue<i class=\'adj-symbol\'>Ⓒ</i> ' +
        '<span class=\'text-danger\'>💢</span></span>' +
        '<span class=\'d-none d-md-inline\'>, </span>' +
        '<span class="d-inline">Ronald Idan</span>',
    );
    expect(got.map((a) => a.name)).toEqual(['Ray John Li Mantigue', 'Ronald Idan']);
    expect(got[0]!.role).toBe('chair');
  });

  test('keeps accented characters, which are part of real names', () => {
    const got = parseAdjudicatorCell(
      '<span class="d-inline">Esmé Nelson</span>' +
        '<span class=\'d-none d-md-inline\'>, </span>' +
        '<span class="d-inline">Gabrielle Pacaño</span>',
    );
    expect(got.map((a) => a.name)).toEqual(['Esmé Nelson', 'Gabrielle Pacaño']);
  });

  test('plain text is left to the existing comma handling', () => {
    expect(parseAdjudicatorCell('Alice Smith, Bob Jones')).toEqual([]);
    expect(parseAdjudicatorCell('')).toEqual([]);
  });

  test('says so when a markup cell yields nobody', () => {
    // A panel whose every adjudicator opted out has a real name for none of
    // them. The caller must be able to tell that apart from "this is plain
    // text, use the comma path" — otherwise it falls back and stores the
    // markup itself as a person's name, which is what happened to a
    // redacted panel in the corpus.
    expect(isMarkupAdjudicatorCell('<span class="d-inline"><em>Redacted</em></span>')).toBe(true);
    expect(isMarkupAdjudicatorCell('Alice Smith, Bob Jones')).toBe(false);
    expect(isMarkupAdjudicatorCell('')).toBe(false);
    expect(parseAdjudicatorCell('<span class="d-inline"><em>Redacted</em></span>')).toEqual([]);
  });
});

describe('parseBpPlacing', () => {
  // The result cell of a BP debate reads "1st".."4th". None of those match
  // /won|win|✓|✔/, so `won` came back FALSE for the team that placed first —
  // and ingest writes result 'lost' on a false, so the winner of a grand
  // final was recorded as having lost it.
  test('reads the placing and the BP points that go with it', () => {
    expect(parseBpPlacing('1st')).toEqual({ place: 1, points: 3, won: true });
    expect(parseBpPlacing('2nd')).toEqual({ place: 2, points: 2, won: false });
    expect(parseBpPlacing('3rd')).toEqual({ place: 3, points: 1, won: false });
    expect(parseBpPlacing('4th')).toEqual({ place: 4, points: 0, won: false });
  });

  test('is case- and space-tolerant', () => {
    expect(parseBpPlacing('  1ST  ')?.won).toBe(true);
    expect(parseBpPlacing('Placed 1st')?.won).toBe(true);
  });

  test('ignores anything that is not an ordinal placing', () => {
    // Bare numbers are what caused a false-positive Champion once before:
    // a points column of 3/2/1/0 was mistaken for a result. Ordinals cannot
    // be confused with those.
    expect(parseBpPlacing('3')).toBe(null);
    expect(parseBpPlacing('0')).toBe(null);
    expect(parseBpPlacing('Win')).toBe(null);
    expect(parseBpPlacing('')).toBe(null);
    expect(parseBpPlacing('5th')).toBe(null);
  });
});

describe('readTeamOutcome — outround result cells', () => {
  // Verbatim from a real grand final: three teams read "eliminated" and one
  // reads "advancing". /won|win/ matched none of them, so the CHAMPION came
  // back won:false — and ingest writes a false as result 'lost', recording
  // the winner of the final as having lost it.
  test('advancing is a win, eliminated is a loss', () => {
    expect(readTeamOutcome('advancing')).toEqual({ won: true, points: null });
    expect(readTeamOutcome('Advancing')).toEqual({ won: true, points: null });
    expect(readTeamOutcome('eliminated')).toEqual({ won: false, points: null });
  });

  test('two-team formats still work', () => {
    expect(readTeamOutcome('Win')?.won).toBe(true);
    expect(readTeamOutcome('won')?.won).toBe(true);
    expect(readTeamOutcome('Loss')?.won).toBe(false);
  });

  test('a BP placing carries the points too', () => {
    expect(readTeamOutcome('1st')).toEqual({ won: true, points: 3 });
    expect(readTeamOutcome('4th')).toEqual({ won: false, points: 0 });
  });

  test('an empty cell tells us nothing', () => {
    expect(readTeamOutcome('')).toBe(null);
  });
});
