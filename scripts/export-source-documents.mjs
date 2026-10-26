// Copy the stored page bodies (SourceDocument.bodyGzip) from the database to
// local files, read-only, so they can then be dropped from the server.
//
//   POSTGRES_URL_NON_POOLING=... node scripts/export-source-documents.mjs --out ./source-docs
//
// Writes one gzip file per document, <id>.html.gz, and an index.jsonl with
// {id,url,status,contentHash,contentLength,fetchedAt,file}. Pages from private
// URLs (/privateurls/) are NOT exported by default: they carry a personal
// credential and a registration name, and there is nothing public to keep.
// Pass --include-private to copy them too.
//
// Nothing is written to the database. The connection string is read from the
// environment and never printed. Resumable: files already on disk are skipped.
import { existsSync, mkdirSync, appendFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name, fallback) => {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};

const out = resolve(value('--out', './source-docs'));
const includePrivate = flag('--include-private');
const batch = Number(value('--batch', '100'));
const url = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_PRISMA_URL;
if (!url) {
  console.error('Set POSTGRES_URL_NON_POOLING (or POSTGRES_PRISMA_URL) in the environment first.');
  process.exit(1);
}

mkdirSync(out, { recursive: true });
const indexPath = join(out, 'index.jsonl');
if (!existsSync(indexPath)) writeFileSync(indexPath, '');

const prisma = new PrismaClient({ datasources: { db: { url } } });
const privatePattern = /\/privateurls\//i;

let cursor;
let seen = 0;
let written = 0;
let skippedPrivate = 0;
let skippedNoBody = 0;
let alreadyOnDisk = 0;

try {
  for (;;) {
    const rows = await prisma.sourceDocument.findMany({
      take: batch,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
      select: { id: true, url: true, status: true, contentHash: true, contentLength: true, fetchedAt: true, bodyGzip: true },
    });
    if (rows.length === 0) break;
    for (const r of rows) {
      seen += 1;
      if (!r.bodyGzip) {
        skippedNoBody += 1;
        continue;
      }
      if (!includePrivate && privatePattern.test(r.url)) {
        skippedPrivate += 1;
        continue;
      }
      const file = `${r.id}.html.gz`;
      const path = join(out, file);
      if (existsSync(path)) {
        alreadyOnDisk += 1;
        continue;
      }
      writeFileSync(path, r.bodyGzip);
      appendFileSync(
        indexPath,
        JSON.stringify({
          id: r.id,
          url: r.url,
          status: r.status,
          contentHash: r.contentHash,
          contentLength: r.contentLength,
          fetchedAt: r.fetchedAt,
          file,
        }) + '\n',
      );
      written += 1;
    }
    cursor = rows[rows.length - 1].id;
    process.stdout.write(`\rscanned ${seen}, written ${written}`);
  }
  console.log(
    `\nDone. scanned ${seen} | written ${written} | already on disk ${alreadyOnDisk} | no body ${skippedNoBody} | private pages skipped ${skippedPrivate}`,
  );
  console.log(`Files and index.jsonl are in ${out}`);
} finally {
  await prisma.$disconnect();
}
