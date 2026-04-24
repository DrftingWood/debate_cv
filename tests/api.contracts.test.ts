import { describe, expect, test } from 'vitest';
import { z } from 'zod';

/**
 * Contract tests for the API response shapes. We validate the JSON shape
 * that each route is documented to return, against the zod schema that
 * describes it. The goal is to catch accidental shape drift between the
 * server handler and the client code that consumes it.
 *
 * Each schema below is the authoritative response contract for its route.
 */

const DrainResponse = z.object({
  processed: z.number().int().nonnegative(),
  remaining: z.number().int().nonnegative(),
  results: z
    .array(
      z.object({
        url: z.string().optional(), // drain uses url; cron uses id
        id: z.string().optional(),
        status: z.enum(['done', 'failed', 'retry']),
        error: z.string().optional(),
      }),
    )
    .optional(),
});

const ScanResponse = z.object({
  scanned: z.number().int().nonnegative(),
  found: z.number().int().nonnegative(),
  perHost: z.record(z.number().int().nonnegative()),
  perTournament: z.record(z.number().int().nonnegative()),
});

const IngestUrlResponse = z.object({
  tournamentId: z.string(),
  fingerprint: z.string(),
  cached: z.boolean(),
  claimedPersonId: z.string().nullable(),
});

const ClaimResponse = z.object({
  ok: z.literal(true),
  personId: z.string().optional(),
});

const ErrorResponse = z.object({
  error: z.string(),
  details: z.unknown().optional(),
  hint: z.string().optional(),
});

describe('API contracts', () => {
  test('DrainResponse accepts a valid drain payload', () => {
    const payload = {
      processed: 3,
      remaining: 0,
      results: [
        { url: 'https://x.calicotab.com/t/privateurls/abc/', status: 'done' as const },
        { url: 'https://x.calicotab.com/t/privateurls/def/', status: 'retry' as const, error: 'timeout' },
      ],
    };
    expect(() => DrainResponse.parse(payload)).not.toThrow();
  });

  test('DrainResponse rejects negative remaining (guards off-by-one bugs)', () => {
    expect(() => DrainResponse.parse({ processed: 1, remaining: -1 })).toThrow();
  });

  test('ScanResponse accepts empty inbox scan', () => {
    expect(() =>
      ScanResponse.parse({ scanned: 0, found: 0, perHost: {}, perTournament: {} }),
    ).not.toThrow();
  });

  test('ScanResponse rejects non-numeric counts', () => {
    expect(() =>
      ScanResponse.parse({ scanned: '0', found: 0, perHost: {}, perTournament: {} }),
    ).toThrow();
  });

  test('IngestUrlResponse accepts null claimedPersonId', () => {
    expect(() =>
      IngestUrlResponse.parse({
        tournamentId: '123',
        fingerprint: 'abc',
        cached: false,
        claimedPersonId: null,
      }),
    ).not.toThrow();
  });

  test('ClaimResponse requires ok:true literal', () => {
    expect(() => ClaimResponse.parse({ ok: true, personId: '42' })).not.toThrow();
    expect(() => ClaimResponse.parse({ ok: false })).toThrow();
  });

  test('ErrorResponse accepts just { error }', () => {
    expect(() => ErrorResponse.parse({ error: 'unauthorized' })).not.toThrow();
  });
});
