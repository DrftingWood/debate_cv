import Link from 'next/link';
import type { ReactNode } from 'react';
import { BarList, type BarListItem } from '@/components/ui/BarList';
import { StatRow, StatTile } from '@/components/ui/StatTile';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadFailed } from '@/components/admin/LoadFailed';
import { SIZE_BINS } from '@/lib/admin/capturedMath';
import { adminTabHref } from '@/lib/admin/adminTabs';
import type { Count, FormatsYears, Grouped, MotionKinds, SizeStats } from '@/lib/admin/captured';
import { TabLink } from '@/components/admin/TabLink';
import { Cols, Table, TableScroll, Td, Th, Tr } from '@/components/ui/DataTable';

export const num = (n: number) => n.toLocaleString('en-GB');
const percent = (part: number, whole: number) =>
  whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : '—';

/**
 * One section of the Captured tab: a heading, a sentence that says what the
 * figures count and over how many, then the body (or "couldn't load" when
 * that section's read failed, so the others still show).
 */
export function CapturedSection({
  id,
  title,
  caption,
  failed,
  children,
}: {
  id: string;
  title: string;
  /** What is counted and the size of the sample: every figure carries its n (UX-35). */
  caption?: ReactNode;
  /** True when the read behind it failed. */
  failed?: boolean;
  children?: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="space-y-stack rounded-lg border p-panel">
      <div>
        <h2 id={id} className="font-display text-h3 font-medium text-ink">
          {title}
        </h2>
        {caption && !failed ? (
          <p className="mt-hair max-w-prose text-caption text-ink-soft">{caption}</p>
        ) : null}
      </div>
      {failed ? <LoadFailed what={title.toLowerCase()} /> : children}
    </section>
  );
}

/** A sub-heading inside a section, with the sample it describes. */
export function SubHead({ children, note }: { children: ReactNode; note?: ReactNode }) {
  return (
    <div className="space-y-hair">
      <h3 className="font-display text-h4 font-medium text-ink">{children}</h3>
      {note ? <p className="max-w-prose text-caption text-ink-soft">{note}</p> : null}
    </div>
  );
}

/**
 * A bar chart whose text alternative is its own visible rows (each carries its
 * label and figure), named as a group so a screen reader announces what the
 * rows are.
 */
export function Bars({ label, items }: { label: string; items: BarListItem[] }) {
  return (
    <div role="group" aria-label={label}>
      <BarList items={items} />
    </div>
  );
}

/** The rows of a grouped count as bars, "none" rows named in words. */
function countBars(rows: Count[], total: number, none: string) {
  return rows.map((r): BarListItem => ({
    label: r.value ?? none,
    value: r.count,
    display: `${num(r.count)} · ${percent(r.count, total)}`,
  }));
}

// ── Size ────────────────────────────────────────────────────────────────

export function SizeBody({ size }: { size: SizeStats }) {
  if (size.sampled === 0) {
    return (
      <EmptyState
        title="No team lists are stored yet"
        description="Sizes come from the stored team standings, and no tournament has any."
        headingLevel={3}
      />
    );
  }
  const top = size.largest[0];
  return (
    <>
      <StatRow>
        <StatTile
          label="Median size"
          value={size.median == null ? '—' : `${num(size.median)} teams`}
          hint={`Of ${num(size.sampled)} tournaments with stored teams`}
        />
        <StatTile
          label="Largest"
          value={top ? `${num(top.teams)} teams` : '—'}
          hint={top ? top.name : undefined}
        />
        <StatTile
          label="No teams stored"
          value={num(size.noTeams)}
          hint="Tournaments left out of the sizes"
        />
      </StatRow>
      <SubHead note={`Tournaments by number of teams, n = ${num(size.sampled)}.`}>
        Teams per tournament
      </SubHead>
      <Bars
        label="Tournaments by number of teams"
        items={SIZE_BINS.map((b, i) => ({
          label: `${b.label} teams`,
          value: size.bins[i] ?? 0,
          display: `${num(size.bins[i] ?? 0)} · ${percent(size.bins[i] ?? 0, size.sampled)}`,
        }))}
      />
      <LargestTable largest={size.largest} />
    </>
  );
}

/** The largest tournaments by stored teams, each with its admin page and public Tab. */
function LargestTable({ largest }: { largest: SizeStats['largest'] }) {
  return (
    <>
      <SubHead>Largest {largest.length}</SubHead>
      <TableScroll>
        <Table label="Largest tournaments by teams stored">
          <Cols widths={['2.5rem', undefined, '6rem']} />
          <thead>
            <tr>
              <Th numeric>#</Th>
              <Th>Tournament</Th>
              <Th numeric>Teams</Th>
            </tr>
          </thead>
          <tbody>
            {largest.map((t, i) => (
              <Tr key={t.id}>
                <Td numeric>{i + 1}</Td>
                <Td>
                  <TournamentCell id={t.id} name={t.name} tabUrl={t.tabUrl} />
                </Td>
                <Td numeric>{num(t.teams)}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </TableScroll>
    </>
  );
}

/** A tournament's name linking to its admin page, then its public Tab ↗. */
export function TournamentCell({
  id,
  name,
  tabUrl,
}: {
  id: string;
  name: string;
  tabUrl: string | null;
}) {
  return (
    <span className="wrap-break-word">
      <Link
        href={`/admin/tournaments/${id}`}
        className="text-ink underline-offset-4 hover:underline"
      >
        {name}
      </Link>{' '}
      <TabLink url={tabUrl} text="Tab" of={name} className="text-caption" />
    </span>
  );
}

// ── Geography ───────────────────────────────────────────────────────────

export function GeographyBody({ geo }: { geo: Grouped }) {
  if (geo.total === 0) {
    return <EmptyState title="No tournaments stored" headingLevel={3} />;
  }
  const unknown = geo.rows.find((r) => r.value == null)?.count ?? 0;
  return (
    <>
      <Bars
        label="Tournaments by region"
        items={countBars(geo.rows, geo.total, 'Unknown region')}
      />
      <p className="max-w-prose text-caption text-ink-soft">
        {num(unknown)} of {num(geo.total)} tournaments have no region yet; a region is added when a
        tag proposal is approved.
      </p>
    </>
  );
}

// ── Formats and years ───────────────────────────────────────────────────

export function FormatsYearsBody({ data }: { data: FormatsYears }) {
  if (data.total === 0) {
    return <EmptyState title="No tournaments stored" headingLevel={3} />;
  }
  const none = (rows: Count[]) => rows.find((r) => r.value == null)?.count ?? 0;
  const tools = (hash: string) => `${adminTabHref('tools')}#${hash}`;
  return (
    <div className="grid gap-group md:grid-cols-2">
      <div className="min-w-0 space-y-stack">
        <SubHead note={`n = ${num(data.total)} tournaments.`}>Formats</SubHead>
        <Bars
          label="Tournaments by format"
          items={countBars(data.formats, data.total, 'No format')}
        />
        {none(data.formats) > 0 ? (
          <p className="text-caption text-ink-soft">
            {num(none(data.formats))} with no format:{' '}
            <Link href={tools('fill-formats')} className="text-ink underline underline-offset-4">
              Fill missing formats
            </Link>
          </p>
        ) : null}
      </div>
      <div className="min-w-0 space-y-stack">
        <SubHead note={`n = ${num(data.total)} tournaments, newest year first.`}>Years</SubHead>
        <Bars label="Tournaments by year" items={countBars(data.years, data.total, 'No year')} />
        {none(data.years) > 0 ? (
          <p className="text-caption text-ink-soft">
            {num(none(data.years))} with no year:{' '}
            <Link href={tools('fill-years')} className="text-ink underline underline-offset-4">
              Fill years from names
            </Link>
          </p>
        ) : null}
      </div>
    </div>
  );
}

// ── Motion types and topics ─────────────────────────────────────────────

export function MotionKindsBody({ data }: { data: MotionKinds }) {
  if (data.total === 0) {
    return (
      <EmptyState
        title="No motions are stored"
        description="Motions arrive with a tournament's motions page; none has been read yet."
        headingLevel={3}
      />
    );
  }
  return (
    <div className="grid gap-group md:grid-cols-2">
      <div className="min-w-0 space-y-stack">
        <SubHead note={`n = ${num(data.total)} motions.`}>Types</SubHead>
        <Bars label="Motions by type" items={countBars(data.types, data.total, 'Untyped')} />
      </div>
      <div className="min-w-0 space-y-stack">
        <SubHead
          note={`Top ${data.topics.length} topics of ${num(data.total)} motions; ${num(
            data.topicsUntagged,
          )} have no topic.`}
        >
          Topics
        </SubHead>
        {data.topics.length === 0 ? (
          <p className="text-body text-ink-soft">No motion has a topic yet.</p>
        ) : (
          <Bars label="Motions by topic" items={countBars(data.topics, data.total, 'No topic')} />
        )}
      </div>
    </div>
  );
}
