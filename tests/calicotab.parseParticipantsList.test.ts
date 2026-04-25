import { describe, expect, test } from 'vitest';
import { parseParticipantsList } from '@/lib/calicotab/parseTabs';

// Reduced reproduction of the markup the user supplied from a modern
// Tabbycat install (mukmem78). Two tables in the same page wrapped in
// .card-body containers, each with its own card-title heading. Adjudicators
// have an extra "Member of the Adjudication Core" + "Independent
// Adjudicator" column with check icons; speakers have a Team column whose
// canonical name lives in <span hidden>.
const MUKMEM_HTML = `
<div class="container">

  <div class="card table-container">
    <div class="card-body">
      <h4 class="card-title">Adjudicators</h4>
      <table class="table">
        <thead>
          <tr>
            <th data-original-title="Name"><span>Name</span></th>
            <th data-original-title="Institution"><span>Institution</span></th>
            <th data-original-title="Member of the Adjudication Core"><span>Adj Core</span></th>
            <th data-original-title="Independent Adjudicator"><span>Independent</span></th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><span class="tooltip-trigger"><em>Redacted</em></span></td>
            <td><span class="tooltip-trigger">SC</span></td>
            <td><span hidden>2</span></td>
            <td><span hidden>2</span></td>
          </tr>
          <tr>
            <td><span class="tooltip-trigger">Aadyant</span></td>
            <td><span class="tooltip-trigger">DDUC</span></td>
            <td><span hidden>2</span></td>
            <td><span hidden>2</span></td>
          </tr>
          <tr>
            <td><span class="tooltip-trigger">Abhishek Acharya</span></td>
            <td><span class="tooltip-trigger">—</span></td>
            <td><span hidden>1</span><i><svg class="feather feather-check"></svg></i></td>
            <td><span hidden>2</span></td>
          </tr>
          <tr>
            <td><span class="tooltip-trigger">Adya Sharma</span></td>
            <td><span class="tooltip-trigger">—</span></td>
            <td><span hidden>2</span></td>
            <td><span hidden>1</span><i><svg class="feather feather-check"></svg></i></td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>

  <div class="card table-container">
    <div class="card-body">
      <h4 class="card-title">Speakers</h4>
      <table class="table">
        <thead>
          <tr>
            <th data-original-title="Name"><span>Name</span></th>
            <th data-original-title="Team"><span>Team</span></th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><span class="tooltip-trigger">Kinshuk Vasan</span></td>
            <td class="team-name">
              <span hidden> Akbar → Jahangir → Shah Jahan </span>
              <i class="emoji">🍓</i>
              <span class="tooltip-trigger">Akbar → Jahangir → Shah Jahan</span>
              <span>Robin Ahuja, K Dhruv Singh, Kinshuk Vasan</span>
            </td>
          </tr>
          <tr>
            <td><span class="tooltip-trigger">Robin Ahuja</span></td>
            <td class="team-name">
              <span hidden> Akbar → Jahangir → Shah Jahan </span>
              <i class="emoji">🍓</i>
              <span class="tooltip-trigger">Akbar → Jahangir → Shah Jahan</span>
            </td>
          </tr>
          <tr>
            <td><span class="tooltip-trigger">Ishita Kejriwal</span></td>
            <td class="team-name">
              <span hidden> aloo patties </span>
              <i class="emoji">🐭</i>
              <span class="tooltip-trigger">aloo patties</span>
            </td>
          </tr>
          <tr>
            <td><span class="tooltip-trigger">Aryan" silence a fried bald man is speaking"Yadav</span></td>
            <td class="team-name">
              <span hidden> Hansraj A </span>
              <span class="tooltip-trigger">Hansraj A</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</div>
`;

describe('parseParticipantsList — modern card-based layout (mukmem78)', () => {
  const rows = parseParticipantsList(MUKMEM_HTML);

  test('extracts both adjudicators and speakers from a single page', () => {
    const adjs = rows.filter((r) => r.role === 'adjudicator');
    const speakers = rows.filter((r) => r.role === 'speaker');
    expect(adjs).toHaveLength(4);
    expect(speakers).toHaveLength(4);
  });

  test('reads adjudicator names through Vue-rendered <span class="tooltip-trigger">', () => {
    const adjs = rows.filter((r) => r.role === 'adjudicator');
    expect(adjs.map((a) => a.name)).toEqual([
      'Redacted',
      'Aadyant',
      'Abhishek Acharya',
      'Adya Sharma',
    ]);
  });

  test('normalizes em-dash institution to null', () => {
    const adya = rows.find((r) => r.name === 'Adya Sharma');
    expect(adya?.institution).toBeNull();
  });

  test('preserves real institution values', () => {
    expect(rows.find((r) => r.name === 'Aadyant')?.institution).toBe('DDUC');
  });

  test('marks independent adjudicators with judgeTag="invited"', () => {
    expect(rows.find((r) => r.name === 'Adya Sharma')?.judgeTag).toBe('invited');
  });

  test('non-independent adjudicators get judgeTag="normal" (incl. adj-core members)', () => {
    expect(rows.find((r) => r.name === 'Aadyant')?.judgeTag).toBe('normal');
    expect(rows.find((r) => r.name === 'Abhishek Acharya')?.judgeTag).toBe('normal');
  });

  test('extracts speaker team names from the hidden sort span, not the popover blob', () => {
    const kinshuk = rows.find((r) => r.name === 'Kinshuk Vasan');
    expect(kinshuk?.role).toBe('speaker');
    expect(kinshuk?.teamName).toBe('Akbar → Jahangir → Shah Jahan');
    // Critically, NOT "Akbar → Jahangir → Shah Jahan🍓Akbar → … Robin Ahuja, …"
    expect(kinshuk?.teamName).not.toContain('Robin Ahuja');
  });

  test('preserves names that contain inline quotes', () => {
    const aryan = rows.find((r) =>
      r.name.startsWith('Aryan'),
    );
    expect(aryan?.name).toBe('Aryan" silence a fried bald man is speaking"Yadav');
    expect(aryan?.role).toBe('speaker');
    expect(aryan?.teamName).toBe('Hansraj A');
  });

  test('does not double-count when the page nests .card-body inside .card', () => {
    // MUKMEM_HTML uses .card > .card-body — both selectors match the cards
    // collection internally. The dedup-by-table guard should prevent the
    // same <tbody> from yielding rows twice.
    const names = rows.map((r) => r.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('parseParticipantsList — registration card/list-group fallback', () => {
  test('classifies "Independent adjudicator" registration as adjudicator invited', () => {
    const html = `
      <div class="list-group list-group-flush">
        <div class="list-group-item">
          <h4 class="card-title mb-0">Registration (Abhishek Acharya)</h4>
        </div>
        <div class="list-group-item"><ul><li><em>Independent adjudicator</em></li></ul></div>
        <div class="list-group-item"><div><strong>Institution:</strong> <span class="text-muted">Unaffiliated</span></div></div>
      </div>
    `;
    const rows = parseParticipantsList(html);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: 'Abhishek Acharya',
      role: 'adjudicator',
      judgeTag: 'invited',
      institution: 'Unaffiliated',
    });
  });

  test('single-name registration role bullet defaults to adjudicator', () => {
    const html = `
      <div class="list-group list-group-flush">
        <div class="list-group-item">
          <h4 class="card-title mb-0">Registration (Ada Lovelace)</h4>
        </div>
        <div class="list-group-item"><ul><li><em>Ada Lovelace</em></li></ul></div>
      </div>
    `;
    const rows = parseParticipantsList(html);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.role).toBe('adjudicator');
    expect(rows[0]?.judgeTag).toBe('normal');
  });
});
