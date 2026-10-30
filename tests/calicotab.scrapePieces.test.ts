import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prismaMock, resetPrismaMock } from './setup/api-test-utils';

vi.mock('@/lib/db', () => import('./setup/api-test-utils').then((m) => ({ prisma: m.prismaMock })));

const { pieceRefForUrl, roundPieceLabel, retryDelayMs, recordPieceOutcomes } =
  await import('@/lib/calicotab/scrapePieces');

const NOW = new Date('2026-10-30T12:00:00Z');
const outcome = (over: Record<string, unknown> = {}) => ({
  kind: 'team' as const,
  key: '',
  label: 'Team tab',
  url: 'https://x.calicotab.com/t/tab/team/',
  ok: true,
  httpStatus: 200,
  error: null,
  ...over,
});

beforeEach(() => resetPrismaMock());

describe('pieceRefForUrl', () => {
  it('keys a round by its number', () => {
    expect(pieceRefForUrl('round', 'https://x.calicotab.com/t/results/round/3/')).toEqual({
      kind: 'round',
      key: '3',
    });
  });
  it('keys a round without a number by its path', () => {
    expect(pieceRefForUrl('round', 'https://x.calicotab.com/t/results/').key).toBe('/t/results/');
  });
  it('keys a break by its lower-cased last segment', () => {
    expect(pieceRefForUrl('break', 'https://x.calicotab.com/t/break/teams/ESL/')).toEqual({
      kind: 'break',
      key: 'esl',
    });
  });
  it('gives single tabs an empty key', () => {
    expect(pieceRefForUrl('team', 'https://x.calicotab.com/t/tab/team/')).toEqual({
      kind: 'team',
      key: '',
    });
  });
});

describe('roundPieceLabel', () => {
  it('abbreviates a numbered prelim', () => expect(roundPieceLabel(3, 'Round 3')).toBe('R3'));
  it('keeps an outround label', () =>
    expect(roundPieceLabel(7, 'Grand Final')).toBe('Grand Final'));
  it('falls back to the label when unnumbered', () =>
    expect(roundPieceLabel(null, 'Open Final')).toBe('Open Final'));
});

describe('retryDelayMs', () => {
  it('backs off 15 min, 1 h, 6 h, 24 h, then gives up', () => {
    expect([1, 2, 3, 4, 5, 9].map(retryDelayMs)).toEqual([
      900000,
      3600000,
      21600000,
      86400000,
      null,
      null,
    ]);
  });
});

describe('recordPieceOutcomes', () => {
  it('resets an ok piece and stamps loadedAt', async () => {
    prismaMock.scrapePiece.upsert.mockResolvedValue({});
    await recordPieceOutcomes(5n, [outcome()], NOW);
    const arg = prismaMock.scrapePiece.upsert.mock.calls[0][0];
    expect(arg.where).toEqual({
      tournamentId_kind_key: { tournamentId: 5n, kind: 'team', key: '' },
    });
    expect(arg.update).toMatchObject({
      status: 'ok',
      attempts: 0,
      loadedAt: NOW,
      nextRetryAt: null,
      lastError: null,
      lastAttemptAt: NOW,
    });
    expect(prismaMock.scrapePiece.update).not.toHaveBeenCalled();
  });

  it('counts a failure and schedules the retry from the new attempt count', async () => {
    prismaMock.scrapePiece.upsert.mockResolvedValue({ id: 7n, attempts: 2 });
    await recordPieceOutcomes(
      5n,
      [outcome({ ok: false, httpStatus: 503, error: 'HTTP 503' })],
      NOW,
    );
    const arg = prismaMock.scrapePiece.upsert.mock.calls[0][0];
    expect(arg.update).toMatchObject({
      status: 'failed',
      attempts: { increment: 1 },
      httpStatus: 503,
      lastError: 'HTTP 503',
    });
    expect(arg.update).not.toHaveProperty('loadedAt');
    expect(prismaMock.scrapePiece.update).toHaveBeenCalledWith({
      where: { id: 7n },
      data: { nextRetryAt: new Date(NOW.getTime() + 3600000) },
    });
  });

  it('stops scheduling after the fifth failure', async () => {
    prismaMock.scrapePiece.upsert.mockResolvedValue({ id: 7n, attempts: 5 });
    await recordPieceOutcomes(5n, [outcome({ ok: false, error: 'x' })], NOW);
    expect(prismaMock.scrapePiece.update).toHaveBeenCalledWith({
      where: { id: 7n },
      data: { nextRetryAt: null },
    });
  });
});

describe('recordPieceOutcomes: withheld pages', () => {
  // Final review (2026-10-31): a page the tournament withholds is a fact
  // about the tournament, not a fault; retrying it only fills the logs.
  it('records a withheld page as withheld, never to be retried', async () => {
    prismaMock.scrapePiece.upsert.mockResolvedValue({ id: 7n, attempts: 0 });
    await recordPieceOutcomes(
      5n,
      [outcome({ kind: 'motions', ok: false, withheld: true, httpStatus: 403, error: 'HTTP 403' })],
      NOW,
    );
    const arg = prismaMock.scrapePiece.upsert.mock.calls[0][0];
    expect(arg.update).toEqual({
      label: 'Team tab',
      url: 'https://x.calicotab.com/t/tab/team/',
      lastAttemptAt: NOW,
      status: 'withheld',
      httpStatus: 403,
      lastError: 'HTTP 403',
      nextRetryAt: null,
    });
    expect(arg.create).toMatchObject({ status: 'withheld', attempts: 0, nextRetryAt: null });
    expect(prismaMock.scrapePiece.update).not.toHaveBeenCalled();
  });
});
