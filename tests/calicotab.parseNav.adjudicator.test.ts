import { describe, expect, test } from 'vitest';
import { extractAdjudicatorRounds, extractSpeakerRounds } from '@/lib/calicotab/parseNav';

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

// Same shape, but no <strong> on the team name — the team can only be
// found by matching the registered team name passed in by the caller. This
// is the path used when Tabbycat themes drop the bold marker.
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
