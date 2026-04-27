import { describe, expect, test } from 'vitest';
import { extractAdjudicatorRounds, extractSpeakerRounds } from '@/lib/calicotab/parseNav';
import { getInroundsChairedCount } from '@/lib/calicotab/judgeStats';

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

  test('aggregates SIDO as six inrounds chaired', () => {
    expect(
      getInroundsChairedCount(rounds.map((r) => ({ stage: r.stage, panelRole: r.role }))),
    ).toBe(6);
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

// Faithful reduction of the SBS Debate 2026 "Debates" card the user pasted on
// 2026-04-25 (`/sbsdebate2026/privateurls/esgoptsq/`). Differs from the SIDO
// fixture in three ways:
//   - 2-team Prop/Opp columns, not 4-team OG/OO/CG/CO (schools-style format).
//   - Only 5 prelim rounds, no outrounds visible.
//   - Rounds 3 and 4 include sibling adjudicators (Mohit Hooda, Vineet Detha)
//     rendered as plain <span>s — they MUST NOT cause the URL owner's role to
//     downgrade from chair to panellist (the chair Ⓒ stays inside <strong>).
const SBS_DEBATES_FRAGMENT = `
<div class="card-body">
  <h4 class="card-title"> Debates </h4>
  <div class="table-responsive-md">
    <table class="table">
      <thead>
        <tr>
          <th data-original-title="Round"><span>R</span></th>
          <th><span>Prop</span></th>
          <th><span>Opp</span></th>
          <th><span>Adjudicators</span></th>
          <th><span>Motion</span></th>
          <th data-original-title="The ballot you submitted"><span>B</span></th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><span hidden>1</span><div data-toggle="tooltip" data-original-title="Round 1"><span class="tooltip-trigger">R1</span></div></td>
          <td class="team-name">SBS 1</td>
          <td class="team-name">AHPS 1</td>
          <td class="adjudicator-name">
            <span class="tooltip-trigger">
              <strong><span class="d-inline">Abhishek Lalatendu Acharya<i class="adj-symbol">Ⓒ</i></span></strong>
            </span>
          </td>
          <td>—</td>
          <td><a>View Ballot</a></td>
        </tr>
        <tr>
          <td><span hidden>2</span><div data-toggle="tooltip" data-original-title="Round 2"><span class="tooltip-trigger">R2</span></div></td>
          <td class="team-name">TMIS 1</td>
          <td class="team-name">TISVV 1</td>
          <td class="adjudicator-name">
            <span class="tooltip-trigger">
              <strong><span class="d-inline">Abhishek Lalatendu Acharya<i class="adj-symbol">Ⓒ</i></span></strong>
            </span>
          </td>
          <td>Bloggers</td>
          <td><a>View Ballot</a></td>
        </tr>
        <tr>
          <td><span hidden>3</span><div data-toggle="tooltip" data-original-title="Round 3"><span class="tooltip-trigger">R3</span></div></td>
          <td class="team-name">TSMS 1</td>
          <td class="team-name">DPSRKP 1</td>
          <td class="adjudicator-name">
            <span class="tooltip-trigger">
              <strong><span class="d-inline">Abhishek Lalatendu Acharya<i class="adj-symbol">Ⓒ</i></span></strong>
              <span class="d-none d-md-inline">, </span>
              <span class="d-inline">Mohit Hooda</span>
            </span>
          </td>
          <td>—</td>
          <td><a>View Ballot</a></td>
        </tr>
        <tr>
          <td><span hidden>4</span><div data-toggle="tooltip" data-original-title="Round 4"><span class="tooltip-trigger">R4</span></div></td>
          <td class="team-name">BBPS 1</td>
          <td class="team-name">SPV 1</td>
          <td class="adjudicator-name">
            <span class="tooltip-trigger">
              <strong><span class="d-inline">Abhishek Lalatendu Acharya<i class="adj-symbol">Ⓒ</i></span></strong>
              <span class="d-none d-md-inline">, </span>
              <span class="d-inline">Vineet Detha</span>
            </span>
          </td>
          <td>—</td>
          <td><a>View Ballot</a></td>
        </tr>
        <tr>
          <td><span hidden>5</span><div data-toggle="tooltip" data-original-title="Round 5"><span class="tooltip-trigger">R5</span></div></td>
          <td class="team-name">GS 1</td>
          <td class="team-name">SNSN 1</td>
          <td class="adjudicator-name">
            <span class="tooltip-trigger">
              <strong><span class="d-inline">Abhishek Lalatendu Acharya<i class="adj-symbol">Ⓒ</i></span></strong>
            </span>
          </td>
          <td>—</td>
          <td><a>View Ballot</a></td>
        </tr>
      </tbody>
    </table>
  </div>
</div>
`;

describe('extractAdjudicatorRounds — SBS Debate 2026 (Prop/Opp, 5 prelims, all chair)', () => {
  const rows = extractAdjudicatorRounds(SBS_DEBATES_FRAGMENT);

  test('returns 5 entries in Round 1..5 order', () => {
    expect(rows).toHaveLength(5);
    expect(rows.map((r) => r.stage)).toEqual([
      'Round 1',
      'Round 2',
      'Round 3',
      'Round 4',
      'Round 5',
    ]);
  });

  test('every row is detected as chair (Ⓒ inside <strong>)', () => {
    expect(rows.every((r) => r.role === 'chair')).toBe(true);
  });

  test('every roundNumber is the trailing digit of "Round N"', () => {
    expect(rows.map((r) => r.roundNumber)).toEqual([1, 2, 3, 4, 5]);
  });

  test("sibling-span adjs (no Ⓒ) don't flip the URL owner from chair to panellist", () => {
    // Round 3 has Mohit Hooda as a sibling <span> with no chair symbol.
    expect(rows[2]!.role).toBe('chair');
    // Round 4 has Vineet Detha as a sibling <span> with no chair symbol.
    expect(rows[3]!.role).toBe('chair');
  });
});

// Abbreviation-only fragment — the variant where the round cell is just a
// `.tooltip-trigger` span with no enclosing `<div data-original-title="…">`.
// This is what some Tabbycat themes / older versions render and is the case
// the user reported as broken on 2026-04-25. Without normalization the bare
// "R1" makes `roundNumber` null and trips classifyRoundLabel into 'unknown',
// so all four metrics (inrounds judged/chaired, last outround chaired/judged)
// come out blank.
const ABBREV_ONLY_FRAGMENT = `
<div class="card-body pl-3 pr-0 py-2">
  <h4 class="card-title mt-1 mb-2"> Debates </h4>
  <div class="table-responsive-md">
    <table class="table">
      <tbody>
        <tr>
          <td><span class="tooltip-trigger">R1</span></td>
          <td class="adjudicator-name">
            <span class="tooltip-trigger"><strong><span class="d-inline">Abhishek Lalatendu Acharya<i class="adj-symbol">Ⓒ</i></span></strong></span>
          </td>
        </tr>
        <tr>
          <td><span class="tooltip-trigger">R2</span></td>
          <td class="adjudicator-name">
            <span class="tooltip-trigger"><strong><span class="d-inline">Abhishek Lalatendu Acharya<i class="adj-symbol">Ⓒ</i></span></strong>, <span class="d-inline">Mohit Hooda</span></span>
          </td>
        </tr>
        <tr>
          <td><span class="tooltip-trigger">R3</span></td>
          <td class="adjudicator-name">
            <span class="tooltip-trigger"><strong><span class="d-inline">Abhishek Lalatendu Acharya<i class="adj-symbol">Ⓒ</i></span></strong></span>
          </td>
        </tr>
        <tr>
          <td><span class="tooltip-trigger">QF</span></td>
          <td class="adjudicator-name">
            <span class="d-inline">Beauty Ariel<i class="adj-symbol">Ⓒ</i></span>,
            <strong><span class="d-inline">Abhishek Lalatendu Acharya</span></strong>,
            <span class="d-inline">Udai Kamath</span>
          </td>
        </tr>
        <tr>
          <td><span class="tooltip-trigger">SF</span></td>
          <td class="adjudicator-name">
            <strong><span class="d-inline">Abhishek Lalatendu Acharya<i class="adj-symbol">Ⓒ</i></span></strong>,
            <span class="d-inline">Beauty Ariel</span>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</div>
`;

describe('extractAdjudicatorRounds — abbreviation-only round labels (no data-original-title)', () => {
  const rows = extractAdjudicatorRounds(ABBREV_ONLY_FRAGMENT);

  test('returns 5 entries in document order', () => {
    expect(rows).toHaveLength(5);
    expect(rows.map((r) => r.sequenceIndex)).toEqual([1, 2, 3, 4, 5]);
  });

  test('normalizes "R\\d+" to "Round N" and abbreviated outrounds to canonical names', () => {
    expect(rows.map((r) => r.stage)).toEqual([
      'Round 1',
      'Round 2',
      'Round 3',
      'Quarterfinals',
      'Semifinals',
    ]);
  });

  test('extracts numeric roundNumber for inrounds and null for outrounds', () => {
    expect(rows.map((r) => r.roundNumber)).toEqual([1, 2, 3, null, null]);
  });

  test('preserves chair / panellist roles across the abbreviation form', () => {
    // R1, R2, R3 chair via <strong>...Ⓒ; QF panellist (Ⓒ on Beauty Ariel); SF chair.
    expect(rows.map((r) => r.role)).toEqual([
      'chair',
      'chair',
      'chair',
      'panellist',
      'chair',
    ]);
  });
});

const VUE_SIDO_DEBATES_FRAGMENT = `<script>window.vueData = ${JSON.stringify({
  tablesData: [{
    title: 'Debates',
    head: [
      { key: 'round', tooltip: 'Round' },
      { key: 'OG', title: 'OG' },
      { key: 'OO', title: 'OO' },
      { key: 'CG', title: 'CG' },
      { key: 'CO', title: 'CO' },
      { key: 'adjudicators', title: 'Adjudicators' },
    ],
    data: [
      [
        { text: 'R1', tooltip: 'Round 1' },
        { text: 'A', class: 'team-name' },
        { text: 'B', class: 'team-name' },
        { text: 'C', class: 'team-name' },
        { text: 'D', class: 'team-name' },
        { class: 'adjudicator-name', text: '<strong><span class="d-inline">Abhishek Acharya<i class="adj-symbol">\u24b8</i></span></strong>, <span class="d-inline">Bea Legaspi</span>' },
      ],
      [
        { text: 'R2', tooltip: 'Round 2' },
        { text: 'A', class: 'team-name' },
        { text: 'B', class: 'team-name' },
        { text: 'C', class: 'team-name' },
        { text: 'D', class: 'team-name' },
        { class: 'adjudicator-name', text: '<strong><span class="d-inline">Abhishek Acharya<i class="adj-symbol">\u24b8</i></span></strong>' },
      ],
      [
        { text: 'R3', tooltip: 'Round 3' },
        { text: 'A', class: 'team-name' },
        { text: 'B', class: 'team-name' },
        { text: 'C', class: 'team-name' },
        { text: 'D', class: 'team-name' },
        { class: 'adjudicator-name', text: '<strong><span class="d-inline">Abhishek Acharya<i class="adj-symbol">\u24b8</i></span></strong>' },
      ],
      [
        { text: 'R4', tooltip: 'Round 4' },
        { text: 'A', class: 'team-name' },
        { text: 'B', class: 'team-name' },
        { text: 'C', class: 'team-name' },
        { text: 'D', class: 'team-name' },
        { class: 'adjudicator-name', text: '<strong><span class="d-inline">Abhishek Acharya<i class="adj-symbol">\u24b8</i></span></strong>' },
      ],
      [
        { text: 'R5', tooltip: 'Round 5' },
        { text: 'A', class: 'team-name' },
        { text: 'B', class: 'team-name' },
        { text: 'C', class: 'team-name' },
        { text: 'D', class: 'team-name' },
        { class: 'adjudicator-name', text: '<strong><span class="d-inline">Abhishek Acharya<i class="adj-symbol">\u24b8</i></span></strong>' },
      ],
      [
        { text: 'R6', tooltip: 'Round 6' },
        { text: 'A', class: 'team-name' },
        { text: 'B', class: 'team-name' },
        { text: 'C', class: 'team-name' },
        { text: 'D', class: 'team-name' },
        { class: 'adjudicator-name', text: '<strong><span class="d-inline">Abhishek Acharya<i class="adj-symbol">\u24b8</i></span></strong>' },
      ],
      [
        { text: 'QF', tooltip: 'Quarterfinals' },
        { text: 'A', class: 'team-name' },
        { text: 'B', class: 'team-name' },
        { text: 'C', class: 'team-name' },
        { text: 'D', class: 'team-name' },
        { class: 'adjudicator-name', text: '<span class="d-inline">Beauty Ariel<i class="adj-symbol">\u24b8</i></span>, <strong><span class="d-inline">Abhishek Acharya</span></strong>, <span class="d-inline">Udai Kamath</span>' },
      ],
    ],
  }],
})}</script>`;

describe('extractAdjudicatorRounds - Vue tablesData private URL page', () => {
  const rows = extractAdjudicatorRounds(VUE_SIDO_DEBATES_FRAGMENT, 'Abhishek Acharya');

  test('reads server-side Vue Debates data before the browser renders a table', () => {
    expect(rows).toHaveLength(7);
    expect(rows.map((r) => r.stage)).toEqual([
      'Round 1',
      'Round 2',
      'Round 3',
      'Round 4',
      'Round 5',
      'Round 6',
      'Quarterfinals',
    ]);
    expect(rows.map((r) => r.role)).toEqual([
      'chair',
      'chair',
      'chair',
      'chair',
      'chair',
      'chair',
      'panellist',
    ]);
  });

  test('aggregates Vue SIDO data as six chaired inrounds', () => {
    expect(
      getInroundsChairedCount(rows.map((r) => ({ stage: r.stage, panelRole: r.role }))),
    ).toBe(6);
  });
});

// Speaker variant of the same Debates card. Tabbycat reuses the table on
// every private URL; only the highlighted cell differs. For a speaker, the
// owner's TEAM appears in one of the team-name cells. Two markups are
// observed in the wild: bolded team name (<strong>), and unbolded with the
// team identified only by string equality against the registration team.
const SPEAKER_DEBATES_FRAGMENT_BOLD = `
<div class="card-body">
  <h4 class="card-title">Debates</h4>
  <table class="table">
    <tbody>
      <tr>
        <td><div data-original-title="Round 1"><span class="tooltip-trigger">R1</span></div></td>
        <td class="team-name"><strong>Team A 1</strong></td>
        <td class="team-name">Team B 1</td>
        <td class="team-name">Team C 1</td>
        <td class="team-name">Team D 1</td>
        <td class="adjudicator-name">Some Judge</td>
      </tr>
      <tr>
        <td><div data-original-title="Round 2"><span class="tooltip-trigger">R2</span></div></td>
        <td class="team-name">Team E</td>
        <td class="team-name"><strong>Team A 1</strong></td>
        <td class="team-name">Team F</td>
        <td class="team-name">Team G</td>
        <td class="adjudicator-name">Other Judge</td>
      </tr>
      <tr>
        <td><div data-original-title="Quarterfinals"><span class="tooltip-trigger">QF</span></div></td>
        <td class="team-name">Team H</td>
        <td class="team-name">Team I</td>
        <td class="team-name"><strong>Team A 1</strong></td>
        <td class="team-name">Team J</td>
        <td class="adjudicator-name">Chair Person</td>
      </tr>
    </tbody>
  </table>
</div>
`;

describe('extractSpeakerRounds — bolded team name', () => {
  const rows = extractSpeakerRounds(SPEAKER_DEBATES_FRAGMENT_BOLD);

  test('returns one entry per row the team appeared in', () => {
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.stage)).toEqual(['Round 1', 'Round 2', 'Quarterfinals']);
    expect(rows.map((r) => r.roundNumber)).toEqual([1, 2, null]);
  });

  test('sequenceIndex follows document order', () => {
    expect(rows.map((r) => r.sequenceIndex)).toEqual([1, 2, 3]);
  });
});

const VUE_SPEAKER_DEBATES_FRAGMENT = `<script>window.vueData = ${JSON.stringify({
  tablesData: [{
    title: 'Debates',
    head: [
      { key: 'round', tooltip: 'Round' },
      { key: 'OG', title: 'OG' },
      { key: 'OO', title: 'OO' },
      { key: 'CG', title: 'CG' },
      { key: 'CO', title: 'CO' },
      { key: 'adjudicators', title: 'Adjudicators' },
    ],
    data: [
      [
        { text: 'R1', tooltip: 'Round 1' },
        { text: '<strong>Team A 1</strong>', class: 'team-name' },
        { text: 'Team B 1', class: 'team-name' },
        { text: 'Team C 1', class: 'team-name' },
        { text: 'Team D 1', class: 'team-name' },
        { class: 'adjudicator-name', text: 'Some Judge' },
      ],
      [
        { text: 'QF', tooltip: 'Quarterfinals' },
        { text: 'Team E 1', class: 'team-name' },
        { text: 'Team F 1', class: 'team-name' },
        { text: 'Team A 1', class: 'team-name' },
        { text: 'Team G 1', class: 'team-name' },
        { class: 'adjudicator-name', text: 'Other Judge' },
      ],
    ],
  }],
})}</script>`;

describe('extractSpeakerRounds - Vue tablesData private URL page', () => {
  test('reads owner speaker rows from server-side Vue data', () => {
    const rows = extractSpeakerRounds(VUE_SPEAKER_DEBATES_FRAGMENT, 'Team A 1');
    expect(rows.map((r) => r.stage)).toEqual(['Round 1', 'Quarterfinals']);
    expect(rows.map((r) => r.roundNumber)).toEqual([1, null]);
  });
});

// Same shape, but no <strong> on the team name — the team can only be
// found by matching the registered team name passed in by the caller. This
// is the path used when Tabbycat themes drop the bold marker.
const VUE_AP_SPEAKER_PRIVATE_DEBATES_FRAGMENT = `<script>window.vueData = ${JSON.stringify({
  tablesData: [{
    title: 'Debates',
    head: [
      { key: 'round', tooltip: 'Round' },
      { key: 'result', tooltip: 'Result' },
      { key: 'cumulative', tooltip: 'Wins after this debate' },
      { key: 'speaks', tooltip: 'Speaker scores<br>(in speaking order)', text: 'Speaks' },
      { key: 'side', title: 'Side' },
      { key: 'adjudicators', title: 'Adjudicators' },
      { key: 'motion', title: 'Motion' },
      { key: 'ballot', tooltip: 'The confirmed ballot' },
    ],
    data: [
      [
        { text: 'R1', tooltip: 'Round 1' },
        { text: 'vs Team One' },
        { text: '1' },
        { text: '74.0, 75.0, 76.0' },
        { text: 'Aff' },
        { text: 'Judge A' },
        { text: 'Motion' },
        { text: 'View Ballot', link: '/nlsd25/results/round/1/speaker/z2kqpxl7/' },
      ],
      [
        { text: 'OQF', tooltip: 'Open Quarterfinals' },
        { text: 'vs Team Two' },
        { text: '' },
        { text: 'No scores' },
        { text: 'Neg' },
        { text: 'Judge B' },
        { text: 'Motion' },
        { text: 'No scores' },
      ],
      [
        { text: 'OSF', tooltip: 'Open Semifinals' },
        { text: 'vs Team Three' },
        { text: '' },
        { text: 'No scores' },
        { text: 'Aff' },
        { text: 'Judge C' },
        { text: 'Motion' },
        { text: 'No scores' },
      ],
      [
        { text: 'OGF', tooltip: 'Open Grand Final' },
        { text: 'vs Team Four' },
        { text: '' },
        { text: 'No scores' },
        { text: 'Neg' },
        { text: 'Judge D' },
        { text: 'Motion' },
        { text: 'No scores' },
      ],
    ],
  }],
})}</script>`;

describe('extractSpeakerRounds - AP-style Vue private URL page', () => {
  test('treats every debate row as owned when the private table has result/speaks/side columns', () => {
    const rows = extractSpeakerRounds(
      VUE_AP_SPEAKER_PRIVATE_DEBATES_FRAGMENT,
      'Bangalore Bombay Chennai',
    );
    expect(rows.map((r) => r.stage)).toEqual([
      'Round 1',
      'Open Quarterfinals',
      'Open Semifinals',
      'Open Grand Final',
    ]);
    expect(rows.map((r) => r.roundNumber)).toEqual([1, null, null, null]);
  });
});

const SPEAKER_DEBATES_FRAGMENT_PLAIN = `
<div class="card-body">
  <h4 class="card-title">Debates</h4>
  <table class="table">
    <tbody>
      <tr>
        <td><span class="tooltip-trigger">R1</span></td>
        <td class="team-name">Team A 1</td>
        <td class="team-name">Team B 1</td>
        <td class="adjudicator-name">Judge</td>
      </tr>
      <tr>
        <td><span class="tooltip-trigger">R2</span></td>
        <td class="team-name">Team C 1</td>
        <td class="team-name">Team A 1</td>
        <td class="adjudicator-name">Judge</td>
      </tr>
      <tr>
        <td><span class="tooltip-trigger">SF</span></td>
        <td class="team-name">Team A 1</td>
        <td class="team-name">Team D 1</td>
        <td class="adjudicator-name">Judge</td>
      </tr>
    </tbody>
  </table>
</div>
`;

describe('extractSpeakerRounds — plain team name (string match fallback)', () => {
  test('matches rows by team-name text against knownTeamName', () => {
    const rows = extractSpeakerRounds(SPEAKER_DEBATES_FRAGMENT_PLAIN, 'Team A 1');
    expect(rows.map((r) => r.stage)).toEqual(['Round 1', 'Round 2', 'Semifinals']);
    expect(rows.map((r) => r.roundNumber)).toEqual([1, 2, null]);
  });

  test('returns empty when no team name is provided and nothing is bolded', () => {
    expect(extractSpeakerRounds(SPEAKER_DEBATES_FRAGMENT_PLAIN)).toEqual([]);
  });

  test('returns empty when the provided team name appears in no row', () => {
    expect(
      extractSpeakerRounds(SPEAKER_DEBATES_FRAGMENT_PLAIN, 'Nonexistent Team'),
    ).toEqual([]);
  });

  test('match is case-insensitive on whitespace-collapsed cell text', () => {
    const rows = extractSpeakerRounds(SPEAKER_DEBATES_FRAGMENT_PLAIN, '  team a 1  ');
    expect(rows).toHaveLength(3);
  });
});

describe('extractSpeakerRounds — does not pick up adjudicator rows', () => {
  test('SIDO fixture: returns no rows when the owner is a judge (their name lives in adjudicator-name, not team-name)', () => {
    // Reusing the SIDO_DEBATES_FRAGMENT — the bold sits in the adjudicator
    // cell, not any team cell, so a speaker pass over the same HTML must
    // report no rows for the owner.
    expect(extractSpeakerRounds(SIDO_DEBATES_FRAGMENT)).toEqual([]);
  });
});

// Tabbycat sometimes appends a team-number suffix to differentiate multiple
// teams from the same institution. Registration card might say "MIT Debate A"
// but the Debates table renders "MIT Debate A 1". The fuzzy match must accept
// the suffix without conflating distinct teams (e.g. "MIT" vs "MIT A").
const SUFFIX_FRAGMENT = `
<div class="card-body">
  <h4 class="card-title">Debates</h4>
  <table class="table">
    <tbody>
      <tr>
        <td><span class="tooltip-trigger">R1</span></td>
        <td class="team-name">MIT Debate A 1</td>
        <td class="team-name">Harvard A 1</td>
        <td class="adjudicator-name">Judge</td>
      </tr>
      <tr>
        <td><span class="tooltip-trigger">R2</span></td>
        <td class="team-name">MIT Debate B 1</td>
        <td class="team-name">MIT Debate A 1</td>
        <td class="adjudicator-name">Judge</td>
      </tr>
    </tbody>
  </table>
</div>
`;

describe('extractSpeakerRounds — fuzzy team-name matching', () => {
  test('registered "MIT Debate A" still matches "MIT Debate A 1" (team-number suffix)', () => {
    const rows = extractSpeakerRounds(SUFFIX_FRAGMENT, 'MIT Debate A');
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.stage)).toEqual(['Round 1', 'Round 2']);
  });

  test('registered "MIT Debate A 1" still matches plain "MIT Debate A" (suffix dropped on display)', () => {
    const html = SUFFIX_FRAGMENT.replace(/MIT Debate A 1/g, 'MIT Debate A');
    const rows = extractSpeakerRounds(html, 'MIT Debate A 1');
    expect(rows).toHaveLength(2);
  });

  test('registered "MIT" must NOT match "MIT Debate A 1" (would conflate distinct teams)', () => {
    const rows = extractSpeakerRounds(SUFFIX_FRAGMENT, 'MIT');
    expect(rows).toEqual([]);
  });

  test('registered "MIT Debate A 1" must NOT match "MIT Debate B 1" (different team)', () => {
    // Only the R1 + R2 rows where team A appears should match — R2 also has
    // team B in the first cell, but the fuzzy matcher must reject it.
    const rows = extractSpeakerRounds(SUFFIX_FRAGMENT, 'MIT Debate A 1');
    expect(rows).toHaveLength(2);
    // Verify B's row is matched only via the A 1 cell, not the B 1 cell — by
    // confirming we don't double-count R2 (which has both teams).
    expect(rows.map((r) => r.sequenceIndex)).toEqual([1, 2]);
  });
});

// Some Tabbycat themes don't wrap the URL owner's name in <strong> in the
// adjudicator-name cell. The parser must fall back to matching the name
// passed in (typically pulled from the registration card on the same page).
const NO_STRONG_FRAGMENT = `
<div class="card-body">
  <h4 class="card-title">Debates</h4>
  <table class="table">
    <tbody>
      <tr>
        <td><div data-original-title="Round 1"><span class="tooltip-trigger">R1</span></div></td>
        <td class="team-name">A</td><td class="team-name">B</td>
        <td class="adjudicator-name">
          <span class="d-inline">Abhishek Lalatendu Acharya<i class="adj-symbol">Ⓒ</i></span>,
          <span class="d-inline">Bea Legaspi</span>
        </td>
      </tr>
      <tr>
        <td><div data-original-title="Quarterfinals"><span class="tooltip-trigger">QF</span></div></td>
        <td class="team-name">C</td><td class="team-name">D</td>
        <td class="adjudicator-name">
          <span class="d-inline">Beauty Ariel<i class="adj-symbol">Ⓒ</i></span>,
          <span class="d-inline">Abhishek Lalatendu Acharya</span>,
          <span class="d-inline">Udai Kamath</span>
        </td>
      </tr>
    </tbody>
  </table>
</div>
`;

describe('extractAdjudicatorRounds — name-fallback when <strong> is missing', () => {
  test('matches the URL owner by name and detects role from the adj-symbol', () => {
    const rows = extractAdjudicatorRounds(NO_STRONG_FRAGMENT, 'Abhishek Lalatendu Acharya');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.role).toBe('chair');
    expect(rows[0]!.stage).toBe('Round 1');
    expect(rows[1]!.role).toBe('panellist');
    expect(rows[1]!.stage).toBe('Quarterfinals');
  });

  test('registration "Abhishek Acharya" still matches cell "Abhishek Lalatendu Acharya"', () => {
    // Common case: the registration card drops the middle name but the
    // adjudicator cell shows the full legal name. Token-set fallback catches
    // it since both first + last names overlap.
    const rows = extractAdjudicatorRounds(NO_STRONG_FRAGMENT, 'Abhishek Acharya');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.role).toBe('chair');
    expect(rows[1]!.role).toBe('panellist');
  });

  test('does NOT match a single-token first-name query', () => {
    // "Abhishek" alone (1 token) must not match "Abhishek Lalatendu Acharya"
    // — token-set fallback requires both names to have ≥ 2 tokens to fire,
    // preventing first-name collisions from conflating distinct judges.
    const rows = extractAdjudicatorRounds(NO_STRONG_FRAGMENT, 'Abhishek');
    expect(rows).toEqual([]);
  });

  test('returns empty when no name is supplied and no <strong> exists', () => {
    expect(extractAdjudicatorRounds(NO_STRONG_FRAGMENT)).toEqual([]);
  });

  test('different judge name does not match', () => {
    const rows = extractAdjudicatorRounds(NO_STRONG_FRAGMENT, 'Some Other Person');
    expect(rows).toEqual([]);
  });
});
