import { describe, expect, test } from 'vitest';
import { parseRoundResults, parseParticipantsList } from '@/lib/calicotab/parseTabs';

describe('parseRoundResults — isOutround classification', () => {
  test('R6 on a prelim page is NOT an outround (old heuristic misfired)', () => {
    const html = `
      <table>
        <thead><tr><th>Team</th><th>Position</th><th>Points</th></tr></thead>
        <tbody><tr><td>Alpha</td><td>OG</td><td>3</td></tr></tbody>
      </table>
    `;
    const round = parseRoundResults(html, 'https://h.calicotab.com/t/results/round/6/');
    expect(round.isOutround).toBe(false);
    expect(round.roundNumber).toBe(6);
  });

  test('URL under /break/ is an outround', () => {
    const html = `<html><body><h2>Break Round 1</h2></body></html>`;
    const round = parseRoundResults(html, 'https://h.calicotab.com/t/break/teams/open/');
    expect(round.isOutround).toBe(true);
  });

  test('page title mentioning "Grand Final" is an outround', () => {
    const html = `<h1>Grand Final — Results</h1>`;
    const round = parseRoundResults(html, 'https://h.calicotab.com/t/results/round/9/');
    expect(round.isOutround).toBe(true);
  });
});

describe('parseRoundResults — judge extraction', () => {
  test('extracts chairs and panelists without double-counting across passes', () => {
    const html = `
      <table>
        <thead>
          <tr>
            <th>Team</th>
            <th>Position</th>
            <th>Points</th>
            <th>Adjudicators</th>
            <th>Role</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Alpha</td>
            <td>OG</td>
            <td>3</td>
            <td>Jane Doe (Chair), John Roe</td>
            <td>chair</td>
          </tr>
          <tr>
            <td>Beta</td>
            <td>OO</td>
            <td>2</td>
            <td>Jane Doe (Chair), John Roe</td>
            <td>chair</td>
          </tr>
        </tbody>
      </table>
    `;
    const round = parseRoundResults(html, 'https://h.calicotab.com/t/results/round/1/by-debate/');
    const names = round.judgeAssignments.map((j) => j.personName);
    expect(new Set(names).size).toBe(names.length); // no duplicates
    const chair = round.judgeAssignments.find((j) => j.personName === 'Jane Doe');
    expect(chair?.panelRole).toBe('chair');
    // teamResults come from both rows
    expect(round.teamResults).toHaveLength(2);
  });
});

describe('parseParticipantsList — judgeTag', () => {
  test('recognizes British spelling "subsidised"', () => {
    const html = `
      <table>
        <thead><tr><th>Name</th><th>Role</th></tr></thead>
        <tbody><tr><td>Ada L</td><td>Subsidised Adjudicator</td></tr></tbody>
      </table>
    `;
    const rows = parseParticipantsList(html);
    expect(rows[0]!.judgeTag).toBe('subsidized');
    expect(rows[0]!.role).toBe('adjudicator');
  });

  test('recognizes "Independent Adjudicator" as invited', () => {
    const html = `
      <table>
        <thead><tr><th>Name</th><th>Role</th></tr></thead>
        <tbody><tr><td>Ada L</td><td>Independent Adjudicator</td></tr></tbody>
      </table>
    `;
    const rows = parseParticipantsList(html);
    expect(rows[0]!.judgeTag).toBe('invited');
  });

  test('plain "Adjudicator" label gives judgeTag=normal', () => {
    const html = `
      <table>
        <thead><tr><th>Name</th><th>Role</th></tr></thead>
        <tbody><tr><td>Ada L</td><td>Adjudicator</td></tr></tbody>
      </table>
    `;
    const rows = parseParticipantsList(html);
    expect(rows[0]!.judgeTag).toBe('normal');
  });
});
