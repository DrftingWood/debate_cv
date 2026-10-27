import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs script without types
import { decide, isNonCodePath } from '../scripts/vercel-ignore-build.mjs';

const run = (env: Record<string, string>, changedFiles: string[] | null) =>
  decide({ env, changedFiles }) as { build: boolean; reason: string };

describe('vercel-ignore-build decide', () => {
  it('always builds production', () => {
    const env = { VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_REF: 'wip/x' };
    expect(run(env, ['docs/a.md']).build).toBe(true);
  });
  it('always builds main', () => {
    const env = { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'main' };
    expect(run(env, ['docs/a.md']).build).toBe(true);
  });
  it('skips agent scratch branches', () => {
    for (const b of ['worktree-agent-abc', 'claude/foo', 'wip/bar']) {
      const env = { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: b };
      expect(run(env, ['app/page.tsx']).build).toBe(false);
    }
  });
  it('commit message marker forces a build on scratch branches', () => {
    const env = {
      VERCEL_ENV: 'preview',
      VERCEL_GIT_COMMIT_REF: 'claude/x',
      VERCEL_GIT_COMMIT_MESSAGE: 'try [Vercel Build]',
    };
    expect(run(env, ['docs/a.md']).build).toBe(true);
  });
  it('skips docs-only preview pushes', () => {
    const env = { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'feat/x' };
    expect(run(env, ['docs/HANDOFF.md', 'README.md', 'scripts/prescrape/list.txt']).build).toBe(
      false,
    );
  });
  it('builds when any code file changed', () => {
    const env = { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'feat/x' };
    expect(run(env, ['docs/a.md', 'lib/x.ts']).build).toBe(true);
  });
  it('fails safe when changed files are unknown or empty', () => {
    const env = { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'feat/x' };
    expect(run(env, null).build).toBe(true);
    expect(run(env, []).build).toBe(true);
  });
});

describe('isNonCodePath', () => {
  it('classifies paths', () => {
    expect(isNonCodePath('docs/x/y.png')).toBe(true);
    expect(isNonCodePath('CLAUDE.md')).toBe(true);
    expect(isNonCodePath('.github/ISSUE_TEMPLATE/bug.yml')).toBe(true);
    expect(isNonCodePath('scripts/prescrape/a.txt')).toBe(true);
    expect(isNonCodePath('app/page.tsx')).toBe(false);
    expect(isNonCodePath('package.json')).toBe(false);
    expect(isNonCodePath('public/robots.txt')).toBe(false);
    expect(isNonCodePath('vercel.json')).toBe(false);
  });
});
