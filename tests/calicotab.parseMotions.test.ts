import { describe, expect, test } from 'vitest';
import { parseMotionsTab } from '@/lib/calicotab/parseMotions';
import type { MotionRow } from '@/lib/calicotab/parseMotions';

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a minimal plain-HTML motions table (server-rendered, no Vue island).
 * Column order: Round | Motion | Info Slide (info slide column optional).
 */
function plainTableHtml(rows: { round: string; motion: string; infoSlide?: string }[], includeInfoCol = false): string {
  const headerCells = includeInfoCol
    ? '<th>Round</th><th>Motion</th><th>Info Slide</th>'
    : '<th>Round</th><th>Motion</th>';
  const bodyRows = rows
    .map((r) => {
      const infoCell = includeInfoCol ? `<td>${r.infoSlide ?? ''}</td>` : '';
      return `<tr><td>${r.round}</td><td>${r.motion}</td>${infoCell}</tr>`;
    })
    .join('\n');
  return `<!doctype html><html><body>
    <table>
      <thead><tr>${headerCells}</tr></thead>
      <tbody>${bodyRows}</tbody>
    </table>
  </body></html>`;
}

/**
 * Build a minimal Vue data island page — the same embedding format that
 * modern Tabbycat instances produce and that parseTabs.ts fixtures use.
 * Each `head` entry is `{ key, title }`; each data row is `{ text }[]`.
 */
function vueMotionsHtml(head: { key: string; title: string }[], data: { text: string }[][]): string {
  const payload = JSON.stringify([{ head, data }]);
  return `<!doctype html><html><body><script>window.vueData = ${payload}</script></body></html>`;
}

// ── Plain-table markup ───────────────────────────────────────────────────────

describe('parseMotionsTab — plain HTML table', () => {
  test('parses a basic two-column table (Round + Motion)', () => {
    const html = plainTableHtml([
      { round: 'Round 1', motion: 'THW ban social media for under-16s.' },
      { round: 'Round 2', motion: 'THBT nuclear energy is net-positive for climate.' },
    ]);
    const rows = parseMotionsTab(html);
    expect(rows).toHaveLength(2);

    const r1 = rows[0]!;
    expect(r1.roundLabel).toBe('Round 1');
    expect(r1.roundNumber).toBe(1);
    expect(r1.text).toBe('THW ban social media for under-16s.');
    expect(r1.infoSlide).toBeNull();
    expect(r1.seq).toBe(0);

    const r2 = rows[1]!;
    expect(r2.roundLabel).toBe('Round 2');
    expect(r2.roundNumber).toBe(2);
    expect(r2.seq).toBe(1);
  });

  test('parses a three-column table including an info slide column', () => {
    const html = plainTableHtml(
      [
        {
          round: 'Round 3',
          motion: 'THW require parental leave to be taken equally by both parents.',
          infoSlide: 'Currently most countries allow mothers to take more leave.',
        },
      ],
      true,
    );
    const rows = parseMotionsTab(html);
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    expect(r.roundNumber).toBe(3);
    expect(r.text).toBe('THW require parental leave to be taken equally by both parents.');
    expect(r.infoSlide).toBe('Currently most countries allow mothers to take more leave.');
  });

  test('skips rows with empty motion text', () => {
    // A row with an empty motion cell should be silently dropped.
    const html = `
      <table>
        <thead><tr><th>Round</th><th>Motion</th></tr></thead>
        <tbody>
          <tr><td>Round 1</td><td>   </td></tr>
          <tr><td>Round 2</td><td>THBT democracies should cap campaign spending.</td></tr>
        </tbody>
      </table>
    `;
    const rows = parseMotionsTab(html);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.roundNumber).toBe(2);
  });

  test('outround label gives roundNumber: null', () => {
    const html = plainTableHtml([
      { round: 'Quarterfinals', motion: 'THBT the EU should have a standing army.' },
      { round: 'Semifinals', motion: 'THW abolish the monarchy.' },
      { round: 'Grand Final', motion: 'THW prefer a world without religion.' },
    ]);
    const rows = parseMotionsTab(html);
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.roundNumber).toBeNull();
    }
    expect(rows[0]!.roundLabel).toBe('Quarterfinals');
    expect(rows[1]!.roundLabel).toBe('Semifinals');
    expect(rows[2]!.roundLabel).toBe('Grand Final');
  });

  test('"R3" abbreviated label normalizes roundNumber to 3', () => {
    // Some Tabbycat installs render "R1", "R2", ... in the round column
    // instead of the full "Round 1" form.
    const html = plainTableHtml([
      { round: 'R3', motion: 'THW give extra votes to the poor.' },
    ]);
    const rows = parseMotionsTab(html);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.roundNumber).toBe(3);
    // roundLabel preserves the original text, not the normalized form.
    expect(rows[0]!.roundLabel).toBe('R3');
  });
});

// ── Vue-embedded-JSON markup ──────────────────────────────────────────────────

// The cheerio path routes table markup through the same motionsFromVue
// column matcher, so rules already proven above (round-number
// normalisation, empty-text skipping) are not re-tested here — only the
// Vue-specific routing and key handling are.
describe('parseMotionsTab — Vue data island', () => {
  test('parses a Vue page with round and motion columns', () => {
    const html = vueMotionsHtml(
      [
        { key: 'round', title: 'Round' },
        { key: 'motion', title: 'Motion' },
      ],
      [
        [{ text: 'Round 1' }, { text: 'THW introduce a universal basic income.' }],
        [{ text: 'Round 2' }, { text: 'THBT free trade does more harm than good.' }],
      ],
    );
    const rows = parseMotionsTab(html);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.roundNumber).toBe(1);
    expect(rows[0]!.text).toBe('THW introduce a universal basic income.');
    expect(rows[1]!.roundNumber).toBe(2);
  });

  test('Vue page with round, motion, and info slide columns', () => {
    const html = vueMotionsHtml(
      [
        { key: 'round', title: 'Round' },
        { key: 'motion', title: 'Motion' },
        { key: 'info_slide', title: 'Info Slide' },
      ],
      [
        [
          { text: 'Round 4' },
          { text: 'THW make voting compulsory.' },
          { text: 'Turnout in the last election was 45%.' },
        ],
      ],
    );
    const rows = parseMotionsTab(html);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.roundNumber).toBe(4);
    expect(rows[0]!.infoSlide).toBe('Turnout in the last election was 45%.');
  });



  test('Vue page using "text" key instead of "motion"', () => {
    // Some Tabbycat installs label the motion column "text" or "topic".
    const html = vueMotionsHtml(
      [
        { key: 'round', title: 'Round' },
        { key: 'text', title: 'Text' },
      ],
      [
        [{ text: 'Round 5' }, { text: 'THW ban lobbying by corporations.' }],
      ],
    );
    const rows = parseMotionsTab(html);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.roundNumber).toBe(5);
    expect(rows[0]!.text).toBe('THW ban lobbying by corporations.');
  });
});

// ── Multiple motions per round ────────────────────────────────────────────────

describe('parseMotionsTab — multiple motions per round', () => {
  test('multiple rows with the same round label are all returned in document order', () => {
    // Some tournaments release more than one motion per round (e.g. two
    // motions and teams choose which one to debate, or a motion was replaced).
    const html = plainTableHtml([
      { round: 'Round 1', motion: 'THW cap executive pay.' },
      { round: 'Round 1', motion: 'THBT shareholders should have binding pay votes.' },
      { round: 'Round 2', motion: 'THW abolish intellectual property.' },
    ]);
    const rows = parseMotionsTab(html);
    expect(rows).toHaveLength(3);
    expect(rows[0]!.roundLabel).toBe('Round 1');
    expect(rows[0]!.seq).toBe(0);
    expect(rows[1]!.roundLabel).toBe('Round 1');
    expect(rows[1]!.seq).toBe(1);
    expect(rows[2]!.roundLabel).toBe('Round 2');
    expect(rows[2]!.seq).toBe(2);
  });

  test('seq is 0-based and monotonically increases across all rows', () => {
    const html = vueMotionsHtml(
      [
        { key: 'round', title: 'Round' },
        { key: 'motion', title: 'Motion' },
      ],
      [
        [{ text: 'Round 1' }, { text: 'Motion A' }],
        [{ text: 'Round 1' }, { text: 'Motion B' }],
        [{ text: 'Round 2' }, { text: 'Motion C' }],
        [{ text: 'Round 2' }, { text: 'Motion D' }],
      ],
    );
    const rows = parseMotionsTab(html);
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.seq)).toEqual([0, 1, 2, 3]);
  });
});

// ── Garbage / empty input ─────────────────────────────────────────────────────

describe('parseMotionsTab — empty and garbage input', () => {
  test('anything without a motion column yields [] rather than throwing', () => {
    // One behaviour, six ways in. parseMotionsTab is called on pages that
    // may 404, may not be a motions tab at all, or may be a motions tab
    // whose columns we do not recognise — all of them must degrade to an
    // empty list, because a throw here aborts the whole tournament ingest.
    const noMotionColumnTable = `
      <table>
        <thead><tr><th>Round</th><th>Venue</th></tr></thead>
        <tbody><tr><td>Round 1</td><td>Hall A</td></tr></tbody>
      </table>
    `;
    const noMotionColumnVue = vueMotionsHtml(
      [{ key: 'round', title: 'Round' }, { key: 'venue', title: 'Venue' }],
      [[{ text: 'Round 1' }, { text: 'Hall A' }]],
    );
    const emptyVueTables = `<html><body><script>window.vueData = {"tablesData":[]}</script></body></html>`;

    for (const html of [
      '',
      '<html><body><p>No data here.</p></body></html>',
      '<<<<>>>>>not html at all',
      noMotionColumnTable,
      noMotionColumnVue,
      emptyVueTables,
    ]) {
      expect(parseMotionsTab(html)).toEqual([]);
    }
  });
});

// ── Return-value contract ─────────────────────────────────────────────────────

describe('parseMotionsTab — return-value shape', () => {
  test('every row has the expected keys', () => {
    const html = plainTableHtml([
      { round: 'Round 1', motion: 'THW introduce term limits for judges.' },
    ]);
    const rows = parseMotionsTab(html);
    expect(rows).toHaveLength(1);
    const keys = Object.keys(rows[0]!) as (keyof MotionRow)[];
    expect(keys).toEqual(expect.arrayContaining(['roundNumber', 'roundLabel', 'text', 'infoSlide', 'seq']));
  });

  test('info slide is null whether the column is absent or empty', () => {
    const absent = plainTableHtml([
      { round: 'Round 1', motion: 'THW allow civil disobedience.' },
    ]);
    expect(parseMotionsTab(absent)[0]!.infoSlide).toBeNull();

    const empty = plainTableHtml(
      [{ round: 'Round 1', motion: 'THW lower the voting age to 16.', infoSlide: '' }],
      true,
    );
    expect(parseMotionsTab(empty)[0]!.infoSlide).toBeNull();
  });
});
