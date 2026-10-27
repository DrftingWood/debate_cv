import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';
import { buildJsonResume, DEBATE_EXTENSION_KEY } from '@/lib/cv/jsonResume';
import { makeCvData, makeJudgeRow, makeSpeakerRow } from './setup/cv-fixtures';

// Validates the /cv.json document against the official JSON Resume schemas
// (vendored in tests/fixtures/json-resume, see its README) and the debate
// extension against its own schema in docs/.
//
// Two JSON Resume versions on purpose: v1.0.0 (draft-04, the URL the
// document's $schema names) forbids unknown top-level keys; the current
// @jsonresume/schema 1.3.1 (draft-07) allows them. Passing both is what lets
// older and newer tooling read the same file.

const root = join(__dirname, '..');
const readJson = (rel: string) => JSON.parse(readFileSync(join(root, rel), 'utf8')) as object;

function validator(schemaRel: string) {
  // schemaId 'auto' + the draft-04 meta-schema lets one Ajv 6 instance
  // compile both the draft-04 and the draft-07 schema.
  const ajv = new Ajv({ schemaId: 'auto', allErrors: true });
  ajv.addMetaSchema(readJson('node_modules/ajv/lib/refs/json-schema-draft-04.json'));
  const validate = ajv.compile(readJson(schemaRel));
  return (doc: unknown) => {
    const ok = validate(doc) as boolean;
    return { ok, errors: ajv.errorsText(validate.errors) };
  };
}

const validators = {
  'JSON Resume v1.0.0': validator('tests/fixtures/json-resume/schema-v1.0.0.json'),
  'JSON Resume 1.3.1 (current)': validator('tests/fixtures/json-resume/schema-1.3.1.json'),
};
const validateExtension = validator('docs/json-resume-debate-extension.schema.json');
const validateExtensionV1 = validator('docs/json-resume-debate-extension.v1.schema.json');

const NOW = new Date('2026-10-20T10:00:00Z');

// A record that exercises every award path and the nullable fields.
const fullRecord = makeCvData({
  speakerRows: [
    makeSpeakerRow({
      tournamentName: 'Won It',
      year: 2025,
      wonTournament: true,
      broke: true,
      speakerRankOpen: 3,
      teamName: 'X A',
      teamRank: 1,
      teamPoints: '21',
      teamWins: 7,
      speakerAvgScore: '78.4',
      speakerCategories: ['ESL'],
      eliminationReached: 'Grand Final',
    }),
    makeSpeakerRow({
      tournamentName: 'Broke',
      year: 2024,
      broke: true,
      wonTournament: false,
      eliminationReached: 'Semifinals',
      speakerRankOpen: 40,
    }),
    makeSpeakerRow({
      tournamentName: 'Tenth',
      year: 2023,
      speakerRankOpen: 10,
      teamName: null,
      teammates: [],
    }),
    makeSpeakerRow({ tournamentName: 'Undated', year: null, format: null, totalTeams: null }),
  ],
  judgeRows: [
    makeJudgeRow({
      tournamentName: 'Judged Break',
      year: 2024,
      broke: true,
      lastOutroundChaired: 'Quarterfinals',
      judgeTypeTag: 'core',
      inroundsJudged: 6,
      inroundsChaired: 4,
    }),
    makeJudgeRow({ tournamentName: 'Judged Only', year: null, broke: false }),
  ],
});

const docs = {
  'a full record': buildJsonResume(fullRecord, {
    now: NOW,
    canonical: 'https://debate-cv.vercel.app/cv.json',
  }),
  'an empty record with no canonical URL': buildJsonResume(
    makeCvData({ speakerRows: [], judgeRows: [] }),
    { now: NOW },
  ),
};

describe('JSON Resume export validates against the official schemas', () => {
  for (const [schemaName, validate] of Object.entries(validators)) {
    for (const [docName, doc] of Object.entries(docs)) {
      it(`${docName} is valid against ${schemaName}`, () => {
        const result = validate(doc);
        expect(result.errors).toBe('No errors');
        expect(result.ok).toBe(true);
      });
    }
  }

  it('the validators are live: v1.0.0 rejects a top-level extension key, both reject a bad award date', () => {
    const doc = docs['a full record'];
    expect(validators['JSON Resume v1.0.0']({ ...doc, debate: {} }).ok).toBe(false);
    const badDate = { ...doc, awards: [{ title: 'x', awarder: 'y', date: '20th May' }] };
    for (const validate of Object.values(validators)) expect(validate(badDate).ok).toBe(false);
  });
});

describe('extension versioning: v1 documents stay valid against the v1 schema', () => {
  const v1 = readJson('tests/fixtures/debate-extension/v1-export.json');

  it('a stored pre-v2 export validates against the v1 schema and not the v2 one', () => {
    const result = validateExtensionV1(v1);
    expect(result.errors).toBe('No errors');
    expect(result.ok).toBe(true);
    expect(validateExtension(v1).ok).toBe(false);
  });

  it('a v2 export carries the split summary and is not valid v1', () => {
    const ext = docs['a full record'].meta[DEBATE_EXTENSION_KEY];
    expect(ext.version).toBe(2);
    expect(ext.summary).toEqual(
      expect.objectContaining({
        breaks: expect.any(Number),
        judgingBreaks: expect.any(Number),
        tournamentsSpoken: expect.any(Number),
        tournamentsJudged: expect.any(Number),
      }),
    );
    expect(validateExtensionV1(ext).ok).toBe(false);
  });
});

describe('the debate extension', () => {
  it('lives under meta["x-debate-cv"] and matches its published schema', () => {
    for (const doc of Object.values(docs)) {
      const result = validateExtension(doc.meta[DEBATE_EXTENSION_KEY]);
      expect(result.errors).toBe('No errors');
      expect(result.ok).toBe(true);
    }
  });

  it('the extension schema is strict, so code and schema cannot drift apart silently', () => {
    const ext = docs['a full record'].meta[DEBATE_EXTENSION_KEY];
    expect(validateExtension({ ...ext, extra: true }).ok).toBe(false);
    expect(validateExtension({ ...ext, version: 1 }).ok).toBe(false);
    expect(validateExtension({ ...ext, version: 3 }).ok).toBe(false);
    const { judgingBreaks: _omit, ...summaryWithoutJudging } = ext.summary;
    expect(validateExtension({ ...ext, summary: summaryWithoutJudging }).ok).toBe(false);
    expect(validateExtension({ ...ext, speaking: [{ ...ext.speaking[0], newField: 1 }] }).ok).toBe(
      false,
    );
  });
});
