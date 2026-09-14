import { describe, expect, test } from 'vitest';
import {
  formatStageForDisplay,
  formatBaseStageForDisplay,
  formatStageOrDash,
} from '@/lib/cv/formatStage';

describe('formatStageForDisplay', () => {
  test('"Open Finals", "Grand Final", and "Final" all collapse to "Final"', () => {
    // The whole reason this helper exists — these strings drift across
    // Tabbycat deployments but mean the same championship round.
    expect(formatStageForDisplay('Final')).toBe('Final');
    expect(formatStageForDisplay('Finals')).toBe('Final');
    expect(formatStageForDisplay('Open Final')).toBe('Final');
    expect(formatStageForDisplay('Open Finals')).toBe('Final');
    expect(formatStageForDisplay('Grand Final')).toBe('Final');
    expect(formatStageForDisplay('Grand Finals')).toBe('Final');
    expect(formatStageForDisplay('GF')).toBe('Final');
  });

  test('keeps the break category so an ESL run is not shown as the Open result', () => {
    // Regression: eliminationReached stores the raw landing-page label
    // ("ESL Grand Final"). Dropping the prefix rendered a bare "Final",
    // claiming a deeper run than the debater actually had — and combined
    // with wonTournament it read "Final (Champion)", i.e. won the whole
    // tournament outright.
    expect(formatStageForDisplay('ESL Grand Final')).toBe('ESL Final');
    expect(formatStageForDisplay('ESL Final')).toBe('ESL Final');
    expect(formatStageForDisplay('ESL Semifinals')).toBe('ESL Semifinals');
    expect(formatStageForDisplay('Novice Octofinals')).toBe('Novice Octofinals');
    expect(formatStageForDisplay('EFL QF')).toBe('EFL Quarterfinals');
  });

  test('"Open" is the implicit default category and stays off the label', () => {
    // Bare labels and Open-prefixed labels mean the same bracket, so
    // showing "Open Quarterfinals" for one and "Quarterfinals" for the
    // other would reintroduce the inconsistency this helper removes.
    expect(formatStageForDisplay('Open Quarterfinals')).toBe('Quarterfinals');
    expect(formatStageForDisplay('Quarterfinals')).toBe('Quarterfinals');
  });

  test('canonicalises abbreviation forms', () => {
    expect(formatStageForDisplay('QF')).toBe('Quarterfinals');
    expect(formatStageForDisplay('SF')).toBe('Semifinals');
    expect(formatStageForDisplay('OF')).toBe('Octofinals');
    expect(formatStageForDisplay('Quarters')).toBe('Quarterfinals');
    expect(formatStageForDisplay('Semis')).toBe('Semifinals');
  });

  test('maps "Round of 16" / "Round of 32" to canonical octofinal stages', () => {
    expect(formatStageForDisplay('Round of 16')).toBe('Octofinals');
    expect(formatStageForDisplay('Round of 32')).toBe('Double Octofinals');
  });

  test('null / empty / unknown labels degrade gracefully', () => {
    expect(formatStageForDisplay(null)).toBe('');
    expect(formatStageForDisplay(undefined)).toBe('');
    expect(formatStageForDisplay('')).toBe('');
    // Unknown labels (prelims, garbage) pass through as-is so we never
    // hide data the classifier hasn't been taught to recognise.
    expect(formatStageForDisplay('Round 3')).toBe('Round 3');
    expect(formatStageForDisplay('Something Weird')).toBe('Something Weird');
  });
});

describe('formatBaseStageForDisplay', () => {
  test('strips every category prefix, for callers that render one themselves', () => {
    // The eliminationReachedByCategory call sites print `${category}: ${stage}`,
    // so the stage half must not repeat the category ("ESL: ESL Final").
    expect(formatBaseStageForDisplay('ESL Grand Final')).toBe('Final');
    expect(formatBaseStageForDisplay('ESL Semifinals')).toBe('Semifinals');
    expect(formatBaseStageForDisplay('Novice Octofinals')).toBe('Octofinals');
    expect(formatBaseStageForDisplay('Open Quarterfinals')).toBe('Quarterfinals');
    expect(formatBaseStageForDisplay('Grand Final')).toBe('Final');
  });

  test('null / empty / unknown labels degrade gracefully', () => {
    expect(formatBaseStageForDisplay(null)).toBe('');
    expect(formatBaseStageForDisplay('')).toBe('');
    expect(formatBaseStageForDisplay('Round 3')).toBe('Round 3');
  });
});

describe('formatStageOrDash', () => {
  test('canonicalises judging stages so both CV tables speak one vocabulary', () => {
    // The judging rows printed raw labels while the speaking table above
    // them was canonicalised — the same page showed "Final" in one table
    // and "GF" in the other.
    expect(formatStageOrDash('GF')).toBe('Final');
    expect(formatStageOrDash('Grand Final')).toBe('Final');
    expect(formatStageOrDash('ESL Semifinals')).toBe('ESL Semifinals');
    expect(formatStageOrDash('QF')).toBe('Quarterfinals');
  });

  test('renders an em dash when there is no stage', () => {
    expect(formatStageOrDash(null)).toBe('—');
    expect(formatStageOrDash(undefined)).toBe('—');
    expect(formatStageOrDash('')).toBe('—');
  });
});
