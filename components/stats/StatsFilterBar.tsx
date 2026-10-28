'use client';

import { useMemo } from 'react';
import { ChevronDown, X } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { Button } from '@/components/ui/Button';
import { PressedMark, pressedClasses } from '@/components/stats/pressed';
import type { ProAm, StatsFacts } from '@/lib/cv/statsFacts';
import type { StatsFilter } from '@/lib/cv/statsFilter';

const PAIRING_LABELS: Record<ProAm, string> = {
  pro: 'Pro-am · you as pro',
  am: 'Pro-am · you as am',
  peers: 'Peers',
};

/** Seat order within a format, the order a debater reads a room in. */
const SEAT_ORDER = ['OG', 'OO', 'CG', 'CO', 'Gov', 'Aff', 'Prop', 'Opp', 'Neg'];

/**
 * Counts come from the whole record, not the filtered view, so a chip's
 * number doesn't shift under the user as they click — it answers "how much
 * of my record is this", which is what someone deciding what to filter by
 * wants to know.
 */
function useOptions(facts: StatsFacts) {
  return useMemo(() => {
    const partnerCounts = new Map<string, number>();
    const pairingCounts = new Map<ProAm, number>();
    for (const t of facts.tournaments) {
      for (const p of new Set(t.partners)) partnerCounts.set(p, (partnerCounts.get(p) ?? 0) + 1);
      if (t.proAm) pairingCounts.set(t.proAm, (pairingCounts.get(t.proAm) ?? 0) + 1);
    }

    const seatCounts = new Map<string, number>();
    for (const r of facts.rounds) {
      if (r.isOutround || !r.seat) continue;
      seatCounts.set(r.seat, (seatCounts.get(r.seat) ?? 0) + 1);
    }
    const seatGroups = new Map<string, Array<{ seat: string; side: string; count: number }>>();
    for (const [seat, count] of seatCounts) {
      const [group, side] = seat.split(':');
      const list = seatGroups.get(group) ?? [];
      list.push({ seat, side, count });
      seatGroups.set(group, list);
    }
    for (const list of seatGroups.values()) {
      list.sort((a, b) => SEAT_ORDER.indexOf(a.side) - SEAT_ORDER.indexOf(b.side));
    }

    return {
      partners: labelDuplicates(
        [...partnerCounts]
          .map(([key, count]) => ({ key, name: facts.partnerNames[key] ?? key, count }))
          .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
      ),
      pairings: (['pro', 'am', 'peers'] as const)
        .map((p) => ({ value: p, count: pairingCounts.get(p) ?? 0 }))
        .filter((p) => p.count > 0),
      seatGroups: [...seatGroups].sort(
        (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]),
      ),
    };
  }, [facts]);
}

/**
 * Partners are filtered by person, but two people can share a display name —
 * every withdrawn debater reads "[name withdrawn]". Numbering the repeats
 * keeps them apart in the list without revealing anything about who they are.
 */
function labelDuplicates<T extends { name: string }>(partners: T[]): Array<T & { label: string }> {
  const total = new Map<string, number>();
  for (const p of partners) total.set(p.name, (total.get(p.name) ?? 0) + 1);
  const seen = new Map<string, number>();
  return partners.map((p) => {
    if ((total.get(p.name) ?? 0) < 2) return { ...p, label: p.name };
    const n = (seen.get(p.name) ?? 0) + 1;
    seen.set(p.name, n);
    return { ...p, label: `${p.name} (${n})` };
  });
}

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

function Chip({
  pressed,
  onClick,
  label,
  count,
  unit,
}: {
  pressed: boolean;
  onClick: () => void;
  label: string;
  count: number;
  /** Read after the count by screen readers: "OG 33 prelim rounds". */
  unit: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-table font-medium transition-colors coarse:min-h-[44px] coarse:py-0',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
        pressedClasses(pressed),
      )}
    >
      {pressed ? <PressedMark /> : null}
      {label}
      {/* The count inherits the chip's colour when pressed: `ink-soft` on
          the inverted ink background would fall to about 2:1. */}
      <span className={cn('num text-caption', pressed ? 'text-paper' : 'text-ink-soft')}>
        {count}
        <span className="sr-only"> {unit}</span>
      </span>
    </button>
  );
}

export function StatsFilterBar({
  facts,
  filter,
  onChange,
  summary,
}: {
  facts: StatsFacts;
  filter: StatsFilter;
  onChange: (next: StatsFilter) => void;
  summary: string;
}) {
  const options = useOptions(facts);
  const partnerLabel = new Map(options.partners.map((p) => [p.key, p.label]));
  const active = filter.partners.length + filter.pairings.length + filter.seats.length > 0;

  return (
    <section aria-label="Filter statistics" data-print-hide="true" className="panel space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="data-label">Filter</div>
          <p className="mt-1 text-table text-ink-soft" aria-live="polite">
            {summary}
          </p>
        </div>
        {active ? (
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<X className="h-3.5 w-3.5" aria-hidden />}
            onClick={() => onChange({ partners: [], pairings: [], seats: [] })}
          >
            Clear filters
          </Button>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
        <div className="space-y-2">
          <div className="data-label" id="stats-filter-partner">
            Partner
          </div>
          <details
            className="group relative"
            onKeyDown={(e) => {
              if (e.key !== 'Escape') return;
              const details = e.currentTarget;
              if (!details.open) return;
              details.open = false;
              details.querySelector('summary')?.focus();
            }}
          >
            <summary
              aria-labelledby="stats-filter-partner stats-filter-partner-value"
              className={cn(
                'flex cursor-pointer list-none items-center justify-between gap-2 rounded-md border border-input bg-surface px-3 py-2 text-table text-ink coarse:min-h-[44px]',
                '[&::-webkit-details-marker]:hidden',
              )}
            >
              <span id="stats-filter-partner-value" className="truncate">
                {filter.partners.length === 0
                  ? 'Any partner'
                  : filter.partners.length === 1
                    ? (partnerLabel.get(filter.partners[0]) ?? 'One partner')
                    : `${filter.partners.length} partners`}
              </span>
              <ChevronDown
                className="h-4 w-4 shrink-0 text-ink-soft transition-transform group-open:rotate-180"
                aria-hidden
              />
            </summary>
            <fieldset className="panel-raised absolute z-20 mt-1 max-h-72 w-full min-w-[min(16rem,100%)] overflow-y-auto p-1">
              <legend className="sr-only">Partners</legend>
              {options.partners.map((p) => (
                <label
                  key={p.key}
                  className="flex cursor-pointer items-center justify-between gap-3 rounded px-2 py-1.5 text-table hover:bg-surface-2 coarse:min-h-[44px]"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <input
                      type="checkbox"
                      checked={filter.partners.includes(p.key)}
                      onChange={() =>
                        onChange({ ...filter, partners: toggle(filter.partners, p.key) })
                      }
                      className="h-6 w-6 shrink-0 accent-primary"
                    />
                    <span className="break-words text-ink">{p.label}</span>
                  </span>
                  <span className="num text-caption text-ink-soft">
                    {p.count}
                    <span className="sr-only"> tournaments</span>
                  </span>
                </label>
              ))}
            </fieldset>
          </details>

          {options.pairings.length > 0 ? (
            <div
              role="group"
              aria-label="Pairing"
              className="inline-flex flex-wrap gap-1 rounded-lg border border-border bg-surface-2 p-1"
            >
              {options.pairings.map((p) => (
                <Chip
                  key={p.value}
                  label={PAIRING_LABELS[p.value]}
                  count={p.count}
                  unit="tournaments"
                  pressed={filter.pairings.includes(p.value)}
                  onClick={() =>
                    onChange({ ...filter, pairings: toggle(filter.pairings, p.value) })
                  }
                />
              ))}
            </div>
          ) : null}
        </div>

        <div className="space-y-2">
          <div className="data-label">Seat</div>
          <div className="flex flex-wrap gap-3">
            {options.seatGroups.map(([group, seats]) => (
              <div
                key={group}
                role="group"
                aria-label={`${group} seats`}
                className="flex items-center gap-2"
              >
                <span className="data-label w-9 shrink-0">{group}</span>
                <div className="inline-flex flex-wrap gap-1 rounded-lg border border-border bg-surface-2 p-1">
                  {seats.map((s) => (
                    <Chip
                      key={s.seat}
                      label={s.side}
                      count={s.count}
                      unit="prelim rounds"
                      pressed={filter.seats.includes(s.seat)}
                      onClick={() => onChange({ ...filter, seats: toggle(filter.seats, s.seat) })}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
          <p className="text-caption text-ink-soft">
            Counts are prelim rounds per seat and tournaments per partner, across your whole record.
          </p>
        </div>
      </div>
    </section>
  );
}
