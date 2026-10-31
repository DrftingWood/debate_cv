import { ParserWarningsSection } from '@/components/admin/ParserWarningsSection';
import { listParserWarnings } from '@/lib/admin/parserWarnings';
import { readPage } from '@/lib/admin/cvReportTypes';
import { orNull } from '@/lib/admin/orNull';
import type { SearchValues } from '@/lib/admin/adminHref';

/** Parser warnings, paged through `?warningsPage=`. */
export async function ParserTab({ search, now }: { search: SearchValues; now: Date }) {
  const list = await listParserWarnings({ page: readPage(search.warningsPage), now }).catch(
    orNull('parser warnings'),
  );
  return <ParserWarningsSection list={list} now={now} search={search} />;
}
