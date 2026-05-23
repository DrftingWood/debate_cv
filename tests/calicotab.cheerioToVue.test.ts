import { describe, expect, test } from 'vitest';
import { extractFromCheerio } from '@/lib/calicotab/cheerioToVue';

describe('extractFromCheerio', () => {
  test('returns empty array when HTML has no tables', () => {
    const tables = extractFromCheerio('<div><p>nothing here</p></div>');
    expect(tables).toEqual([]);
  });

  test('extracts a single basic table into VueTable shape', () => {
    const html = `
      <table>
        <thead><tr><th>Rank</th><th>Team</th><th>Points</th></tr></thead>
        <tbody>
          <tr><td>1</td><td>Alpha</td><td>10</td></tr>
          <tr><td>2</td><td>Beta</td><td>8</td></tr>
        </tbody>
      </table>
    `;
    const tables = extractFromCheerio(html);
    expect(tables).toHaveLength(1);
    const t = tables[0]!;
    expect(t.head.map((h) => h.title)).toEqual(['Rank', 'Team', 'Points']);
    expect(t.head.map((h) => h.key)).toEqual(['rank', 'team', 'points']);
    expect(t.data).toHaveLength(2);
    expect(t.data[0]!.map((c) => c.text)).toEqual(['1', 'Alpha', '10']);
    expect(t.data[1]!.map((c) => c.text)).toEqual(['2', 'Beta', '8']);
  });

  test('emits multiple tables in DOM order', () => {
    const html = `
      <table><thead><tr><th>A</th></tr></thead><tbody><tr><td>first</td></tr></tbody></table>
      <table><thead><tr><th>B</th></tr></thead><tbody><tr><td>second</td></tr></tbody></table>
    `;
    const tables = extractFromCheerio(html);
    expect(tables).toHaveLength(2);
    expect(tables[0]!.head[0]!.title).toBe('A');
    expect(tables[0]!.data[0]![0]!.text).toBe('first');
    expect(tables[1]!.head[0]!.title).toBe('B');
    expect(tables[1]!.data[0]![0]!.text).toBe('second');
  });

  test('handles tables without <thead> by reading first row as headers', () => {
    const html = `
      <table>
        <tr><th>Round</th><th>Score</th></tr>
        <tr><td>R1</td><td>76</td></tr>
      </table>
    `;
    const tables = extractFromCheerio(html);
    expect(tables).toHaveLength(1);
    expect(tables[0]!.head.map((h) => h.title)).toEqual(['Round', 'Score']);
    expect(tables[0]!.data).toHaveLength(1);
    expect(tables[0]!.data[0]!.map((c) => c.text)).toEqual(['R1', '76']);
  });

  test('populates VueCell.html with raw inner HTML for icon detection', () => {
    const html = `
      <table>
        <thead><tr><th>Team</th><th>Result</th></tr></thead>
        <tbody>
          <tr>
            <td><strong>Alpha</strong></td>
            <td><i class="text-success result-icon"><svg class="feather feather-chevrons-up"></svg></i></td>
          </tr>
        </tbody>
      </table>
    `;
    const tables = extractFromCheerio(html);
    const cells = tables[0]!.data[0]!;
    expect(cells[0]!.text).toBe('Alpha');
    expect(cells[0]!.html).toMatch(/<strong>Alpha<\/strong>/);
    expect(cells[1]!.html).toMatch(/feather-chevrons-up/);
  });

  test('populates VueCell.class from the <td> class attribute', () => {
    const html = `
      <table>
        <thead><tr><th>Team</th></tr></thead>
        <tbody>
          <tr><td class="team-name text-success"><strong>Alpha</strong></td></tr>
        </tbody>
      </table>
    `;
    const tables = extractFromCheerio(html);
    expect(tables[0]!.data[0]![0]!.class).toMatch(/team-name/);
    expect(tables[0]!.data[0]![0]!.class).toMatch(/text-success/);
  });

  test('prefers span[hidden] text when present (Tabbycat sortable canonical value)', () => {
    const html = `
      <table>
        <thead><tr><th>Team</th></tr></thead>
        <tbody>
          <tr>
            <td>
              <span hidden>Akbar → Jahangir → Shah Jahan</span>
              <i class="emoji">🍓</i>
              <span class="tooltip-trigger">Akbar → Jahangir → Shah Jahan</span>
              <span>Robin Ahuja, K Dhruv Singh, Kinshuk Vasan</span>
            </td>
          </tr>
        </tbody>
      </table>
    `;
    const tables = extractFromCheerio(html);
    expect(tables[0]!.data[0]![0]!.text).toBe('Akbar → Jahangir → Shah Jahan');
  });

  test('falls back to tooltip-trigger text when span[hidden] absent', () => {
    const html = `
      <table>
        <thead><tr><th>Name</th></tr></thead>
        <tbody>
          <tr>
            <td>
              <span class="tooltip-trigger">Abhishek Acharya</span>
            </td>
          </tr>
        </tbody>
      </table>
    `;
    const tables = extractFromCheerio(html);
    expect(tables[0]!.data[0]![0]!.text).toBe('Abhishek Acharya');
  });

  test('prefers data-original-title for header keys when present', () => {
    const html = `
      <table>
        <thead>
          <tr>
            <th data-original-title="Member of the Adjudication Core"><span>Adj Core</span></th>
            <th data-original-title="Independent Adjudicator"><span>Independent</span></th>
          </tr>
        </thead>
      </table>
    `;
    const tables = extractFromCheerio(html);
    expect(tables[0]!.head[0]!.key).toBe('member of the adjudication core');
    expect(tables[0]!.head[0]!.title).toBe('Adj Core');
    expect(tables[0]!.head[1]!.key).toBe('independent adjudicator');
  });

  test('hoists preceding .card-title heading into table.title', () => {
    const html = `
      <div class="card">
        <div class="card-body">
          <h4 class="card-title">Adjudicators</h4>
          <table>
            <thead><tr><th>Name</th></tr></thead>
            <tbody><tr><td>Aadyant</td></tr></tbody>
          </table>
        </div>
      </div>
      <div class="card">
        <div class="card-body">
          <h4 class="card-title">Speakers</h4>
          <table>
            <thead><tr><th>Name</th></tr></thead>
            <tbody><tr><td>Robin Ahuja</td></tr></tbody>
          </table>
        </div>
      </div>
    `;
    const tables = extractFromCheerio(html);
    expect(tables).toHaveLength(2);
    expect(tables[0]!.title).toBe('Adjudicators');
    expect(tables[1]!.title).toBe('Speakers');
  });
});
