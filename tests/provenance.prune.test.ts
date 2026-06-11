import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => import('./setup/api-test-utils').then((m) => m.dbMockModule));

import { pruneIngestArtifacts } from '@/lib/calicotab/provenance';
import { prismaMock, resetPrismaMock } from './setup/api-test-utils';

/**
 * The prune SQL itself can't run against the prisma mock — these tests
 * lock in the contract instead: both deletes execute (SourceDocument
 * first, since its cascade also removes ParserRuns the second statement
 * would otherwise count), the row counts are returned, and the retention
 * predicates that make the prune safe are present in the SQL: never
 * delete the newest snapshot per URL, never delete a document's latest
 * successful ParserRun (isLatestParserRun reads exactly that row).
 */
describe('pruneIngestArtifacts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPrismaMock();
  });

  it('runs both deletes and returns their counts', async () => {
    prismaMock.$executeRaw.mockResolvedValueOnce(7).mockResolvedValueOnce(31);
    const result = await pruneIngestArtifacts();
    expect(result).toEqual({ sourceDocumentsDeleted: 7, parserRunsDeleted: 31 });
    expect(prismaMock.$executeRaw).toHaveBeenCalledTimes(2);
  });

  it('keeps the load-bearing rows: newest snapshot per URL, latest successful run per document', async () => {
    prismaMock.$executeRaw.mockResolvedValue(0);
    await pruneIngestArtifacts();

    // $executeRaw is a tagged-template call — the SQL text is the joined
    // template strings (first element of the first call arg).
    const sql = (call: unknown[]): string => (call[0] as TemplateStringsArray).join('?');
    const [docsCall, runsCall] = prismaMock.$executeRaw.mock.calls;

    const docsSql = sql(docsCall);
    expect(docsSql).toContain('DELETE FROM "SourceDocument"');
    // Only superseded snapshots: a newer row for the same URL must exist.
    expect(docsSql).toMatch(/newer\."url" = sd\."url" AND newer\."fetchedAt" > sd\."fetchedAt"/);

    const runsSql = sql(runsCall);
    expect(runsSql).toContain('DELETE FROM "ParserRun"');
    // The latest successful run per document is exempt from deletion.
    expect(runsSql).toMatch(/NOT IN/);
    expect(runsSql).toMatch(/DISTINCT ON \("sourceDocumentId"\)/);
    expect(runsSql).toMatch(/"success" = true/);
  });
});
