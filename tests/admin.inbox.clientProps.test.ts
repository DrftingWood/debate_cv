import { describe, expect, it, vi } from 'vitest';

// The Inbox table's rows are props of a 'use client' component, so they are
// serialised into the page whatever the client renders (the reason for
// admin.clientProps.test.ts). Kept apart from it for that file's size cap.

vi.mock('@/lib/admin/summary', () => ({ readInbox: vi.fn() }));

const { toInboxRows } = await import('@/components/admin/tabs/InboxTab');

const KEY = 'k3yS3cr3t';
const PRIVATE = `https://oxiv.calicotab.com/oxiv2025/privateurls/${KEY}/`;
const NOW = new Date('2026-10-31T12:00:00Z');

function expectNoKey(props: unknown) {
  const json = JSON.stringify(props);
  expect(json.toLowerCase()).not.toContain('privateurls');
  expect(json).not.toContain(KEY);
}

describe('Inbox rows', () => {
  it('carry no private key: the tab address, a rescrape piece url and a fix link are all made public', () => {
    const rows = toInboxRows(
      [
        {
          key: 'check:1',
          kind: 'check',
          tournament: { id: '1', name: 'Oxford IV', tabUrl: PRIVATE, status: 'partial' },
          summary: 'Round 3 has no results',
          more: 0,
          usersAffected: 1,
          severity: 'fail',
          age: NOW,
          fix: {
            type: 'rescrape',
            tournamentId: '1',
            pieces: [{ kind: 'round', key: '3', label: 'Round 3', url: `${PRIVATE}round/3/` }],
          },
          markItems: [],
          flagItems: [],
          reviewFlag: null,
          changedSinceChecked: false,
        },
        {
          key: 'report:r1',
          kind: 'report',
          tournament: null,
          summary: 'Wrong teammate',
          more: 0,
          usersAffected: 1,
          severity: 'fail',
          age: NOW,
          fix: { type: 'open', href: `/admin?back=${PRIVATE}` },
          markItems: [],
          flagItems: [],
          reviewFlag: null,
          changedSinceChecked: false,
        },
      ],
      NOW,
    );
    expectNoKey(rows);
    expect(rows[0]!.tabUrl).toBe('https://oxiv.calicotab.com/oxiv2025/');
  });
});

describe('Inbox row text', () => {
  it('scrubs a private link out of the summary and the name of every kind', () => {
    const base = {
      more: 0,
      usersAffected: 1,
      severity: 'fail' as const,
      age: NOW,
      fix: { type: 'open' as const, href: '/admin' },
      markItems: [],
      flagItems: [],
      reviewFlag: null,
      changedSinceChecked: false,
    };
    const rows = toInboxRows(
      [
        {
          ...base,
          key: 'check:1',
          kind: 'check',
          tournament: null,
          summary: `Round 3 missing, see ${PRIVATE}round/3/ and privateurls/${KEY}`,
        },
        {
          ...base,
          key: 'parser:x',
          kind: 'parser',
          tournament: { id: null, name: `at ${PRIVATE}`, tabUrl: null, status: 'missing' },
          summary: `Ballot not found at ${PRIVATE}`,
        },
      ],
      NOW,
    );
    expectNoKey(rows);
    expect(rows[0]!.summary).toContain('Round 3 missing');
  });
});
