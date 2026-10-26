// Copy the stored page bodies (SourceDocument.bodyGzip) from the database to
// local files, read-only, so they can then be dropped from the server.
//
//   node scripts/export-source-documents.mjs --out ./source-docs
//
// It asks for the Neon connection string when it starts. Paste it at that
// prompt (nothing is shown as you paste; each character appears as a star) and
// press Enter. There is nothing to edit in the command. If the string is
// already in POSTGRES_URL_NON_POOLING it is used without asking. A pooled
// string (host containing -pooler) is switched to the direct host for you, and
// the channel_binding option is dropped.
//
// Writes one gzip file per document, <id>.html.gz, and an index.jsonl with
// {id,url,status,contentHash,contentLength,fetchedAt,file}. Pages from private
// URLs (/privateurls/) are NOT exported by default: they carry a personal
// credential and a registration name, and there is nothing public to keep.
// Pass --include-private to copy them too.
//
// Nothing is written to the database. The connection string is never printed. Resumable: files already on disk are skipped.
import { existsSync, mkdirSync, appendFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Read the shell before the database library loads: importing @prisma/client also
// reads any .env file in the repo into process.env, which must not be used by accident.
const shellUrl = process.env.POSTGRES_URL_NON_POOLING;
const { PrismaClient } = await import('@prisma/client');

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name, fallback) => {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};

const out = resolve(value('--out', './source-docs'));
const includePrivate = flag('--include-private');
const batch = Number(value('--batch', '100'));

/** Read one line from the terminal without showing it (a star per character). */
function askHidden(prompt) {
  return new Promise((resolvePrompt, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      reject(new Error('Run this in an interactive terminal, or set POSTGRES_URL_NON_POOLING first.'));
      return;
    }
    process.stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let buf = '';
    const finish = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      process.stdout.write('\n');
    };
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          finish();
          resolvePrompt(buf);
          return;
        }
        if (ch === '\u0003') {
          finish();
          process.exit(130);
        }
        if (ch === '\u007f' || ch === '\b') {
          if (buf.length > 0) {
            buf = buf.slice(0, -1);
            process.stdout.write('\b \b');
          }
          continue;
        }
        buf += ch;
        process.stdout.write('*');
      }
    };
    stdin.on('data', onData);
  });
}

/** The direct (non-pooled) form of a Neon string, without options Prisma may reject. */
function directConnectionString(raw) {
  // Neon's Connect dialog offers a psql command, a DATABASE_URL="..." line and a
  // multi-line .env block. Take just the address out of whatever was pasted,
  // ignoring a leading "psql", a NAME=, and surrounding quotes. Nothing pasted
  // is ever echoed back, so an error cannot leak the password.
  const found = String(raw).match(/postgres(?:ql)?:\/\/[^\s'"]+/);
  if (!found) {
    throw new Error(
      'No postgresql://... address found in what was pasted. In the Neon Connect dialog copy only the connection string.',
    );
  }
  let u;
  try {
    u = new URL(found[0]);
  } catch {
    throw new Error(
      'The address could not be read. Copy the connection string again from the Neon Connect dialog, exactly as shown.',
    );
  }
  u.hostname = u.hostname.replace('-pooler', '');
  u.searchParams.delete('channel_binding');
  return u.toString();
}

let url = shellUrl; // only what was set in the shell; .env files and other variables are ignored
if (!url) {
  const typed = await askHidden('Paste the Neon connection string and press Enter (it will not be shown): ');
  if (!typed.trim()) {
    console.error('Nothing entered.');
    process.exit(1);
  }
  url = typed;
}
try {
  url = directConnectionString(url);
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
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
