import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import type { ParticipantsRow } from '@/lib/calicotab/parseTabs';
import { recordRedactedSpeakers, redactedSpeakersByTeam } from '@/lib/calicotab/redactedCounts';

// Ingest records how many of each team's speakers are redacted, so the
// audit's partners check does not count them as missing (Monash Open 2023
// "UTS 1" and "VST", NLSD 2025 "Pineapple"). The participants list is the
// source: the speaker tab's redacted rows carry no team.

function row(name: string, teamName: string | null, role: ParticipantsRow['role'] = 'speaker') {
  const r: ParticipantsRow = { name, role, judgeTag: null, teamName, institution: null };
  return r;
}

const rows = [
  row('Alice Ng', 'UTS 1'),
  row('Bo Li', 'UTS 1'),
  row('<em>Redacted</em>', 'UTS 1'),
  row('<em>Redacted</em>', 'VST'),
  row('Anonymous', 'VST'),
  row('Speaker 1', 'Swing 1'),
  row('<em>Redacted</em>', null),
  row('<em>Redacted</em>', null, 'adjudicator'),
];

describe('redactedSpeakersByTeam', () => {
  it('counts redacted speakers per team; stand-ins, judges and teamless rows are not counted', () => {
    expect(Object.fromEntries(redactedSpeakersByTeam(rows))).toEqual({ 'UTS 1': 1, VST: 2 });
  });
});

describe('recordRedactedSpeakers', () => {
  function tx() {
    const $executeRaw = vi.fn().mockResolvedValue(1);
    const client: Pick<Prisma.TransactionClient, '$executeRaw'> = { $executeRaw };
    return { $executeRaw, client };
  }
  it('zeroes every team-tab row, then writes each team with a redacted speaker', async () => {
    const t = tx();
    await recordRedactedSpeakers(t.client, 7n, redactedSpeakersByTeam(rows));
    expect(t.$executeRaw).toHaveBeenCalledTimes(3);
    const values = t.$executeRaw.mock.calls.map((c) => c.slice(1));
    expect(values).toEqual([[7n], [1, 7n, 'UTS 1'], [2, 7n, 'VST']]);
  });
  it('writes nothing when the participants list was not read (the count stays unknown)', async () => {
    const t = tx();
    await recordRedactedSpeakers(t.client, 7n, null);
    expect(t.$executeRaw).not.toHaveBeenCalled();
  });
});
