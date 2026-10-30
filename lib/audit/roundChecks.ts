import type { AuditInputs } from './auditInputs';
import {
  expectedPrelims,
  isWithheld,
  listText,
  median,
  minSpeakers,
  plural,
  prelimPiece,
  prelimRows,
  result,
  roomsByRound,
  tabPiece,
  teamKey,
  teamsPerRoom,
  withheldPrelims,
  worst,
} from './checkHelpers';
import type { CheckResult, CheckStatus } from './types';

/**
 * The prelim-round checks: is every round there, are the rounds the same
 * size, do the rounds cover the team tab, do teams have partners, are the
 * panels full, and do the tab's totals add up from the rounds. Thresholds are
 * the spec's (docs/superpowers/specs/2026-10-31-data-accuracy-design.md).
 */

/**
 * A round whose results page the tournament withholds (hidden results answer
 * 404) is not expected: its absence is the tournament's choice and no
 * re-scrape fills it. Rows stored before the page was hidden still count.
 */
export function checkRoundsComplete(inputs: AuditInputs): CheckResult {
  const all = expectedPrelims(inputs);
  if (all.length === 0) {
    return result('rounds_complete', 'na', 'The number of prelim rounds is not known.');
  }
  const have = new Set(prelimRows(inputs).map((r) => r.round));
  const hidden = withheldPrelims(inputs.pieces);
  const held = all.filter((n) => hidden.has(n) && !have.has(n));
  const expected = all.filter((n) => !held.includes(n));
  const heldText = listText(held.map((n) => `R${n}`));
  if (expected.length === 0) {
    return result('rounds_complete', 'na', `The tournament withholds the results of ${heldText}.`);
  }
  const note = held.length > 0 ? `; the tournament withholds ${heldText}` : '';
  const missing = expected.filter((n) => !have.has(n));
  if (missing.length === 0) {
    return result(
      'rounds_complete',
      'pass',
      `All ${expected.length} prelim rounds have results${note}.`,
    );
  }
  const names = listText(missing.map((n) => `R${n}`));
  return result(
    'rounds_complete',
    'fail',
    `${names} ${plural(missing.length, 'has', 'have')} no results, out of ${expected.length} prelim rounds${note}.`,
    missing.map((n) => prelimPiece(inputs.pieces, n)),
  );
}

/** Off by one room warns; more than one room, or more than 10% of the typical round, fails. */
function roomStatus(rooms: number, typical: number): CheckStatus {
  const diff = Math.abs(rooms - typical);
  if (diff === 0) return 'pass';
  if (diff > 1 || diff > 0.1 * typical) return 'fail';
  return 'warn';
}

/**
 * Rounds are compared with the median round, not with R1, because a short R1
 * (a late draw release, a missing page) is exactly what this should catch.
 */
export function checkRoomsConsistent(inputs: AuditInputs): CheckResult {
  const rooms = roomsByRound(inputs);
  if (rooms.size === 0)
    return result('rooms_consistent', 'na', 'No prelim round results are stored.');
  const typical = median([...rooms.values()]);
  const odd = [...rooms]
    .map(([round, n]) => ({ round, n, status: roomStatus(n, typical) }))
    .filter((o) => o.status !== 'pass');
  if (odd.length === 0) {
    return result(
      'rooms_consistent',
      'pass',
      `All ${rooms.size} prelim rounds have ${typical} rooms.`,
    );
  }
  const listed = listText(odd.map((o) => `R${o.round} has ${o.n} ${plural(o.n, 'room', 'rooms')}`));
  // A round not listed equals the median, so "the other rounds" is exact when
  // there are any; with an even split (16/16/12/12) no round sits at the
  // median and the sentence names the median itself.
  const others =
    odd.length < rooms.size ? `the other rounds have ${typical}` : `the median is ${typical}`;
  return result(
    'rooms_consistent',
    worst(odd.map((o) => o.status)),
    `${listed}; ${others}.`,
    odd.map((o) => prelimPiece(inputs.pieces, o.round)),
  );
}

function teamTabKeys(inputs: AuditInputs): Set<string> {
  return new Set(inputs.teamTab.map((t) => teamKey(t.team)));
}

export function checkTeamCoverage(inputs: AuditInputs): CheckResult {
  const pieces = [tabPiece(inputs.pieces, 'team'), prelimPiece(inputs.pieces, 1)];
  const tab = teamTabKeys(inputs);
  if (tab.size === 0) {
    // An unreleased team tab is withheld, not missing: the check does not
    // apply until the tournament publishes it. With no withheld record, a
    // missing tab is our gap and still fails.
    if (isWithheld(inputs.pieces, 'team')) {
      return result('team_coverage', 'na', 'The tournament withholds its team tab.');
    }
    return result('team_coverage', 'fail', 'There is no team tab.', pieces);
  }
  // Only R1 teams that are on the tab count: a swing team in R1 is not on
  // the tab, and counting it would hide a real team missing from the round.
  const r1 = new Set(
    prelimRows(inputs)
      .filter((r) => r.round === 1)
      .map((r) => teamKey(r.team))
      .filter((k) => tab.has(k)),
  );
  if (r1.size === 0 && withheldPrelims(inputs.pieces).has(1)) {
    return result('team_coverage', 'na', 'The tournament withholds its R1 results.');
  }
  const share = r1.size / tab.size;
  const status: CheckStatus = share < 0.8 ? 'fail' : share < 0.95 ? 'warn' : 'pass';
  return result(
    'team_coverage',
    status,
    `R1 has ${r1.size} teams; the team tab has ${tab.size}.`,
    status === 'pass' ? [] : pieces,
  );
}

export function checkPartners(inputs: AuditInputs): CheckResult {
  const tab = [...teamTabKeys(inputs)];
  if (tab.length === 0) {
    const detail = isWithheld(inputs.pieces, 'team')
      ? 'The tournament withholds its team tab.'
      : 'There is no team tab to check partners on.';
    return result('partners', 'na', detail);
  }
  const min = minSpeakers(inputs.format);
  const counts = new Map<string, number>();
  for (const [team, n] of Object.entries(inputs.speakersByTeam)) {
    counts.set(teamKey(team), (counts.get(teamKey(team)) ?? 0) + n);
  }
  const short = tab.filter((t) => (counts.get(t) ?? 0) < min).length;
  if (short === 0) {
    return result(
      'partners',
      'pass',
      `All ${tab.length} teams have at least ${min} speakers on record.`,
    );
  }
  return result(
    'partners',
    short / tab.length > 0.1 ? 'fail' : 'warn',
    `${short} of ${tab.length} teams ${plural(short, 'has', 'have')} fewer than ${min} speakers on record.`,
    [tabPiece(inputs.pieces, 'speaker')],
  );
}

/**
 * Panels are judged only where every judge's panels were stored. A private-URL
 * ingest stores just the URL owner's own rounds, so a tournament known only
 * that way would look as if every room had no chair; the 50% rule tells the
 * two apart and returns na rather than a false fail.
 */
export function checkPanels(inputs: AuditInputs): CheckResult {
  const { judgeParticipants: all, roundResultJudges: stored } = inputs;
  if (all === 0) return result('panels', 'na', 'No judges are on record.');
  if (stored < 0.5 * all) {
    return result(
      'panels',
      'na',
      `Panels are stored for ${stored} of ${all} judges, too few to check.`,
    );
  }
  const rooms = roomsByRound(inputs);
  if (rooms.size === 0) return result('panels', 'na', 'No prelim round results are stored.');
  const short = [...rooms]
    .map(([round, n]) => ({
      round,
      n,
      ...(inputs.judgesByRound[round] ?? { chairs: 0, judges: 0 }),
    }))
    .filter((r) => Math.min(r.chairs, r.judges) < r.n);
  if (short.length === 0) {
    return result('panels', 'pass', 'Every prelim round has a chair and a judge for each room.');
  }
  const listed = listText(
    short.map((r) => `R${r.round} has ${r.chairs} chairs and ${r.judges} judges for ${r.n} rooms`),
  );
  // The spec's only line is 90%: a round at 90% or more of its rooms passes
  // at full weight (a room or two can run a scratch panel), though the
  // detail still names the shortfall.
  const failing = short.filter((r) => Math.min(r.chairs, r.judges) < 0.9 * r.n);
  if (failing.length === 0) return result('panels', 'pass', `${listed}, within 90% of rooms.`);
  return result(
    'panels',
    'fail',
    `${listed}.`,
    failing.map((r) => prelimPiece(inputs.pieces, r.round)),
  );
}

type Mismatch = { team: string; tab: number; sum: number; missing: number[]; played: number[] };

/**
 * Teams whose tab total differs from their prelim rows. Skipped rather than
 * counted: a team with a null value on the tab or on any of its rows (the
 * column was not published, which is not a mismatch); a team with no rows at
 * all (its name differs between tab and rounds, which team_coverage already
 * marks down); and a team with no row in a round the tournament withholds
 * (the tab counts that round, the stored rows cannot).
 */
function pointMismatches(inputs: AuditInputs, field: 'points' | 'wins') {
  const byTeam = new Map<string, AuditInputs['roundRows']>();
  for (const r of prelimRows(inputs)) {
    byTeam.set(teamKey(r.team), [...(byTeam.get(teamKey(r.team)) ?? []), r]);
  }
  const expected = expectedPrelims(inputs);
  const hidden = withheldPrelims(inputs.pieces);
  let checked = 0;
  const off: Mismatch[] = [];
  for (const t of inputs.teamTab) {
    const rows = byTeam.get(teamKey(t.team)) ?? [];
    const tab = t[field];
    if (tab == null || rows.length === 0 || rows.some((r) => r[field] == null)) continue;
    const played = new Set(rows.map((r) => r.round));
    if (expected.some((n) => hidden.has(n) && !played.has(n))) continue;
    checked++;
    const sum = rows.reduce((s, r) => s + (r[field] ?? 0), 0);
    if (Math.abs(sum - tab) < 0.001) continue;
    off.push({
      team: t.team,
      tab,
      sum,
      missing: expected.filter((n) => !played.has(n)),
      played: [...played],
    });
  }
  return { checked, off };
}

/** Why no team could be checked, naming a withheld page when one is the reason. */
function noPointsDetail(inputs: AuditInputs, field: 'points' | 'wins'): string {
  if (inputs.teamTab.length === 0 && isWithheld(inputs.pieces, 'team')) {
    return 'The tournament withholds its team tab.';
  }
  const hidden = [...withheldPrelims(inputs.pieces)].sort((a, b) => a - b);
  if (hidden.length > 0) {
    const names = listText(hidden.map((n) => `R${n}`));
    return `The tournament withholds the results of ${names}, so no team's total can be checked.`;
  }
  return `No team has ${field} on both the team tab and the rounds.`;
}

export function checkPointsAddUp(inputs: AuditInputs): CheckResult {
  // Two-team tabs rank on wins, and their points column is often speaker
  // points rather than a team total, so wins are what must add up there.
  const field = teamsPerRoom(inputs.format, inputs.roundRows) === 2 ? 'wins' : 'points';
  const { checked, off } = pointMismatches(inputs, field);
  if (checked === 0) {
    return result('points_add_up', 'na', noPointsDetail(inputs, field));
  }
  if (off.length === 0) {
    return result(
      'points_add_up',
      'pass',
      `All ${checked} teams' tab ${field} equal their round totals.`,
    );
  }
  const first = off[0];
  const detail =
    `${off.length} of ${checked} teams ${plural(off.length, 'has', 'have')} tab ${field} that differ ` +
    `from ${plural(off.length, 'its', 'their')} round total (${first.team}: ${first.tab} on the tab, ` +
    `${first.sum} in the rounds).`;
  // The rounds involved: for a team short of a row, the rounds it has no row
  // in (the likeliest reason its total is short); for a team with every row,
  // a value in one of them is wrong and cannot be told apart, so all of its
  // rounds.
  const involved = off.flatMap((o) => (o.missing.length > 0 ? o.missing : o.played));
  const rounds = [...new Set(involved)].sort((a, b) => a - b);
  return result('points_add_up', off.length / checked > 0.05 ? 'fail' : 'warn', detail, [
    tabPiece(inputs.pieces, 'team'),
    ...rounds.map((n) => prelimPiece(inputs.pieces, n)),
  ]);
}
