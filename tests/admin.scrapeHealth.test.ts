import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prismaMock, resetPrismaMock } from './setup/api-test-utils';

vi.mock('@/lib/db', () => import('./setup/api-test-utils').then((m) => ({ prisma: m.prismaMock })));

const { getTournamentPieces } = await import('@/lib/admin/scrapeHealth');

const d = (s: string) => new Date(s);

beforeEach(() => resetPrismaMock());

describe('getTournamentPieces', () => {
  it('returns null for an unknown tournament', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue(null);
    expect(await getTournamentPieces(9n)).toBeNull();
  });

  it('splits tabs from rounds and orders rounds numerically, outrounds last', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue({
      id: 1n,
      name: 'T',
      sourceUrlRaw: 'https://t.calicotab.com/t/',
    });
    const row = (kind: string, key: string, label: string) => ({
      kind,
      key,
      label,
      status: 'ok',
      httpStatus: 200,
      attempts: 0,
      loadedAt: null,
      lastAttemptAt: d('2026-10-01'),
      nextRetryAt: null,
      lastError: null,
    });
    prismaMock.scrapePiece.findMany.mockResolvedValue([
      row('round', '10', 'R10'),
      row('round', '/t/results/round/grand-final/', 'Grand Final'),
      row('round', '2', 'R2'),
      row('team', '', 'Team tab'),
      row('break', 'open', 'Open break'),
    ]);
    const r = await getTournamentPieces(1n);
    expect(r?.tournament).toEqual({ id: 1n, name: 'T', sourceUrl: 'https://t.calicotab.com/t/' });
    expect(r?.tabs.map((p) => p.kind).sort()).toEqual(['break', 'team']);
    expect(r?.rounds.map((p) => p.label)).toEqual(['R2', 'R10', 'Grand Final']);
  });
});
