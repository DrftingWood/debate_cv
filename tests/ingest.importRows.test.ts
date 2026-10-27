import { describe, expect, it } from 'vitest';
import {
  countByFilter,
  failedTileHint,
  matchesFilter,
  resolvePage,
  statusFor,
  type ImportStatus,
} from '@/lib/ingest/importRows';

describe('statusFor', () => {
  it('treats abandoned and legacy HTTP 404 as unavailable', () => {
    expect(statusFor(false, 'abandoned', null)).toBe('unavailable');
    expect(statusFor(false, 'failed', 'fetch landing → HTTP 404')).toBe('unavailable');
  });
  it('prefers done over running, otherwise follows the job', () => {
    expect(statusFor(true, 'running', null)).toBe('done');
    expect(statusFor(false, 'running', null)).toBe('running');
    expect(statusFor(false, 'failed', 'x')).toBe('failed');
    expect(statusFor(false, undefined, null)).toBe('pending');
  });
});

describe('countByFilter', () => {
  it('counts every row, with no cap, and folds running into pending', () => {
    const statuses: ImportStatus[] = [
      ...Array(250).fill('done'),
      ...Array(3).fill('running'),
      'pending',
      'failed',
      'unmatched',
      'unavailable',
    ];
    const c = countByFilter(statuses);
    expect(c.all).toBe(257);
    expect(c.done).toBe(250);
    expect(c.pending).toBe(4);
    expect(c.failed + c.unmatched + c.unavailable).toBe(3);
  });
  it('agrees with matchesFilter', () => {
    expect(matchesFilter('running', 'pending')).toBe(true);
    expect(matchesFilter('done', 'pending')).toBe(false);
    expect(matchesFilter('done', 'all')).toBe(true);
  });
});

describe('resolvePage', () => {
  it('clamps junk and out-of-range pages', () => {
    expect(resolvePage(undefined, 120, 50)).toMatchObject({ page: 1, pages: 3, start: 0, end: 50 });
    expect(resolvePage('3', 120, 50)).toMatchObject({ page: 3, start: 100, end: 120 });
    expect(resolvePage('99', 120, 50).page).toBe(3);
    expect(resolvePage('-2', 120, 50).page).toBe(1);
    expect(resolvePage('abc', 0, 50)).toMatchObject({ page: 1, pages: 1, start: 0, end: 0 });
  });
});

describe('failedTileHint (caption under the Failed tile)', () => {
  it('never contradicts a zero: dead links are named as a separate, unretried bucket', () => {
    expect(failedTileHint(0, 34)).toBe(
      'Nothing to retry. 34 links no longer load (dead, not retried)',
    );
    expect(failedTileHint(0, 1)).toBe(
      'Nothing to retry. 1 link no longer loads (dead, not retried)',
    );
  });
  it('points at the Failed filter only when something can be retried', () => {
    expect(failedTileHint(3, 0)).toBe('open Failed to retry');
    expect(failedTileHint(3, 2)).toBe(
      'open Failed to retry. 2 links no longer load (dead, not retried)',
    );
    expect(failedTileHint(0, 0)).toBe('nothing to retry');
  });
  it('no longer uses the old "dead links" caption', () => {
    expect(failedTileHint(0, 34)).not.toMatch(/^\d+ dead links?$/);
  });
});
