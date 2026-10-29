import { ProAmToggle } from '@/components/ProAmToggle';
import { Table, TableScroll, Td, Th, Tr } from '@/components/ui/DataTable';
import type { PartnerTournament, PartnerYear } from '@/lib/cv/proAm';

/**
 * The Record's Partners tab (redesign owner decision 17; owner rule
 * 2026-10-27: "a Partners section, year overview, tournament overview
 * beneath, where users mark teammates as pro-am themselves").
 *
 * The year overview says who you debated with and how often; the list
 * beneath has one row per partner per tournament with the pro-am toggle.
 * Nothing here is inferred: a pairing is pro-am only when you press it, and
 * the mark is private until Settings → Sharing says otherwise.
 */
export function RecordPartners({
  years,
  pairings,
}: {
  years: PartnerYear[];
  pairings: PartnerTournament[];
}) {
  if (pairings.length === 0) {
    return (
      <p className="text-body text-ink-soft">
        None of your tabs lists a partner yet, so there is nothing to mark.
      </p>
    );
  }
  return (
    <div className="space-y-section">
      <section aria-labelledby="partners-by-year" className="space-y-stack">
        <h2 id="partners-by-year" className="data-label">
          Partners by year
        </h2>
        {/* The same panel and 16 px inset as the table below, so the two
            lists of this tab share one left edge (owner review 2026-10-29). */}
        <dl className="panel divide-y divide-border overflow-hidden">
          {years.map((y) => (
            <div
              key={y.year ?? 'undated'}
              className="grid gap-inline px-4 py-tight md:grid-cols-[6rem_minmax(0,1fr)]"
            >
              <dt className="font-mono text-table text-ink">{y.year ?? 'Undated'}</dt>
              <dd className="flex flex-wrap gap-x-stack gap-y-hair text-table text-ink">
                {y.partners.map((p) => (
                  <span key={p.name}>
                    {p.name}{' '}
                    <span className="font-mono text-caption text-ink-soft">
                      ×{p.tournaments}
                      {p.proAm ? ` · pro-am ${p.proAm}` : ''}
                    </span>
                  </span>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="partners-by-tournament" className="space-y-stack">
        <div>
          <h2 id="partners-by-tournament" className="data-label">
            By tournament
          </h2>
          <p className="mt-hair max-w-2xl text-caption text-ink-soft">
            Mark a partnership pro-am when one of you was the experienced speaker. We never guess
            it. Marks are private unless you turn on &ldquo;Show pro-am marks on my public CV&rdquo;
            in Settings, under Sharing.
          </p>
        </div>
        <div className="panel overflow-hidden">
          <TableScroll>
            <Table className="w-full" label="Partners by tournament">
              <thead>
                <tr>
                  <Th className="pl-4">Tournament</Th>
                  <Th numeric>Year</Th>
                  <Th>Partner</Th>
                  <Th className="pr-4">Pro-am</Th>
                </tr>
              </thead>
              <tbody>
                {pairings.map((p) => (
                  <Tr key={`${p.tournamentId}|${p.partner}`}>
                    <Td className="pl-4">{p.tournamentName}</Td>
                    <Td numeric className="text-ink-soft">
                      {p.year ?? '—'}
                    </Td>
                    <Td>{p.partner}</Td>
                    <Td className="pr-4">
                      <ProAmToggle
                        tournamentId={p.tournamentId}
                        tournamentName={p.tournamentName}
                        partner={p.partner}
                        initial={p.marked}
                      />
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableScroll>
        </div>
      </section>
    </div>
  );
}
