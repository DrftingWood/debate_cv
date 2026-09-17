/**
 * The /cv/stats sections that read the round table: positions within each
 * format, teammates and pro-am pairings, and motion types. Presentational
 * only — the figures come from lib/cv/roundSplits.ts and
 * lib/cv/teammateStats.ts, over the round table the page has already
 * filtered. `baseline` is the unfiltered round table: deltas always compare
 * with the whole record in that format, never with the filtered slice.
 */

import type { Split } from '@/lib/cv/speakerStats';
import type { RoundFact, StatsFacts } from '@/lib/cv/statsFacts';
import { MIN_SPLIT_ROUNDS, splitRounds, type RoundSplit } from '@/lib/cv/roundSplits';
import { teammateStats } from '@/lib/cv/teammateStats';
import { CARRY_LEVEL_BAND, carryIndex, roundCurve } from '@/lib/cv/roundViews';
import { SectionHeader } from '@/components/ui/Card';
import { StatTile, StatRow } from '@/components/ui/StatTile';
import { Badge } from '@/components/ui/Badge';
import { Table, Th, Td, Tr, Nil, TableScroll } from '@/components/ui/DataTable';
import { StatsSplitTable } from '@/components/StatsSplitTable';

import { MOTION_ORDER, SEAT_ORDER } from '@/lib/cv/crossTabs';
const FORMAT_NAME: Record<string, string> = {
  BP: 'British Parliamentary',
  AP: 'Asian Parliamentary',
  Aus: 'Australs',
  WSDC: 'World Schools',
  '2v2': 'Two-team Parliamentary',
};

/** StatsSplitTable reads the engine's Split shape; a RoundSplit carries the same figures. */
function asSplit(r: RoundSplit, key = r.key): Split {
  return {
    key,
    rounds: r.rounds,
    tournaments: r.tournaments,
    decidedRounds: r.decided,
    wins: r.wins,
    winRate: r.winRate,
    avgScore: r.avgScore,
    scoreDelta: r.scoreDelta,
    winRateDelta: r.winRateDelta,
    avgPoints: r.avgPoints,
  };
}

const signed = (n: number | null, digits = 1) => {
  if (n == null) return null;
  const rounded = Number(n.toFixed(digits));
  return `${rounded > 0 ? '+' : rounded < 0 ? '−' : ''}${Math.abs(rounded).toFixed(digits)}`;
};

// ── Positions ─────────────────────────────────────────────────────────────

export function PositionsSection({ facts, baseline }: { facts: StatsFacts; baseline: RoundFact[] }) {
  const bySeat = splitRounds(facts.rounds, (r) => r.seat, baseline);
  if (bySeat.length === 0) return null;

  const groups = new Map<string, RoundSplit[]>();
  for (const s of bySeat) {
    const [group] = s.key.split(':');
    const list = groups.get(group) ?? [];
    list.push(s);
    groups.set(group, list);
  }
  const ordered = [...groups]
    .map(([group, seats]) => ({
      group,
      seats: seats.sort(
        (a, b) => SEAT_ORDER.indexOf(a.key.split(':')[1]) - SEAT_ORDER.indexOf(b.key.split(':')[1]),
      ),
      rounds: seats.reduce((n, s) => n + s.rounds, 0),
    }))
    .sort((a, b) => b.rounds - a.rounds);

  return (
    <section id="positions" aria-label="Positions" className="scroll-mt-24 space-y-6">
      <SectionHeader
        label="Positions"
        title="Where you sat, format by format"
        meta="Deltas compare with your whole record in the same format"
      />
      {ordered.map(({ group, seats, rounds }) => (
        <div key={group} className="space-y-2">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="font-display text-h4 font-medium text-ink">{FORMAT_NAME[group] ?? group}</h3>
            <span className="data-label">{rounds} prelim rounds</span>
          </div>
          <StatsSplitTable
            splits={seats.map((s) => asSplit(s, s.key.split(':')[1]))}
            dimensionLabel="Seat"
            thinBelow={MIN_SPLIT_ROUNDS}
            showPoints={group === 'BP'}
            baselineLabel="your whole record in this format"
          />
        </div>
      ))}
      <p className="text-caption text-ink-soft">
        A win means first of four teams in British Parliamentary and first of two elsewhere, so seats
        are only compared within a format.
      </p>
    </section>
  );
}

// ── Teammates ─────────────────────────────────────────────────────────────

const PAIRING_TITLE = { pro: 'As the pro', am: 'As the am', peers: 'With peers' } as const;

/**
 * `perRoundOnly` (seat filter): breaks describe whole tournaments, which a
 * seat filter slices, so they are left out — the same rule the headline,
 * Field and Seasons sections follow.
 */
export function TeammatesSection({ facts, perRoundOnly = false }: { facts: StatsFacts; perRoundOnly?: boolean }) {
  const { partners, pairings } = teammateStats(facts);
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  if (partners.length === 0) return null;

  return (
    <section id="partners" aria-label="Teammates" className="scroll-mt-24 space-y-3">
      <SectionHeader
        label="Teammates"
        title="Who you debated with"
        meta={`${partners.length} partner${partners.length === 1 ? '' : 's'}`}
      />

      {pairings.length > 0 ? (
        <StatRow columns={Math.min(pairings.length, 3)}>
          {pairings.map((p) => (
            <StatTile
              key={p.label}
              label={PAIRING_TITLE[p.label]}
              value={p.avgScore != null ? p.avgScore.toFixed(1) : '—'}
              hint={[
                plural(p.tournaments, 'tournament'),
                perRoundOnly ? null : plural(p.breaks, 'break'),
                p.winRate == null
                  ? null
                  : p.decided < MIN_SPLIT_ROUNDS
                    ? `${plural(p.decided, 'decided round')} — too few for a win rate`
                    : `${Math.round(p.winRate * 100)}% of ${p.decided} prelim rounds won`,
              ]
                .filter(Boolean)
                .join(' · ')}
            />
          ))}
        </StatRow>
      ) : null}
      <p className="text-caption text-ink-soft">
        A pairing is pro-am when your speaker average and your partners' differ by more than 1.5 at that
        tournament, measured from scored speeches. Without them the pairing is left unlabelled rather
        than estimated.
      </p>

      <div className="panel overflow-hidden">
        <TableScroll>
          <Table className="min-w-max" label="Results by teammate">
            <thead>
              <tr>
                <Th className="pl-4">Partner</Th>
                <Th numeric>Tournaments</Th>
                <Th>Pairing</Th>
                <Th numeric title="Your average minus your partners', averaged over tournaments where both were scored">
                  Gap
                </Th>
                {perRoundOnly ? null : <Th numeric>Breaks</Th>}
                <Th numeric>Your avg</Th>
                <Th numeric className="pr-4">Round win rate</Th>
              </tr>
            </thead>
            <tbody>
              {partners.map((p) => (
                <Tr key={p.key}>
                  <Td className="pl-4 font-medium">
                    <span className="block max-w-[14rem] truncate" title={p.name}>
                      {p.name}
                    </span>
                  </Td>
                  <Td numeric>{p.tournaments}</Td>
                  <Td className="whitespace-nowrap">
                    <span className="inline-flex gap-1">
                      {p.pairings.pro ? <Badge variant="gold">Pro ×{p.pairings.pro}</Badge> : null}
                      {p.pairings.am ? <Badge>Am ×{p.pairings.am}</Badge> : null}
                      {p.pairings.peers ? <Badge variant="neutral">Peers ×{p.pairings.peers}</Badge> : null}
                      {p.tournaments === p.pairings.unlabelled ? <Nil /> : null}
                    </span>
                  </Td>
                  <Td numeric>{signed(p.meanGap) ?? <Nil />}</Td>
                  {perRoundOnly ? null : <Td numeric>{p.breaks}</Td>}
                  <Td numeric>{p.avgScore != null ? p.avgScore.toFixed(1) : <Nil />}</Td>
                  <Td numeric className="pr-4">
                    {p.winRate == null ? (
                      <Nil />
                    ) : p.decided < MIN_SPLIT_ROUNDS ? (
                      <span
                        className="text-caption text-ink-soft"
                        title={`${p.wins} of ${p.decided} decided prelim rounds — too few to read as a rate`}
                      >
                        n = {p.decided}
                      </span>
                    ) : (
                      <span title={`${p.wins} of ${p.decided} decided prelim rounds`}>
                        {Math.round(p.winRate * 100)}%
                      </span>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableScroll>
      </div>
    </section>
  );
}

// ── Motion types ──────────────────────────────────────────────────────────

export function MotionTypesSection({ facts, baseline }: { facts: StatsFacts; baseline: RoundFact[] }) {
  const byType = splitRounds(facts.rounds, (r) => r.motionType, baseline).sort(
    (a, b) => MOTION_ORDER.indexOf(a.key) - MOTION_ORDER.indexOf(b.key),
  );
  if (byType.length === 0) return null;

  const typed = facts.rounds.filter((r) => !r.isOutround && r.motionType != null);
  const prelims = facts.rounds.filter((r) => !r.isOutround).length;
  // Info slides and framing are read over every round with a known motion,
  // typed or not: a choice round where every option had a slide was a slide
  // round whichever the room picked.
  const withMotion = facts.rounds.filter((r) => !r.isOutround && r.hasMotion);
  const byInfo = splitRounds(withMotion, (r) => (r.infoSlide ? 'With an info slide' : 'No info slide'), baseline);
  const byFraming = splitRounds(withMotion, (r) => (r.contextLed ? 'Context-led' : 'Direct'), baseline);

  return (
    <section id="motion-types" aria-label="Motion types" className="scroll-mt-24 space-y-6">
      <SectionHeader
        label="Motions"
        title="What each kind of motion asks of you"
        meta={`${typed.length} of ${prelims} prelim rounds typed`}
      />
      <StatsSplitTable
        splits={byType.map((s) => asSplit(s))}
        dimensionLabel="Type"
        thinBelow={MIN_SPLIT_ROUNDS}
        baselineLabel="your whole record in each round's format"
      />
      <p className="text-caption text-ink-soft">
        Types come from the wording: Policy (THW), Actor (TH, as X, would), Belief (THBT), Stance (THS /
        THO), Regret (THR), Preference (THP). A round that offered a choice of motions is typed only when
        every option shares a type — the tab does not say which one a room chose. Info slides and
        framing below cover all {withMotion.length} prelim rounds with a known motion; a choice round
        counts when every option had the slide or the framing.
      </p>

      {byInfo.length > 1 || byFraming.length > 1 ? (
        <div className="grid gap-6 lg:grid-cols-2">
          {byInfo.length > 1 ? (
            <div className="space-y-2">
              <h3 className="font-display text-h4 font-medium text-ink">Info slides</h3>
              <StatsSplitTable splits={byInfo.map((s) => asSplit(s))} dimensionLabel="Motion" thinBelow={MIN_SPLIT_ROUNDS} baselineLabel="your whole record in each round's format" />
            </div>
          ) : null}
          {byFraming.length > 1 ? (
            <div className="space-y-2">
              <h3 className="font-display text-h4 font-medium text-ink">Framing</h3>
              <StatsSplitTable splits={byFraming.map((s) => asSplit(s))} dimensionLabel="Motion" thinBelow={MIN_SPLIT_ROUNDS} baselineLabel="your whole record in each round's format" />
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

// ── Round by round ────────────────────────────────────────────────────────

export function RoundCurveSection({ facts, baseline }: { facts: StatsFacts; baseline: RoundFact[] }) {
  const curve = roundCurve(facts.rounds, baseline);
  if (curve.length < 2) return null;

  return (
    <section id="round-curve" aria-label="Round by round" className="scroll-mt-24 space-y-3">
      <SectionHeader
        label="Round by round"
        title="Early rounds and late ones"
        meta="Deltas compare with your whole record in the same format"
      />
      <StatsSplitTable
        splits={curve.map((p) => asSplit(p, `Round ${p.roundNumber}`))}
        dimensionLabel="Round"
        thinBelow={MIN_SPLIT_ROUNDS}
        baselineLabel="your whole record in each round's format"
      />
      <p className="text-caption text-ink-soft">
        Prelim rounds grouped by their number, so this stays meaningful under a seat filter. Late round
        numbers exist only at longer tournaments, and power-pairing puts you in stronger rooms as a
        tournament goes on — a dip in round 8 can be the draw, not the debater.
      </p>
    </section>
  );
}

// ── Carry index ───────────────────────────────────────────────────────────

const CARRY_LABEL: Record<string, string> = {
  'out-spoke': 'You out-spoke your partners',
  level: 'Level',
  'out-spoken': 'Your partners out-spoke you',
};

export function CarrySection({ facts, baseline }: { facts: StatsFacts; baseline: RoundFact[] }) {
  const c = carryIndex(facts.rounds, baseline);
  if (c.rounds === 0) return null;
  const pct = (n: number) => `${Math.round((n / c.rounds) * 100)}%`;

  return (
    <section id="carry" aria-label="Carry index" className="scroll-mt-24 space-y-3">
      <SectionHeader
        label="Carry index"
        title="Your speech against your partners'"
        meta={`${c.rounds} prelim round${c.rounds === 1 ? '' : 's'} where both were scored`}
      />
      <StatRow columns={4}>
        <StatTile
          label="Average carry"
          value={signed(c.meanCarry) ?? '—'}
          hint="Your speech minus your partners' mean, in speaker points"
        />
        <StatTile label="Out-spoke" value={pct(c.outSpoke)} hint={`${c.outSpoke} rounds by more than ${CARRY_LEVEL_BAND}`} />
        <StatTile label="Level" value={pct(c.level)} hint={`${c.level} rounds within ±${CARRY_LEVEL_BAND}`} />
        <StatTile label="Out-spoken" value={pct(c.outSpoken)} hint={`${c.outSpoken} rounds by more than ${CARRY_LEVEL_BAND}`} />
      </StatRow>
      {c.results.length > 1 ? (
        <StatsSplitTable
          splits={c.results.map((s) => asSplit(s, CARRY_LABEL[s.key] ?? s.key))}
          dimensionLabel="Round"
          thinBelow={MIN_SPLIT_ROUNDS}
          baselineLabel="your whole record in each round's format"
        />
      ) : null}
      <p className="text-caption text-ink-soft">
        In three-a-side formats your partners' speeches are averaged. Reply speeches are not on the
        speaker tab, so they never enter the comparison. A round where no partner was scored is left
        out.
      </p>
    </section>
  );
}
