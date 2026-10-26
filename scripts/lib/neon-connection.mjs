// Shared by the operator scripts that talk to production Neon from a laptop
// (export-source-documents.mjs, approve-tag-proposals.mjs). The rule both
// follow: the connection string comes from the shell variable
// POSTGRES_URL_NON_POOLING or a hidden prompt, never from a .env file, and it
// is never printed, logged or echoed back in an error message.
//
// This module must not import @prisma/client: importing it loads .env files
// into process.env, and callers capture the shell variable before that
// happens.

/** Read one line from the terminal without showing it (a star per character). */
export function askHidden(prompt) {
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
export function directConnectionString(raw) {
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

/**
 * Resolve the connection string: the shell value captured by the caller
 * before @prisma/client was imported, else a hidden prompt. Exits the
 * process with a message that never contains the string itself.
 */
export async function resolveConnectionString(shellUrl) {
  let url = shellUrl;
  if (!url) {
    const typed = await askHidden('Paste the Neon connection string and press Enter (it will not be shown): ');
    if (!typed.trim()) {
      console.error('Nothing entered.');
      process.exit(1);
    }
    url = typed;
  }
  try {
    return directConnectionString(url);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}
