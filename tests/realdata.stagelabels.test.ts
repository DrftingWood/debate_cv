/**
 * Stage labels observed in the wild.
 *
 * Every string here was harvested from the nav of a real tournament in the
 * corpus (tests/__corpus.live.test.ts), with the occurrence count from that
 * sweep. They are pinned as a fixture so the expectations stay checkable
 * without the corpus on disk.
 *
 * classifyOutroundStage is matched against English stage names. Tabbycat is
 * used worldwide, and the failure mode is not a missing label — it is a
 * WRONG one, because the final fallback `\bfinals?\b` matches the word
 * "Final" inside "Cuartos de Final" (quarterfinals) and "Doble-Octavos de
 * final" (double-octofinals). Those rounds are then reported as the
 * tournament final.
 */

import { describe, expect, test } from 'vitest';
import { classifyOutroundStage, normalizeStageLabel } from '@/lib/calicotab/judgeStats';
import { formatStageForDisplay } from '@/lib/cv/formatStage';

const classify = (s: string) => classifyOutroundStage(normalizeStageLabel(s));

describe('Spanish and Portuguese stage labels', () => {
  test('a Spanish quarterfinal is not reported as the final', () => {
    // "Cuartos de Final" = quarterfinals. Seen 5x in the corpus.
    expect(classify('Cuartos de Final')).toBe('quarterfinal');
  });

  test('a Spanish double-octofinal is not reported as the final', () => {
    // "Doble-Octavos de final" = double octofinals.
    expect(classify('Doble-Octavos de final')).toBe('double_octofinal');
  });

  test('"Gran Final" is the grand final', () => {
    // Seen 7x. Currently classifies as `final` rather than `grand_final`,
    // which is the milder version of the same gap.
    expect(classify('Gran Final')).toBe('grand_final');
  });

  test('Portuguese outrounds classify', () => {
    expect(classify('Semifinais')).toBe('semifinal');
    expect(classify('Quartas de Final')).toBe('quarterfinal');
  });

  test('the displayed label for a Spanish quarterfinal does not read as a final', () => {
    // The user-visible consequence: this string lands in eliminationReached
    // and is rendered verbatim on the CV and the public page.
    expect(formatStageForDisplay('Cuartos de Final')).not.toBe('Final');
  });
});

describe('break categories observed in the wild', () => {
  // Each of these is a real round label; the leading token is the break
  // category. Dropping it turns a secondary-bracket run into a claim about
  // the main bracket — the same defect already fixed for ESL/EFL/Novice.
  const REAL_LABELS: Array<[string, string]> = [
    ['Gold Final', 'Gold'],
    ['Bronze Finals', 'Bronze'],
    ['Silver Final', 'Silver'],
    ['HS Grand Finals', 'HS'],
    ['College Semifinals', 'College'],
    ['Elementary Quarterfinals', 'Elementary'],
    ['English as a Second Language Finals', 'English as a Second Language'],
  ];

  test.each(REAL_LABELS)('%s keeps its category on the CV', (label, category) => {
    const shown = formatStageForDisplay(label);
    expect(shown.toLowerCase()).toContain(category.toLowerCase().split(' ')[0]!);
  });
});
