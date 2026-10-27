import { describe, expect, it } from 'vitest';
import {
  batchParams,
  beforeCsv,
  buildApplySql,
  chunk,
  classifyPending,
  conflictCsv,
  csvField,
  parseArgs,
  summarisePlan,
  type PendingGroupRow,
} from '../scripts/lib/tag-approval-plan.mjs';
import { directConnectionString } from '../scripts/lib/neon-connection.mjs';

const row = (
  r: Partial<PendingGroupRow> & Pick<PendingGroupRow, 'kind' | 'value'>,
): PendingGroupRow => ({
  tournamentId: '1',
  motionId: null,
  n: 1,
  current: null,
  tournamentName: 'Open',
  ...r,
});

describe('classifyPending', () => {
  it('approves a target whose pending proposals agree, counting duplicates', () => {
    const plan = classifyPending([row({ kind: 'region', value: 'Europe', n: 3 })]);
    expect(plan.agreed).toEqual([
      expect.objectContaining({
        kind: 'region',
        tournamentId: '1',
        motionId: null,
        value: 'Europe',
        proposals: 3,
      }),
    ]);
    expect(plan.conflicts).toEqual([]);
  });

  it('leaves a target with two different pending values as a conflict', () => {
    const plan = classifyPending([
      row({ kind: 'motion_topic', motionId: '9', value: 'Economics', n: 2 }),
      row({ kind: 'motion_topic', motionId: '9', value: 'Environment', n: 1 }),
    ]);
    expect(plan.agreed).toEqual([]);
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.conflicts[0]).toMatchObject({
      kind: 'motion_topic',
      motionId: '9',
      proposals: 3,
      values: [
        { value: 'Economics', n: 2 },
        { value: 'Environment', n: 1 },
      ],
    });
  });

  it('keys motion tags by motion and kind, so type and topic on one motion are separate targets', () => {
    const plan = classifyPending([
      row({ kind: 'motion_type', motionId: '9', value: 'THW' }),
      row({ kind: 'motion_topic', motionId: '9', value: 'Economics' }),
      row({ kind: 'motion_topic', motionId: '10', value: 'Health' }),
    ]);
    expect(plan.agreed.map((a) => `${a.kind}:${a.motionId}:${a.value}`)).toEqual([
      'motion_topic:9:Economics',
      'motion_topic:10:Health',
      'motion_type:9:THW',
    ]);
  });

  it('skips malformed targets instead of guessing', () => {
    const plan = classifyPending([
      row({ kind: 'region', motionId: '4', value: 'Asia' }),
      row({ kind: 'motion_type', motionId: null, value: 'THW' }),
      row({ kind: 'motion_type', motionId: '7', tournamentId: '1', value: 'THBT' }),
      row({ kind: 'motion_type', motionId: '7', tournamentId: '2', value: 'THBT' }),
    ]);
    expect(plan.agreed).toEqual([]);
    expect(plan.malformed.map((m) => m.reason).sort()).toEqual([
      'motion proposal has no motion id',
      'proposals for this motion name different tournaments',
      'region proposal carries a motion id',
    ]);
  });

  it('ignores kinds it does not know', () => {
    const plan = classifyPending([row({ kind: 'colour', value: 'red', n: 4 })]);
    expect(plan.ignored).toBe(4);
    expect(plan.agreed).toEqual([]);
  });
});

describe('summarisePlan', () => {
  it('separates unset, overwrite and already-equal targets', () => {
    const plan = classifyPending([
      row({ kind: 'region', tournamentId: '1', value: 'Europe' }),
      row({ kind: 'region', tournamentId: '2', value: 'Europe', current: 'Asia' }),
      row({ kind: 'region', tournamentId: '3', value: 'Europe', current: 'Europe', n: 2 }),
      row({ kind: 'region', tournamentId: '4', value: 'Europe' }),
      row({ kind: 'region', tournamentId: '4', value: 'Asia' }),
    ]);
    expect(summarisePlan(plan).region).toEqual({
      agreedTargets: 3,
      agreedProposals: 4,
      wouldSet: 1,
      wouldOverwrite: 1,
      alreadyEqual: 1,
      conflictTargets: 1,
      conflictProposals: 2,
      malformedTargets: 0,
      malformedProposals: 0,
    });
  });
});

describe('parseArgs', () => {
  it('defaults to a dry run over all kinds', () => {
    expect(parseArgs([])).toEqual({
      apply: false,
      kind: null,
      out: './tag-approval-output',
      batch: 2000,
    });
  });

  it('reads --apply, --kind, --out and --batch', () => {
    expect(parseArgs(['--apply', '--kind', 'motion_type', '--out', 'x', '--batch', '500'])).toEqual(
      {
        apply: true,
        kind: 'motion_type',
        out: 'x',
        batch: 500,
      },
    );
  });

  it('rejects a mistyped kind or flag rather than falling back to all kinds', () => {
    expect(() => parseArgs(['--kind', 'regions'])).toThrow(/--kind/);
    expect(() => parseArgs(['--aply'])).toThrow(/Unknown argument/);
    expect(() => parseArgs(['--batch', '0'])).toThrow(/--batch/);
  });
});

describe('buildApplySql', () => {
  it('writes only the canonical column of the kind plus status and reviewedAt', () => {
    const sql = buildApplySql('motion_topic');
    expect(sql).toContain('UPDATE "Motion" c SET topic = a.value');
    expect(sql).toContain(`UPDATE "TagProposal" p SET status = 'approved', "reviewedAt" =`);
    expect(sql).not.toMatch(/adminNote|updatedAt|"motionType"|region/);
  });

  it('targets the tournament for region and requires region proposals to carry no motion', () => {
    const sql = buildApplySql('region');
    expect(sql).toContain('UPDATE "Tournament" c SET region = a.value');
    expect(sql).toContain('p."motionId" IS NULL');
  });

  it('refuses an unknown kind', () => {
    expect(() => buildApplySql('x; DROP TABLE "TagProposal"')).toThrow(/Unknown tag kind/);
  });
});

describe('batching and CSV', () => {
  it('chunks into fixed-size batches', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('encodes missing motion ids as empty strings for the SQL arrays', () => {
    expect(
      batchParams([
        { tournamentId: '1', motionId: null, value: 'Europe' },
        { tournamentId: '2', motionId: '5', value: 'THW' },
      ]),
    ).toEqual([
      ['1', '2'],
      ['', '5'],
      ['Europe', 'THW'],
    ]);
  });

  it('quotes CSV fields that need it', () => {
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField(null)).toBe('');
  });

  it('lists conflicts with their values and the previous canonical values', () => {
    const plan = classifyPending([
      row({ kind: 'region', tournamentId: '4', value: 'Europe', tournamentName: 'Worlds, 2026' }),
      row({ kind: 'region', tournamentId: '4', value: 'Asia' }),
      row({ kind: 'region', tournamentId: '5', value: 'Asia', current: 'Europe' }),
    ]);
    expect(conflictCsv(plan).split('\n')[1]).toBe(
      'region,4,"Worlds, 2026",,,Asia (1) | Europe (1),2,conflict',
    );
    expect(beforeCsv(plan.agreed).split('\n')[1]).toBe('region,5,,Europe,Asia');
  });
});

describe('directConnectionString', () => {
  it('switches a pooled host to direct and drops channel_binding', () => {
    const out = directConnectionString(
      "psql 'postgresql://u:p@ep-x-pooler.eu.aws.neon.tech/db?sslmode=require&channel_binding=require'",
    );
    expect(out).toBe('postgresql://u:p@ep-x.eu.aws.neon.tech/db?sslmode=require');
  });

  it('does not echo the input when nothing usable was pasted', () => {
    expect(() => directConnectionString('secret-password')).toThrow(/^No postgresql/);
    try {
      directConnectionString('secret-password');
    } catch (e) {
      expect(String(e)).not.toContain('secret-password');
    }
  });
});
