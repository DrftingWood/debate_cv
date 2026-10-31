import { describe, expect, it } from 'vitest';
import { looksLikeTestTournament } from '@/lib/admin/ignoreSuggestion';

describe('looksLikeTestTournament', () => {
  it.each([
    'test',
    'DEMO',
    'minimal8team',
    'Minimal 8 Teams',
    '',
    '   ',
    'My Test Cup',
    'Sandbox 2',
    'Demo-1',
  ])('suggests ignoring %j', (name) => expect(looksLikeTestTournament(name)).toBe(true));

  it.each(['WUDC 2023', 'Contest Open', 'Latest Cup', 'Testament IV', 'Preworlds24'])(
    'does not suggest ignoring %j',
    (name) => expect(looksLikeTestTournament(name)).toBe(false),
  );
});
