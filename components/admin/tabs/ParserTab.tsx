import { ParserWarningsSection } from '@/components/admin/ParserWarningsSection';
import { listParser, readParserFilter } from '@/lib/admin/parserList';
import { readPage } from '@/lib/admin/cvReportTypes';
import { orNull } from '@/lib/admin/orNull';
import type { SearchValues } from '@/lib/admin/adminHref';

/**
 * Parser warnings, problems first: `?parser=problems` (default), `info` (the
 * expected states) or `checked`, paged through `?warningsPage=`.
 */
export async function ParserTab({ search, now }: { search: SearchValues; now: Date }) {
  const list = await listParser({
    filter: readParserFilter(search.parser),
    page: readPage(search.warningsPage),
    now,
  }).catch(orNull('parser warnings'));
  return <ParserWarningsSection list={list} now={now} search={search} />;
}
