import { describe, it, expect } from 'vitest';
import { isPermanentError } from '@/lib/queue';

describe('isPermanentError', () => {
  it('matches a landing-page HTTP 404 (dead Heroku app)', () => {
    const err =
      'fetch landing https://wudckorea.herokuapp.com/2021/privateurls/kod5jnsw/ → HTTP 404: <!DOCTYPE html> <html> <head> <meta name="viewport" content="width=device-width, initial-scale=1"> <meta charset="utf-8"> <title>No such app</title>';
    expect(isPermanentError(err)).toBe(true);
  });

  it('matches a landing-page HTTP 404 on calicotab.com', () => {
    const err =
      'fetch landing http://edudrift.calicotab.com/uadc2021/privateurls/s92g7mnv/ → HTTP 404: <!DOCTYPE html>';
    expect(isPermanentError(err)).toBe(true);
  });

  it('does NOT match a tab-fetch HTTP 404 (could be transient)', () => {
    const err =
      'Aborting ingest: 1 tab fetch(es) failed — fetch: speakerTab HTTP 404 — <!DOCTYPE html>';
    expect(isPermanentError(err)).toBe(false);
  });

  it('does NOT match a HTTP 403 (Cloudflare — recoverable)', () => {
    const err =
      'Aborting ingest: 1 tab fetch(es) failed — fetch: participants HTTP 403 (set SCRAPER_API_KEY to bypass Cloudflare blocking)';
    expect(isPermanentError(err)).toBe(false);
  });

  it('does NOT match a deadlock error', () => {
    expect(isPermanentError('deadlock detected: serialization failure')).toBe(false);
  });

  it('does NOT match arbitrary HTTP 404 strings without the landing context', () => {
    expect(isPermanentError('HTTP 404')).toBe(false);
    expect(isPermanentError('user reported 404 in feedback form')).toBe(false);
  });
});
