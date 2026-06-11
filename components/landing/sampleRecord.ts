/**
 * The sample record dataset (teardown ruling D5): one hand-authored,
 * believable fictional season arc. Real tournament names, a fictional
 * debater, and deliberate noise — early no-breaks, a missed-on-speaks row,
 * an off year mid-peak — because the audience reads tabs for sport and can
 * smell a fake one instantly. A spotless record would cost us credibility;
 * the arc (novice → first breaks → majors) IS the sales argument.
 *
 * Numbers must reconcile: the masthead stats below are derived from these
 * rows, never hardcoded apart from them.
 */

export type SampleSpeakerRow = {
  year: number;
  tournament: string;
  format: 'BP' | 'Asian' | 'Australs';
  partner: string;
  teamRank: string;
  avg: number;
  /** Open-tab speaker rank, when the sample debater placed notably. */
  spkRank: string | null;
  /** Outround reached / title, null when the team didn't break. */
  result: string | null;
  broke: boolean;
};

export type SampleJudgeRow = {
  year: number;
  tournament: string;
  format: 'BP' | 'Asian' | 'Australs';
  prelims: number;
  chaired: number;
  /** Deepest outround judged, null when none. */
  outround: string | null;
};

export const SAMPLE_NAME = 'Maya Rao';

export const sampleSpeakerRows: SampleSpeakerRow[] = [
  // 2022 — novice year: mostly mid-tab, one novice title.
  { year: 2022, tournament: 'Mumbai Open', format: 'BP', partner: 'S. Iyer', teamRank: '41st', avg: 67.2, spkRank: null, result: null, broke: false },
  { year: 2022, tournament: 'Hyderabad IV', format: 'BP', partner: 'S. Iyer', teamRank: '23rd', avg: 68.4, spkRank: null, result: null, broke: false },
  { year: 2022, tournament: 'NLSIU IV', format: 'BP', partner: 'A. Sen', teamRank: '14th', avg: 70.1, spkRank: null, result: null, broke: false },
  { year: 2022, tournament: 'University Novice Championship', format: 'BP', partner: 'S. Iyer', teamRank: '3rd', avg: 69.7, spkRank: '#5', result: 'Champion', broke: true },

  // 2023 — first open breaks, one near miss, one title.
  { year: 2023, tournament: 'Jadavpur IV', format: 'BP', partner: 'A. Sen', teamRank: '9th', avg: 71.3, spkRank: '#12', result: 'Quarterfinalist', broke: true },
  { year: 2023, tournament: 'IIT Bombay IV', format: 'BP', partner: 'A. Sen', teamRank: '13th', avg: 70.8, spkRank: null, result: null, broke: false },
  { year: 2023, tournament: 'United Asians Debating Championship', format: 'Asian', partner: 'A. Sen, R. Tan', teamRank: '21st', avg: 72.0, spkRank: null, result: 'Octofinalist', broke: true },
  { year: 2023, tournament: 'Hart House IV', format: 'BP', partner: 'L. Novak', teamRank: '2nd', avg: 74.2, spkRank: '#4', result: 'Champion', broke: true },

  // 2024 — the majors year.
  { year: 2024, tournament: 'World Universities Debating Championship', format: 'BP', partner: 'L. Novak', teamRank: '33rd', avg: 73.8, spkRank: '#38', result: 'Octofinalist', broke: true },
  { year: 2024, tournament: 'Australs', format: 'Australs', partner: 'A. Sen, R. Tan', teamRank: '12th', avg: 72.9, spkRank: null, result: 'Quarterfinalist', broke: true },
  { year: 2024, tournament: 'NUS IV', format: 'BP', partner: 'L. Novak', teamRank: '5th', avg: 73.1, spkRank: '#7', result: 'Semifinalist', broke: true },
  { year: 2024, tournament: 'Asia BP', format: 'BP', partner: 'L. Novak', teamRank: '8th', avg: 73.5, spkRank: '#11', result: 'Finalist', broke: true },

  // 2025 — deeper at the majors, one flat IV (even good years have one).
  { year: 2025, tournament: 'World Universities Debating Championship', format: 'BP', partner: 'L. Novak', teamRank: '24th', avg: 74.6, spkRank: '#21', result: 'Quarterfinalist', broke: true },
  { year: 2025, tournament: 'Australs', format: 'Australs', partner: 'A. Sen, R. Tan', teamRank: '9th', avg: 73.4, spkRank: '#14', result: 'Semifinalist', broke: true },
  { year: 2025, tournament: 'Madras IV', format: 'BP', partner: 'D. Cruz', teamRank: '11th', avg: 72.2, spkRank: null, result: null, broke: false },
];

export const sampleJudgeRows: SampleJudgeRow[] = [
  { year: 2023, tournament: 'Cambridge IV', format: 'BP', prelims: 6, chaired: 2, outround: null },
  { year: 2024, tournament: 'Delhi Pre-Worlds', format: 'BP', prelims: 5, chaired: 4, outround: 'Quarterfinal · chair' },
  { year: 2025, tournament: 'Mumbai Open', format: 'BP', prelims: 6, chaired: 6, outround: 'Grand final · chair' },
  { year: 2026, tournament: 'United Asians Debating Championship', format: 'Asian', prelims: 8, chaired: 5, outround: 'Semifinal · panel' },
];

// Derived masthead stats — computed so the headline numbers always
// reconcile with the visible rows (the audience checks receipts).
const breaks = sampleSpeakerRows.filter((r) => r.broke).length;
const bestAvg = Math.max(...sampleSpeakerRows.map((r) => r.avg));
const years = [...sampleSpeakerRows, ...sampleJudgeRows].map((r) => r.year);
const titles = sampleSpeakerRows.filter((r) => r.result === 'Champion').length;

export const sampleStats = {
  tournaments: sampleSpeakerRows.length + sampleJudgeRows.length,
  breaks,
  titles,
  bestAvg: bestAvg.toFixed(1),
  span: `${Math.min(...years)}–${String(Math.max(...years)).slice(2)}`,
};

// Factual growth lines — explainable from the rows above, per design doc §9.
export const sampleGrowthLines = [
  'Speaker average up 7.4 points from the first 2022 tab to the 2025 peak.',
  `Breaks in ${breaks} of ${sampleSpeakerRows.length} speaker entries — none in the first three, then 10 of the last 12.`,
  'Judging appears from 2023 and deepens: two chairs, then outround chairs by 2024.',
];
