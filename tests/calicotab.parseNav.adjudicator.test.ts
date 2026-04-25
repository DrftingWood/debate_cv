import { describe, expect, test } from 'vitest';
import { extractAdjudicatorRounds } from '@/lib/calicotab/parseNav';

// Trimmed but structurally faithful snippet from the SIDO 2026 private URL
// landing page — the table the user supplied. Keeps the wrapper hierarchy
// (.card-body > h4.card-title > sibling .table-responsive-md > table) and
// preserves the markers the parser depends on:
//   - data-original-title="<stage>" on the inner round-cell div
//   - <td class="adjudicator-name"> for the panel cell
//   - <strong> wrapping the URL owner's own name in the panel
//   - <i class="adj-symbol">Ⓒ</i> appended to the chair's name
const SIDO_DEBATES_FRAGMENT = `
<div class="card-body">
  <h4 class="card-title">Debates</h4>
  <div class="table-responsive-md">
    <table class="table">
      <thead><tr><th>R</th><th>OG</th><th>OO</th><th>CG</th><th>CO</th><th>Adj</th><th>M</th><th>B</th></tr></thead>
      <tbody>
        <tr>
          <td><span hidden>1</span><div data-toggle="tooltip" data-original-title="Round 1"><span class="tooltip-trigger">R1</span></div></td>
          <td class="team-name">OG team</td><td class="team-name">OO team</td>
          <td class="team-name">CG team</td><td class="team-name">CO team</td>
          <td class="adjudicator-name">
            <strong><span class="d-inline">Abhishek Acharya<i class="adj-symbol">Ⓒ</i></span></strong>,
            <span class="d-inline">Bea Legaspi</span>
          </td>
          <td>art</td><td><a>View Ballot</a></td>
        </tr>
        <tr>
          <td><span hidden>2</span><div data-toggle="tooltip" data-original-title="Round 2"><span class="tooltip-trigger">R2</span></div></td>
          <td class="team-name">A</td><td class="team-name">B</td><td class="team-name">C</td><td class="team-name">D</td>
          <td class="adjudicator-name">
            <strong><span class="d-inline">Abhishek Acharya<i class="adj-symbol">Ⓒ</i></span></strong>
          </td>
          <td>technocrats</td><td><a>View Ballot</a></td>
        </tr>
        <tr>
          <td><span hidden>3</span><div data-toggle="tooltip" data-original-title="Round 3"><span class="tooltip-trigger">R3</span></div></td>
          <td class="team-name">A</td><td class="team-name">B</td><td class="team-name">C</td><td class="team-name">D</td>
          <td class="adjudicator-name">
            <strong><span class="d-inline">Abhishek Acharya<i class="adj-symbol">Ⓒ</i></span></strong>
          </td>
          <td>literature</td><td><a>View Ballot</a></td>
        </tr>
        <tr>
          <td><span hidden>4</span><div data-toggle="tooltip" data-original-title="Round 4"><span class="tooltip-trigger">R4</span></div></td>
          <td class="team-name">A</td><td class="team-name">B</td><td class="team-name">C</td><td class="team-name">D</td>
          <td class="adjudicator-name">
            <strong><span class="d-inline">Abhishek Acharya<i class="adj-symbol">Ⓒ</i></span></strong>
          </td>
          <td>price</td><td><a>View Ballot</a></td>
        </tr>
        <tr>
          <td><span hidden>5</span><div data-toggle="tooltip" data-original-title="Round 5"><span class="tooltip-trigger">R5</span></div></td>
          <td class="team-name">A</td><td class="team-name">B</td><td class="team-name">C</td><td class="team-name">D</td>
          <td class="adjudicator-name">
            <strong><span class="d-inline">Abhishek Acharya<i class="adj-symbol">Ⓒ</i></span></strong>
          </td>
          <td>farm</td><td><a>View Ballot</a></td>
        </tr>
        <tr>
          <td><span hidden>6</span><div data-toggle="tooltip" data-original-title="Round 6"><span class="tooltip-trigger">R6</span></div></td>
          <td class="team-name">A</td><td class="team-name">B</td><td class="team-name">C</td><td class="team-name">D</td>
          <td class="adjudicator-name">
            <strong><span class="d-inline">Abhishek Acharya<i class="adj-symbol">Ⓒ</i></span></strong>
          </td>
          <td>wage</td><td><a>View Ballot</a></td>
        </tr>
        <tr>
          <td><span hidden>7</span><div data-toggle="tooltip" data-original-title="Quarterfinals"><span class="tooltip-trigger">QF</span></div></td>
          <td class="team-name">A</td><td class="team-name">B</td><td class="team-name">C</td><td class="team-name">D</td>
          <td class="adjudicator-name">
            <span class="d-inline">Beauty Ariel<i class="adj-symbol">Ⓒ</i></span>,
            <strong><span class="d-inline">Abhishek Acharya</span></strong>,
            <span class="d-inline">Udai Kamath</span>
          </td>
          <td>expectation</td><td><span>No scores</span></td>
        </tr>
      </tbody>
    </table>
  </div>
</div>
`;

describe('extractAdjudicatorRounds', () => {
  const rounds = extractAdjudicatorRounds(SIDO_DEBATES_FRAGMENT);

  test('returns one entry per debate row, in document order', () => {
    expect(rounds).toHaveLength(7);
    expect(rounds.map((r) => r.sequenceIndex)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(rounds.map((r) => r.stage)).toEqual([
      'Round 1',
      'Round 2',
      'Round 3',
      'Round 4',
      'Round 5',
      'Round 6',
      'Quarterfinals',
    ]);
  });

  test('extracts numeric round numbers for prelims and null for outrounds', () => {
    expect(rounds.map((r) => r.roundNumber)).toEqual([1, 2, 3, 4, 5, 6, null]);
  });

  test('reads role from the URL owner\'s <strong> wrapper — Ⓒ marks chair', () => {
    expect(rounds.slice(0, 6).every((r) => r.role === 'chair')).toBe(true);
  });

  test('marks the QF as panellist when the chair Ⓒ is on someone else', () => {
    expect(rounds[6]!.role).toBe('panellist');
    expect(rounds[6]!.stage).toBe('Quarterfinals');
  });

  test('returns an empty array when no Debates table is present', () => {
    expect(extractAdjudicatorRounds('<html><body>no card here</body></html>')).toEqual([]);
  });

  test('returns an empty array when the card exists but the panel never has a <strong> wrapping the user', () => {
    const html = `
      <div class="card-body">
        <h4 class="card-title">Debates</h4>
        <table>
          <tbody>
            <tr>
              <td><div data-original-title="Round 1"><span>R1</span></div></td>
              <td class="adjudicator-name">
                <span>Other Person<i class="adj-symbol">Ⓒ</i></span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    `;
    // No <strong> = the URL owner isn't on this debate panel; the row is skipped.
    expect(extractAdjudicatorRounds(html)).toEqual([]);
  });
});
