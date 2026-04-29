import { describe, expect, test } from 'vitest';
import { extractSpeakerRounds } from '@/lib/calicotab/parseNav';

/**
 * Win detection on the user's Debates card. The user's own team is rendered
 * in <strong>; on outround stages Tabbycat adds a directional icon (green
 * up-arrow for advanced, red down-arrow for eliminated, occasionally a
 * trophy / check) next to the winning team. Detection is icon-class only
 * — bare colour classes like `text-success` no longer count, because
 * those fired on incidental cell styling (record badges, highlights) and
 * produced false-positive Champion markers.
 *
 * The HTML below uses Tabbycat's older server-rendered layout (no Vue
 * data island), which routes through the cheerio fallback in
 * extractSpeakerRounds. The Vue path runs the same detector against
 * cell.text + cell.class so behaviour is symmetric.
 */
describe('extractSpeakerRounds — win indicator detection', () => {
  test('green up-arrow + text-success on the team cell marks it as won', () => {
    const html = `
      <table class="debates">
        <thead><tr><th>Round</th><th>Team</th></tr></thead>
        <tbody>
          <tr>
            <td><span class="tooltip-trigger">Grand Final</span></td>
            <td class="team-name">
              <i class="bi bi-arrow-up-square text-success"></i>
              <strong>NH 48</strong>
            </td>
          </tr>
        </tbody>
      </table>
    `;
    const rows = extractSpeakerRounds(html, 'NH 48');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.stage).toMatch(/grand final/i);
    expect(rows[0]!.won).toBe(true);
  });

  test('text-success class alone (no icon) does NOT mark as won', () => {
    // Regression guard: this used to count as a positive signal.
    // Tournaments (e.g. Monash Open 2023) styled non-result text on the
    // team-name cell with text-success, which flipped runners-up into
    // false-positive Champions on the CV. Without an icon we no longer
    // commit either way.
    const html = `
      <table class="debates">
        <thead><tr><th>Round</th><th>Team</th></tr></thead>
        <tbody>
          <tr>
            <td><span class="tooltip-trigger">Grand Final</span></td>
            <td class="team-name text-success"><strong>Mysore 1</strong></td>
          </tr>
        </tbody>
      </table>
    `;
    const rows = extractSpeakerRounds(html, 'Mysore 1');
    expect(rows[0]!.won).toBeNull();
  });

  test('"won" word appearing inside an unrelated tooltip does not flip a non-winning row', () => {
    // The word-only signals ("won", "winner", "advanced") used to
    // match anywhere in the cell — including badges and tooltips that
    // narrate the team's overall record. Without an icon we ignore.
    const html = `
      <table class="debates">
        <thead><tr><th>Round</th><th>Team</th></tr></thead>
        <tbody>
          <tr>
            <td><span class="tooltip-trigger">Grand Final</span></td>
            <td class="team-name">
              <span title="Won 8 of 9 prelims">8-1</span>
              <strong>Runners-up</strong>
            </td>
          </tr>
        </tbody>
      </table>
    `;
    const rows = extractSpeakerRounds(html, 'Runners-up');
    expect(rows[0]!.won).toBeNull();
  });

  test('trophy icon variant counts as won', () => {
    const html = `
      <table class="debates">
        <thead><tr><th>Round</th><th>Team</th></tr></thead>
        <tbody>
          <tr>
            <td><span class="tooltip-trigger">Final</span></td>
            <td class="team-name">
              <i class="fa fa-trophy"></i>
              <strong>Champions</strong>
            </td>
          </tr>
        </tbody>
      </table>
    `;
    const rows = extractSpeakerRounds(html, 'Champions');
    expect(rows[0]!.won).toBe(true);
  });

  test('text-danger / arrow-down marks as lost', () => {
    const html = `
      <table class="debates">
        <thead><tr><th>Round</th><th>Team</th></tr></thead>
        <tbody>
          <tr>
            <td><span class="tooltip-trigger">Grand Final</span></td>
            <td class="team-name">
              <i class="bi bi-arrow-down text-danger"></i>
              <strong>Runners-up</strong>
            </td>
          </tr>
        </tbody>
      </table>
    `;
    const rows = extractSpeakerRounds(html, 'Runners-up');
    expect(rows[0]!.won).toBe(false);
  });

  test('no signal at all → won is null (do not guess)', () => {
    const html = `
      <table class="debates">
        <thead><tr><th>Round</th><th>Team</th></tr></thead>
        <tbody>
          <tr>
            <td><span class="tooltip-trigger">Round 3</span></td>
            <td class="team-name"><strong>Some Team</strong></td>
          </tr>
        </tbody>
      </table>
    `;
    const rows = extractSpeakerRounds(html, 'Some Team');
    expect(rows[0]!.won).toBeNull();
  });

  test('rows the user did not appear in are excluded entirely (won detection irrelevant)', () => {
    const html = `
      <table class="debates">
        <thead><tr><th>Round</th><th>Team</th></tr></thead>
        <tbody>
          <tr>
            <td><span class="tooltip-trigger">Final</span></td>
            <td class="team-name">
              <i class="bi bi-arrow-up text-success"></i>
              Other Team
            </td>
          </tr>
        </tbody>
      </table>
    `;
    // No <strong> on the cell, and the user's team name isn't there →
    // not their row, must not appear in output.
    const rows = extractSpeakerRounds(html, 'My Team');
    expect(rows).toHaveLength(0);
  });
});
