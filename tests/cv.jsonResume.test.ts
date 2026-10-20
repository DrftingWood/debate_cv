import { describe, expect, it } from 'vitest';
import { buildJsonResume, DEBATE_EXTENSION_KEY, JSON_RESUME_SCHEMA } from '@/lib/cv/jsonResume';
import { makeCvData, makeJudgeRow, makeSpeakerRow } from './setup/cv-fixtures';

const NOW = new Date('2026-10-20T00:00:00Z');

describe('buildJsonResume', () => {
  it('is a v1.0.0 JSON Resume with the record in a debate extension, newest first', () => {
    const doc = buildJsonResume(
      makeCvData({
        speakerRows: [
          makeSpeakerRow({ tournamentName: 'Old IV', year: 2023 }),
          makeSpeakerRow({ tournamentName: 'New Open', year: 2025 }),
          makeSpeakerRow({ tournamentName: 'Undated', year: null }),
        ],
        judgeRows: [],
      }),
      { now: NOW, canonical: 'https://cv.example/cv.json' },
    );
    expect(doc.$schema).toBe(JSON_RESUME_SCHEMA);
    // canonical is the document's own URL; the schema URL belongs in $schema only.
    expect(doc.meta).toMatchObject({ canonical: 'https://cv.example/cv.json', version: 'v1.0.0', lastModified: NOW.toISOString() });
    expect(doc.basics).toEqual({ name: 'Test Person' });
    // v1.0.0 sets additionalProperties: false at the top level; only meta is open.
    expect(Object.keys(doc).sort()).toEqual(['$schema', 'awards', 'basics', 'meta']);
    expect(DEBATE_EXTENSION_KEY).toBe('x-debate-cv');
    expect(Object.keys(doc.meta)).toContain(DEBATE_EXTENSION_KEY);
    expect(doc.meta[DEBATE_EXTENSION_KEY].version).toBe(1);
    expect(doc.meta[DEBATE_EXTENSION_KEY].speaking.map((s) => s.tournament)).toEqual(['New Open', 'Old IV', 'Undated']);
  });

  it('omits meta.canonical when the serving URL is unknown', () => {
    const doc = buildJsonResume(makeCvData({ speakerRows: [], judgeRows: [] }), { now: NOW });
    expect('canonical' in doc.meta).toBe(false);
  });

  it('turns champion, break and top-ten speaker results into awards, and nothing else', () => {
    const doc = buildJsonResume(
      makeCvData({
        speakerRows: [
          makeSpeakerRow({ tournamentName: 'Won It', year: 2025, wonTournament: true, broke: true, speakerRankOpen: 3, teamName: 'X A' }),
          makeSpeakerRow({ tournamentName: 'Broke', year: 2024, broke: true, wonTournament: false, eliminationReached: 'Semifinals', speakerRankOpen: 40 }),
          makeSpeakerRow({ tournamentName: 'Top Speaker', year: 2024, broke: false, wonTournament: null, speakerRankOpen: 11 }),
          makeSpeakerRow({ tournamentName: 'Tenth', year: 2023, broke: false, wonTournament: null, speakerRankOpen: 10, teamName: null }),
          makeSpeakerRow({ tournamentName: 'Nothing', year: 2023, broke: false, wonTournament: null, speakerRankOpen: 50 }),
        ],
        judgeRows: [
          makeJudgeRow({ tournamentName: 'Judged Break', year: 2024, broke: true, lastOutroundChaired: 'Quarterfinals' }),
          makeJudgeRow({ tournamentName: 'Judged Only', year: 2024, broke: false }),
        ],
      }),
      { now: NOW },
    );
    expect(doc.awards).toEqual([
      { title: 'Champion', date: '2025', awarder: 'Won It', summary: '3rd best speaker; Team X A' },
      expect.objectContaining({ title: 'Broke — reached Semifinals', awarder: 'Broke' }),
      { title: '10th best speaker', date: '2023', awarder: 'Tenth' },
      { title: 'Broke as adjudicator — Quarterfinals', date: '2024', awarder: 'Judged Break' },
    ]);
  });
});
