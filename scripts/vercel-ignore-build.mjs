// Vercel "Ignored Build Step" (vercel.json `ignoreCommand`).
// Exit 0 = skip the build, exit 1 = build (Vercel docs, project-settings page).
// Fail safe: any doubt means BUILD. Production (main) always builds.
// Force a preview build with `[vercel build]` in the commit message.
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const SKIP_BRANCH_PREFIXES = ['worktree-agent-', 'claude/', 'wip/'];
const FORCE_MARKER = '[vercel build]';

/** True when a changed path cannot affect the built app. */
export function isNonCodePath(p) {
  const f = p.replace(/\\/g, '/');
  if (f.startsWith('docs/')) return true;
  if (f.startsWith('.github/ISSUE_TEMPLATE/')) return true;
  if (f === '.github/pull_request_template.md') return true;
  if (/^scripts\/prescrape\/[^/]+\.txt$/.test(f)) return true;
  if (/\.(md|mdx|txt)$/i.test(f) && !f.startsWith('app/') && !f.startsWith('public/')) return true;
  return false;
}

/**
 * @param {{env: Record<string,string|undefined>, changedFiles: string[]|null}} input
 * changedFiles null = unknown (no previous SHA, shallow history, git failure).
 * @returns {{build: boolean, reason: string}}
 */
export function decide({ env, changedFiles }) {
  const ref = env.VERCEL_GIT_COMMIT_REF ?? '';
  if (env.VERCEL_ENV === 'production') return { build: true, reason: 'production deploy' };
  if (ref === 'main') return { build: true, reason: 'main branch' };
  if ((env.VERCEL_GIT_COMMIT_MESSAGE ?? '').toLowerCase().includes(FORCE_MARKER))
    return { build: true, reason: `commit message contains ${FORCE_MARKER}` };
  if (SKIP_BRANCH_PREFIXES.some((p) => ref.startsWith(p)))
    return { build: false, reason: `agent scratch branch (${ref})` };
  if (!changedFiles) return { build: true, reason: 'changed files unknown (fail safe)' };
  if (changedFiles.length > 0 && changedFiles.every(isNonCodePath))
    return { build: false, reason: 'only non-code files changed' };
  return { build: true, reason: 'code changes' };
}

function changedFilesFromGit(env) {
  const prev = env.VERCEL_GIT_PREVIOUS_SHA;
  if (!prev) return null;
  try {
    const out = execFileSync('git', ['diff', '--name-only', prev, 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const files = out
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    return files.length ? files : null; // empty diff is suspicious: build
  } catch {
    return null;
  }
}

function main() {
  let result;
  try {
    result = decide({ env: process.env, changedFiles: changedFilesFromGit(process.env) });
  } catch {
    result = { build: true, reason: 'error (fail safe)' };
  }
  console.log(`vercel-ignore-build: ${result.build ? 'BUILD' : 'SKIP'} - ${result.reason}`);
  process.exit(result.build ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
