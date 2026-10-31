import { prisma } from '@/lib/db';
import { publicPieceUrl } from '@/lib/audit/types';
import { cvReportDetails } from '@/lib/admin/cvReports';
import { warningDetails } from '@/lib/admin/parserWarnings';
import { parseAuditCheckId, type FlagItem } from '@/lib/admin/reviewSetTypes';
import { CHECK_LABELS } from '@/lib/audit/types';

/**
 * The review set's knowledge of its two newer sources (Task 5d): CV reports
 * and parser warnings. Task 5c stored their flags bare (no address, no
 * tournament) and exported only the sourceId; a later session handed the
 * export could not tell what a flag was about. Here a flag of each kind is
 * resolved when written and described when read.
 *
 *   - cv_report: the report must still exist; its first stored tournament
 *     becomes the flag's tournament and public tab. The export names the
 *     reporter, the categories in words and every tournament.
 *   - parser_warning: `<parser>|<headline>`, kept as written. The export
 *     gives the parser, headline, its count in the current window and a few
 *     tournaments, read again so the numbers are today's.
 */

export type FlagDetail =
  | {
      kind: 'cv_report';
      reporter: { name: string | null; email: string | null };
      categories: string[];
      tournaments: Array<{ id: string; name: string }>;
    }
  | {
      kind: 'parser_warning';
      parser: string;
      headline: string;
      /** Warnings with this headline in the current window; null when it has aged out. */
      count: number | null;
      sampleTournaments: Array<{ id: string | null; name: string; tabUrl: string | null }>;
    }
  | {
      kind: 'audit_check';
      tournament: { id: string; name: string };
      /** The check in words ("Rounds complete"). */
      check: string;
    };

export const itemKey = (i: FlagItem) => `${i.source}\u0000${i.sourceId}`;

/**
 * What new cv_report flags record: the report's first stored tournament and
 * its public tab. A report that no longer exists is left out, so it is not
 * flagged: there would be nothing to review.
 */
export async function resolveCvReportItems(
  ids: string[],
): Promise<Map<string, { url: string; tournamentId: bigint | null }>> {
  if (ids.length === 0) return new Map();
  const reports = await prisma.cvErrorReport.findMany({
    where: { id: { in: ids } },
    select: { id: true, tournamentIds: true },
  });
  const tIds = [...new Set(reports.flatMap((r) => r.tournamentIds))].filter((id) =>
    /^\d{1,18}$/.test(id),
  );
  const tournaments = tIds.length
    ? await prisma.tournament.findMany({
        where: { id: { in: tIds.map((id) => BigInt(id)) } },
        select: { id: true, sourceUrlRaw: true },
      })
    : [];
  const byId = new Map(tournaments.map((t) => [t.id.toString(), t] as const));
  return new Map(
    reports.map((r) => {
      const t = r.tournamentIds.map((id) => byId.get(id)).find((x) => x != null);
      return [
        r.id,
        { url: (t && publicPieceUrl(t.sourceUrlRaw)) || '', tournamentId: t ? t.id : null },
      ];
    }),
  );
}

/**
 * What new audit_check flags record: the tournament's public tab and id. A
 * check whose tournament is no longer stored is left out: nothing to review.
 */
export async function resolveAuditCheckItems(
  ids: string[],
): Promise<Map<string, { url: string; tournamentId: bigint | null }>> {
  const parsed = ids.flatMap((id) => {
    const p = parseAuditCheckId(id);
    return p ? [{ id, tournamentId: p.tournamentId }] : [];
  });
  if (parsed.length === 0) return new Map();
  const tournaments = await prisma.tournament.findMany({
    where: { id: { in: [...new Set(parsed.map((p) => BigInt(p.tournamentId)))] } },
    select: { id: true, sourceUrlRaw: true },
  });
  const byId = new Map(tournaments.map((t) => [t.id.toString(), t] as const));
  return new Map(
    parsed.flatMap((p) => {
      const t = byId.get(p.tournamentId);
      return t
        ? [[p.id, { url: publicPieceUrl(t.sourceUrlRaw) ?? '', tournamentId: t.id }] as const]
        : [];
    }),
  );
}

/** Each audit_check flag's tournament name and check label, by itemKey. */
async function auditCheckDetails(ids: string[]): Promise<Map<string, FlagDetail>> {
  const parsed = ids.flatMap((id) => {
    const p = parseAuditCheckId(id);
    return p ? [{ id, ...p }] : [];
  });
  if (parsed.length === 0) return new Map();
  const tournaments = await prisma.tournament.findMany({
    where: { id: { in: [...new Set(parsed.map((p) => BigInt(p.tournamentId)))] } },
    select: { id: true, name: true },
  });
  const nameById = new Map(tournaments.map((t) => [t.id.toString(), t.name] as const));
  return new Map(
    parsed.map((p) => [
      itemKey({ source: 'audit_check', sourceId: p.id }),
      {
        kind: 'audit_check',
        tournament: {
          id: p.tournamentId,
          name: nameById.get(p.tournamentId) ?? `Tournament #${p.tournamentId}`,
        },
        check: CHECK_LABELS[p.code as keyof typeof CHECK_LABELS],
      },
    ]),
  );
}

/** Each cv_report, parser_warning and audit_check flag's description, by itemKey. */
export async function loadFlagDetails(
  items: readonly FlagItem[],
  now: Date,
): Promise<Map<string, FlagDetail>> {
  const ids = (source: FlagItem['source']) => [
    ...new Set(items.filter((i) => i.source === source).map((i) => i.sourceId)),
  ];
  const [reports, warnings, checks] = await Promise.all([
    cvReportDetails(ids('cv_report')),
    warningDetails(ids('parser_warning'), now),
    auditCheckDetails(ids('audit_check')),
  ]);
  const out = new Map<string, FlagDetail>(checks);
  for (const [id, d] of reports) {
    out.set(itemKey({ source: 'cv_report', sourceId: id }), { kind: 'cv_report', ...d });
  }
  for (const [key, d] of warnings) {
    out.set(itemKey({ source: 'parser_warning', sourceId: key }), {
      kind: 'parser_warning',
      ...d,
    });
  }
  return out;
}

/** One line for the CSV's detail column and the ledger's name. */
export function detailText(d: FlagDetail | null): string {
  if (!d) return '';
  if (d.kind === 'cv_report') {
    const who = d.reporter.name ?? d.reporter.email ?? 'a user';
    return [
      `Reported by ${who}`,
      d.categories.join(', '),
      d.tournaments.map((t) => t.name).join(', '),
    ]
      .filter(Boolean)
      .join(' · ');
  }
  if (d.kind === 'audit_check') return `${d.tournament.name} · ${d.check}`;
  return [
    `[${d.parser}] ${d.headline}`,
    d.count == null ? 'no longer in the last 30 days' : `${d.count} in the last 30 days`,
    d.sampleTournaments.map((t) => t.name).join(', '),
  ]
    .filter(Boolean)
    .join(' · ');
}
