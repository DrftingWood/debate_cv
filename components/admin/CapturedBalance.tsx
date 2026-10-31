import Link from 'next/link';
import type { BarListItem } from '@/components/ui/BarList';
import { Cols, Nil, Table, TableScroll, Td, Th, Tr } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { Bars, SubHead, TournamentCell, num } from '@/components/admin/CapturedParts';
import {
  BALANCE_MIN_ROOMS_MOTION,
  BALANCE_MIN_ROOMS_TYPE,
  orderSeats,
} from '@/lib/admin/capturedMath';
import type { Balance } from '@/lib/admin/capturedMath';
import { adminTabHref } from '@/lib/admin/adminTabs';
import type { CheckCode } from '@/lib/audit/types';
import type { AccuracyOverview } from '@/lib/admin/accuracy';
import type { BalanceStats, UnbalancedMotion } from '@/lib/admin/captured';
import { UNBALANCED_LIMIT } from '@/lib/admin/captured';

const points = (v: number | null) => (v == null ? null : v.toFixed(2));
const share = (v: number | null) => (v == null ? null : `${(v * 100).toFixed(1)}%`);

/** A split's cell: the figure, or the dash that says the tab published none. */
const cell = (v: string | null) => (v == null ? <Nil /> : v);

/**
 * The seat splits, in words and bars. BP is the average team points (0 to 3)
 * per position over every prelim round; a two-team format is the share of
 * rooms each side won. A bar is drawn from zero, so a fair split reads as
 * equal bars and a skew shows as the difference it is.
 */
function SplitBars({ balance }: { balance: Balance }) {
  const { bp, two } = balance;
  const bpItems: BarListItem[] = bp.positions.map((p) => ({
    label: p.pos,
    value: p.avg ?? 0,
    display: p.avg == null ? '—' : `${points(p.avg)} · n ${num(p.n)}`,
  }));
  const twoItems: BarListItem[] = two.positions.map((p) => ({
    label: p.pos === 'Prop' ? 'Prop / Gov' : 'Opp',
    value: p.share ?? 0,
    display: p.share == null ? '—' : `${share(p.share)} · n ${num(p.n)}`,
  }));
  return (
    <div className="grid gap-group md:grid-cols-2">
      <div className="min-w-0 space-y-stack">
        <SubHead
          note={
            bp.rooms === 0
              ? 'No four-team rooms with a recorded seat.'
              : `Average team points by position (0 to 3), over ≈ ${num(bp.rooms)} rooms, all prelim rounds. n is team-rounds.`
          }
        >
          British Parliamentary
        </SubHead>
        {bp.rooms > 0 ? <Bars label="Average points by BP position" items={bpItems} /> : null}
      </div>
      <div className="min-w-0 space-y-stack">
        <SubHead
          note={
            two.rooms === 0
              ? 'No two-team rooms with a recorded side.'
              : `Share of rooms won by side, over ≈ ${num(two.rooms)} rooms, all prelim rounds. n is recorded results.`
          }
        >
          Two-team formats
        </SubHead>
        {two.rooms > 0 ? <Bars label="Win share by side" items={twoItems} /> : null}
      </div>
    </div>
  );
}

type TypeRow = BalanceStats['byType']['shown'][number];

/** Four-team rooms per motion type: average points in each seat. */
function BpTypeTable({ rows }: { rows: TypeRow[] }) {
  return (
    <TableScroll>
      <Table label="Average points by position, per motion type, four-team rooms">
        <Cols widths={[undefined, '4.5rem', '4.5rem', '4.5rem', '4.5rem', '5rem']} />
        <thead>
          <tr>
            <Th>Type (BP)</Th>
            {['OG', 'OO', 'CG', 'CO'].map((p) => (
              <Th key={p} numeric>
                {p}
              </Th>
            ))}
            <Th numeric>≈ Rooms</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <Tr key={t.type}>
              <Td rowHeader>{t.type || 'Untyped'}</Td>
              {t.balance.bp.positions.map((p) => (
                <Td key={p.pos} numeric>
                  {cell(points(p.avg))}
                </Td>
              ))}
              <Td numeric>{num(t.balance.bp.rooms)}</Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </TableScroll>
  );
}

/** Two-team rooms per motion type: the share each side won. */
function TwoTypeTable({ rows }: { rows: TypeRow[] }) {
  return (
    <TableScroll>
      <Table label="Win share by side, per motion type, two-team rooms">
        <Cols widths={[undefined, '5.5rem', '5.5rem', '5rem']} />
        <thead>
          <tr>
            <Th>Type (two-team)</Th>
            <Th numeric>Prop</Th>
            <Th numeric>Opp</Th>
            <Th numeric>≈ Rooms</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <Tr key={t.type}>
              <Td rowHeader>{t.type || 'Untyped'}</Td>
              {t.balance.two.positions.map((p) => (
                <Td key={p.pos} numeric>
                  {cell(share(p.share))}
                </Td>
              ))}
              <Td numeric>{num(t.balance.two.rooms)}</Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </TableScroll>
  );
}

/** "THP (25 BP · 25 two-team)": each kind of room apart, the empty kind left out. */
function tooFewText(t: BalanceStats['byType']['tooFew'][number]): string {
  const kinds = [t.bp > 0 ? `${num(t.bp)} BP` : '', t.two > 0 ? `${num(t.two)} two-team` : ''];
  return `${t.type || 'Untyped'} (${kinds.filter(Boolean).join(' · ')})`;
}

/** The split per motion type, a table for each kind of room (they read in different units). */
function ByType({ byType }: { byType: BalanceStats['byType'] }) {
  const bp = byType.shown.filter((t) => t.balance.bp.rooms >= BALANCE_MIN_ROOMS_TYPE);
  const two = byType.shown.filter((t) => t.balance.two.rooms >= BALANCE_MIN_ROOMS_TYPE);
  return (
    <div className="space-y-stack">
      <SubHead
        note={`Only types with at least ${BALANCE_MIN_ROOMS_TYPE} rooms are split; rooms are from rounds that had one motion.`}
      >
        By motion type
      </SubHead>
      {byType.shown.length === 0 ? (
        <p className="text-body text-ink-soft">
          No motion type has {BALANCE_MIN_ROOMS_TYPE} rooms yet, so none is split.
        </p>
      ) : null}
      {bp.length > 0 ? <BpTypeTable rows={bp} /> : null}
      {two.length > 0 ? <TwoTypeTable rows={two} /> : null}
      {byType.tooFew.length > 0 ? (
        <p className="max-w-prose text-caption text-ink-soft">
          Too few rooms to split: {byType.tooFew.map(tooFewText).join(', ')}.
        </p>
      ) : null}
    </div>
  );
}

/** "OG 2.30 · OO 1.70 · CG 0.80 · CO 1.20": the seats in their fixed order. */
const seatsText = (m: UnbalancedMotion, fmt: (v: number) => string) =>
  orderSeats(m.seats)
    .map((s) => `${s.pos} ${fmt(s.value)}`)
    .join(' · ');

/**
 * The motions, widest first. From md up a table (motion with its seats,
 * tournament with its Tab, spread, rooms); below md a card per motion, because
 * four columns do not fit 285 px without clipping the Spread or wrapping the
 * motion over six lines (R7 browser check): the motion clamped to two lines
 * (the whole text on its title), the tournament and its Tab, then one line of
 * "Spread · round · rooms · seats".
 */
function UnbalancedTable({
  title,
  motions,
  fmt,
  spreadFmt,
}: {
  title: string;
  motions: UnbalancedMotion[];
  fmt: (v: number) => string;
  spreadFmt: (v: number) => string;
}) {
  return (
    <>
      <ul aria-label={title} className="space-y-tight md:hidden">
        {motions.map((m) => (
          <li key={m.motionId} className="space-y-hair border-b pb-tight last:border-b-0">
            <p className="line-clamp-2 wrap-break-word text-ink" title={m.text}>
              {m.text}
            </p>
            <p>
              <TournamentCell
                id={m.tournament.id}
                name={m.tournament.name}
                tabUrl={m.tournament.tabUrl}
              />
            </p>
            <p className="text-caption text-ink-soft">
              Spread {spreadFmt(m.spread)} · {m.roundLabel} · {num(m.rooms)} rooms ·{' '}
              {seatsText(m, fmt)}
            </p>
          </li>
        ))}
      </ul>
      <div className="hidden md:block">
        <TableScroll>
          <Table label={title}>
            <Cols widths={[undefined, undefined, '5rem', '4.5rem']} />
            <thead>
              <tr>
                <Th>Motion</Th>
                <Th>Tournament</Th>
                <Th numeric>Spread</Th>
                <Th numeric>Rooms</Th>
              </tr>
            </thead>
            <tbody>
              {motions.map((m) => (
                <Tr key={m.motionId}>
                  <Td>
                    <span className="wrap-break-word">{m.text}</span>
                    <span className="mt-hair block text-caption text-ink-soft">
                      {m.roundLabel} · {seatsText(m, fmt)}
                    </span>
                  </Td>
                  <Td>
                    <TournamentCell
                      id={m.tournament.id}
                      name={m.tournament.name}
                      tabUrl={m.tournament.tabUrl}
                    />
                  </Td>
                  <Td numeric>{spreadFmt(m.spread)}</Td>
                  <Td numeric>{num(m.rooms)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableScroll>
      </div>
    </>
  );
}

/** One list of the most unbalanced motions, each with its tournament and the seats behind the spread. */
function Unbalanced({
  title,
  unit,
  motions,
  fmt,
  spreadFmt,
}: {
  title: string;
  unit: string;
  motions: UnbalancedMotion[];
  fmt: (v: number) => string;
  spreadFmt: (v: number) => string;
}) {
  return (
    <div className="space-y-stack">
      <SubHead
        note={`Up to ${UNBALANCED_LIMIT}, widest first; each has at least ${BALANCE_MIN_ROOMS_MOTION} rooms per seat. Spread: ${unit}. Rounds with one motion only.`}
      >
        {title}
      </SubHead>
      {motions.length === 0 ? (
        <p className="text-body text-ink-soft">
          No motion has {BALANCE_MIN_ROOMS_MOTION} rooms per seat with sides recorded.
        </p>
      ) : (
        <UnbalancedTable title={title} motions={motions} fmt={fmt} spreadFmt={spreadFmt} />
      )}
    </div>
  );
}

export function BalanceBody({ balance }: { balance: BalanceStats }) {
  const { overall } = balance;
  if (overall.bp.rooms === 0 && overall.two.rooms === 0) {
    return (
      <EmptyState
        title="No rooms with recorded sides"
        description={`Seat balance needs the side each team took in a prelim round. ${num(balance.noSides)} team-rounds have none stored; a re-scrape of those tournaments fills them in.`}
        headingLevel={3}
      />
    );
  }
  return (
    <>
      <SplitBars balance={overall} />
      <ByType byType={balance.byType} />
      <Unbalanced
        title="Most unbalanced four-team motions"
        unit="points between the best and worst seat"
        motions={balance.unbalancedBp}
        fmt={(v) => v.toFixed(2)}
        spreadFmt={(v) => v.toFixed(2)}
      />
      <Unbalanced
        title="Most unbalanced two-team motions"
        unit="Prop win share's distance from 50%"
        motions={balance.unbalancedTwo}
        fmt={(v) => share(v) ?? '—'}
        spreadFmt={(v) => share(v) ?? '—'}
      />
    </>
  );
}

/** The balance section's caption: the sample and what was left out, in words. */
export function balanceCaption(balance: BalanceStats): string {
  const rooms = balance.overall.bp.rooms + balance.overall.two.rooms;
  const unrecognised = balance.overall.unrecognised;
  return (
    `All prelim rounds, ≈ ${num(rooms)} rooms with a recorded side (rooms ≈ team-rounds ÷ 4 (BP) or ÷ 2). ` +
    `${num(balance.noSides)} team-rounds without recorded sides are excluded` +
    (unrecognised > 0 ? `, and ${num(unrecognised)} with a seat name not recognised` : '') +
    '.'
  );
}

// ── Coverage gaps ───────────────────────────────────────────────────────

export type CoverageRow = {
  key: string;
  label: string;
  /** Null when its count could not be read. */
  count: number | null;
  note: string;
  /** Tournaments tab filtered to these, when the filter exists. */
  list?: string;
  /** The Tools bulk action that fixes them, when there is one. */
  fix?: { href: string; text: string };
};

/** The gap rows, counted from the accuracy overview's failing checks where it has them. */
export function coverageRows({
  overview,
  noYear,
  unreleased,
  stored,
}: {
  overview: AccuracyOverview | null;
  noYear: number | null;
  unreleased: number | null;
  /** All stored, not ignored: the Formats section's own total. */
  stored: number | null;
}): CoverageRow[] {
  const failing = (code: CheckCode) =>
    overview ? (overview.failingByCheck.find((c) => c.code === code)?.count ?? 0) : null;
  // Which tournaments a count is over, said on every row: the checks' counts
  // are over the audited ones, the year and unreleased counts over all stored,
  // and the Formats section above counts the stored ones too.
  const audited = `Of ${overview ? num(overview.n) : 'the'} audited tournaments`;
  const all = `Of all ${stored == null ? '' : `${num(stored)} `}stored`;
  const list = (code: string) => adminTabHref('tournaments', { check: code });
  const tools = (hash: string) => `${adminTabHref('tools')}#${hash}`;
  return [
    {
      key: 'format',
      label: 'Missing format',
      count: failing('format_missing'),
      note: `${audited}: format unknown.`,
      list: list('format_missing'),
      fix: { href: tools('fill-formats'), text: 'Fill missing formats' },
    },
    {
      key: 'year',
      label: 'Missing year',
      count: noYear,
      note: `${all}: no year. No check lists these; the count is the Tools tab's.`,
      fix: { href: tools('fill-years'), text: 'Fill years from names' },
    },
    {
      key: 'core',
      label: 'Missing adjudication core',
      count: failing('core_missing'),
      note: `${audited}: no core named.`,
      list: list('core_missing'),
      fix: { href: tools('fill-cores'), text: 'Fill missing adjudication cores' },
    },
    {
      key: 'unreleased',
      label: 'Unreleased tabs',
      count: unreleased,
      note: `${all}: a page is kept back. Not a fault; nothing retries them.`,
    },
    {
      key: 'parser',
      label: 'Old parser',
      count: failing('parser_stale'),
      note: `${audited}: stored by an older parser.`,
      list: list('parser_stale'),
      fix: { href: tools('refresh-old'), text: 'Refresh old-parser tournaments' },
    },
  ];
}

export function CoverageBody({ rows }: { rows: CoverageRow[] }) {
  return (
    <TableScroll>
      <Table label="Coverage gaps">
        <Cols widths={[undefined, '5.5rem', undefined]} />
        <thead>
          <tr>
            <Th>Gap</Th>
            <Th numeric>Tournaments (audited)</Th>
            <Th>See and fix</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <Tr key={r.key}>
              <Td rowHeader>
                <span className="wrap-break-word">{r.label}</span>
                <span className="mt-hair block text-caption text-ink-soft">{r.note}</span>
              </Td>
              <Td numeric>
                {r.count == null ? <Nil title="Could not be counted" /> : num(r.count)}
              </Td>
              <Td>
                <span className="flex flex-wrap gap-x-stack gap-y-hair text-caption">
                  {r.list ? (
                    <Link href={r.list} className="text-ink underline underline-offset-4">
                      See in Tournaments
                    </Link>
                  ) : null}
                  {r.fix ? (
                    <Link href={r.fix.href} className="text-ink underline underline-offset-4">
                      {r.fix.text}
                    </Link>
                  ) : null}
                  {!r.list && !r.fix ? <span className="text-ink-soft">Nothing to fix</span> : null}
                </span>
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </TableScroll>
  );
}
