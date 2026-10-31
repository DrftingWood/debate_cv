import { prisma } from '@/lib/db';
import { REGIONS } from '@/lib/tags/vocabulary';

/**
 * A tournament's format, year and region set by hand on its admin page
 * (owner, 2026-10-31: "let me manually fill in tournament formats ... the
 * year as well also for region"). A field set here is listed in
 * Tournament.manualFields, and a scrape never overwrites it (ingest.ts); a
 * field cleared here leaves the list, so the automatic fill may set it again.
 */

/** Every format the parser can store (lib/calicotab/format.ts), in the order the picker shows. */
export const TOURNAMENT_FORMATS = [
  'British Parliamentary',
  'Asian Parliamentary',
  'World Schools',
  'Australs',
  'Two-team Parliamentary',
  'Policy',
  'Lincoln-Douglas',
  'Public Forum',
] as const;

export { REGIONS };

export const YEAR_MIN = 1990;
export const YEAR_MAX = 2100;

export type DetailField = 'format' | 'year' | 'region';

export type TournamentDetails = {
  format: string | null;
  year: number | null;
  region: string | null;
  /** The fields set by hand. */
  manual: DetailField[];
};

/** Only the fields named change; null clears a field and hands it back to the automatic fill. */
export type DetailsInput = { format?: string | null; year?: number | null; region?: string | null };

const FIELDS: readonly DetailField[] = ['format', 'year', 'region'];
const isField = (f: string): f is DetailField => (FIELDS as readonly string[]).includes(f);

export async function getTournamentDetails(id: bigint): Promise<TournamentDetails | null> {
  const t = await prisma.tournament.findUnique({
    where: { id },
    select: { format: true, year: true, region: true, manualFields: true },
  });
  if (!t) return null;
  return {
    format: t.format,
    year: t.year,
    region: t.region,
    manual: t.manualFields.filter(isField),
  };
}

export async function setTournamentDetails(
  id: bigint,
  input: DetailsInput,
): Promise<TournamentDetails | null> {
  const t = await prisma.tournament.findUnique({
    where: { id },
    select: { manualFields: true },
  });
  if (!t) return null;
  const manual = new Set(t.manualFields);
  const data: { format?: string | null; year?: number | null; region?: string | null } = {};
  for (const field of FIELDS) {
    if (!(field in input)) continue;
    const value = input[field];
    if (field === 'year') data.year = value as number | null;
    else data[field] = value as string | null;
    if (value === null) manual.delete(field);
    else manual.add(field);
  }
  const saved = await prisma.tournament.update({
    where: { id },
    data: { ...data, manualFields: [...manual] },
    select: { format: true, year: true, region: true, manualFields: true },
  });
  return {
    format: saved.format,
    year: saved.year,
    region: saved.region,
    manual: saved.manualFields.filter(isField),
  };
}

/**
 * What a scrape writes to format and year (Prisma leaves `undefined`
 * untouched): never a field set by hand, never a null that would erase a
 * value an earlier scrape found, and no format from a partial re-scrape,
 * which sees too little of the tournament to infer one.
 */
export function scrapeDetailWrites(
  manual: readonly string[],
  inferred: { format: string | null; year: number | null },
  partial: boolean,
): { format: string | undefined; year: number | undefined } {
  return {
    format: partial || manual.includes('format') ? undefined : (inferred.format ?? undefined),
    year: manual.includes('year') ? undefined : (inferred.year ?? undefined),
  };
}
