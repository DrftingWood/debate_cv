import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const config = JSON.parse(readFileSync(join(process.cwd(), 'vercel.json'), 'utf8'));
const enabled: Record<string, boolean> = config.git?.deploymentEnabled ?? {};

describe('vercel.json', () => {
  it('keeps the process-queue cron', () => {
    expect(config.crons).toContainEqual({
      path: '/api/cron/process-queue',
      schedule: '0 3 * * *',
    });
  });

  it('never disables main and enables preview/* opt-in', () => {
    expect(enabled.main).toBe(true);
    expect(enabled['preview/*']).toBe(true);
  });

  it('disables agent and feature branch patterns', () => {
    expect(enabled['worktree-agent-*']).toBe(false);
    for (const prefix of [
      'claude',
      'feat',
      'fix',
      'chore',
      'docs',
      'security',
      'stats',
      'ux',
      'integration',
      'opus',
      'wip',
    ]) {
      expect(enabled[`${prefix}/**`], prefix).toBe(false);
    }
  });
});
